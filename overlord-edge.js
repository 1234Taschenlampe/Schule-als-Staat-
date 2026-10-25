/* SaS Overlord v1. Read-only, fail-closed proxy for explicitly approved RPCs.
 * No service_role key or other privileged credential is present in this Worker.
 * Each request retains its Supabase access JWT; PostgREST executes the same RLS/RPC.
 * Per-isolate counters and buckets are an *additional* best-effort brake, NOT a
 * globally distributed rate limiter. Direct Supabase endpoints remain reachable.
 */
const OVERLORD_ALLOWED_RPCS = Object.freeze(["poll_catalog","shop_room_catalog"]);
const OVERLORD_LIMIT_PER_USER = 90;
const OVERLORD_LIMIT_PER_IP = 900; // large school NATs need headroom
const OVERLORD_WINDOW_MS = 60000;
const OVERLORD_MAX_BODY_BYTES = 2048;
const OVERLORD_MAX_INFLIGHT = 30;
const overlordState = {
  startedAt: Date.now(), requests: 0, forwarded: 0, rejected: 0, throttled: 0,
  errors: 0, upstream5xx: 0, active: 0, lastUpstreamStatus: 0,
  lastUpstreamAt: 0, buckets: new Map()
};
const overlordJson = (obj,status=200,extra={}) => new Response(JSON.stringify(obj),{
  status,headers:{
    "content-type":"application/json; charset=utf-8",
    "cache-control":"no-store",
    "x-content-type-options":"nosniff",
    "referrer-policy":"no-referrer",
    ...extra
  }
});
function overlordLimit(key,max,now){
  const map=overlordState.buckets;
  const previous=map.get(key);
  const item=previous && previous.expires>now?previous:{count:0,expires:now+OVERLORD_WINDOW_MS};
  ++item.count;map.set(key,item);
  // Bound in-memory state in long-running isolates.
  if(map.size>4096)for(const [k,v] of map){if(v.expires<=now)map.delete(k);}
  if(map.size>8192)map.clear();
  return item.count<=max;
}
async function overlordIdentity(token){
  const bytes=new TextEncoder().encode(token);
  const buffer=await crypto.subtle.digest("SHA-256",bytes);
  const view=new Uint8Array(buffer);
  return Array.from(view.slice(0,12),x=>x.toString(16).padStart(2,"0")).join("");
}
function overlordBearer(request){
  const h=request.headers.get("authorization")||"";
  if(!/^Bearer [A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}$/.test(h) || h.length>4096)return null;
  return h;
}
async function overlordIsAdmin(bearer){
  const url=OVERLORD_SUPABASE_URL;
  const headers={apikey:OVERLORD_PUBLISHABLE_KEY,authorization:bearer,accept:"application/json"};
  // Supabase Auth validates the JWT, not an untrusted decoded browser claim.
  const who=await fetch(url+"/auth/v1/user",{headers,redirect:"error"});
  if(!who.ok)return false;
  const user=await who.json();
  if(!/^[0-9a-f-]{36}$/i.test(String(user?.id||"")))return false;
  const result=await fetch(url+"/rest/v1/profiles?select=role&id=eq."+encodeURIComponent(user.id),{headers,redirect:"error"});
  if(!result.ok)return false;
  const profiles=await result.json();
  return Array.isArray(profiles)&&profiles.length===1&&profiles[0].role==="admin";
}
async function overlordHandle(request) {
  const path=new URL(request.url).pathname, method=request.method, now=Date.now();
  overlordState.requests++;
  if(path==="/api/v1/health" && (method==="GET"||method==="HEAD")){
    return overlordJson({ok:true,service:"sas-overlord",version:1,scope:"worker-health-only"});
  }
  if(method==="OPTIONS")return overlordJson({error:"Cross-origin API access disabled"},405,{allow:"GET,HEAD,POST"});
  // Only same-origin requests can use the gateway; disallow CORS, redirects, and URL parameters.
  const url=new URL(request.url);
  if(url.search || request.headers.get("sec-fetch-site")==="cross-site" ||
     (request.headers.get("origin") && request.headers.get("origin")!==url.origin)){
    overlordState.rejected++;return overlordJson({error:"Invalid request origin or query"},403);
  }
  const bearer=overlordBearer(request);
  if(path==="/api/v1/overlord/metrics"){
    if(method!=="GET")return overlordJson({error:"Method not allowed"},405,{allow:"GET"});
    if(!bearer){overlordState.rejected++;return overlordJson({error:"Authentication required"},401);}
    try{
      if(!await overlordIsAdmin(bearer)){overlordState.rejected++;return overlordJson({error:"Forbidden"},403);}
    }catch{overlordState.errors++;return overlordJson({error:"Authorization service unavailable"},503);}
    const s=overlordState;
    return overlordJson({
      service:"sas-overlord",version:1,scope:"current-worker-isolate",
      note:"Counters are per isolate, not global Cloudflare traffic totals",
      uptimeSeconds:Math.floor((now-s.startedAt)/1000),
      counters:{requests:s.requests,forwarded:s.forwarded,rejected:s.rejected,
        throttled:s.throttled,errors:s.errors,upstream5xx:s.upstream5xx},
      active:s.active,lastUpstreamStatus:s.lastUpstreamStatus,
      lastUpstreamAt:s.lastUpstreamAt?new Date(s.lastUpstreamAt).toISOString():null,
      controls:{perUserPerMinute:OVERLORD_LIMIT_PER_USER,perIpPerMinute:OVERLORD_LIMIT_PER_IP,
        maxInflightPerIsolate:OVERLORD_MAX_INFLIGHT},
      rpcAllowlist:OVERLORD_ALLOWED_RPCS
    });
  }
  const match=/^\/api\/v1\/rpc\/([a-z_]+)$/.exec(path);
  if(!match || !OVERLORD_ALLOWED_RPCS.includes(match[1])){
    overlordState.rejected++;return overlordJson({error:"Not found"},404);
  }
  if(method!=="POST"){overlordState.rejected++;return overlordJson({error:"Method not allowed"},405,{allow:"POST"});}
  if(!bearer){overlordState.rejected++;return overlordJson({error:"Authentication required"},401);}
  if(Number(request.headers.get("content-length")||0)>OVERLORD_MAX_BODY_BYTES){
    overlordState.rejected++;return overlordJson({error:"Payload too large"},413);
  }
  let params;
  try {
    const body=await request.text();
    if(body.length>OVERLORD_MAX_BODY_BYTES)throw Error("oversized");
    params=JSON.parse(body);
    if(!params || Array.isArray(params)||typeof params!=="object" || Object.keys(params).length)
      throw Error("unexpected parameter");
  }catch{overlordState.rejected++;return overlordJson({error:"RPC accepts only empty JSON body"},400);}
  const ip=(request.headers.get("cf-connecting-ip")||"unidentified").slice(0,55);
  let key;
  try{key=await overlordIdentity(bearer);}catch{return overlordJson({error:"Gateway unavailable"},503);}
  if(!overlordLimit("u:"+key,OVERLORD_LIMIT_PER_USER,now)||
     !overlordLimit("i:"+ip,OVERLORD_LIMIT_PER_IP,now)){
    overlordState.throttled++;
    return overlordJson({error:"Too many requests"},429,{"retry-after":"60"});
  }
  if(overlordState.active>=OVERLORD_MAX_INFLIGHT){
    overlordState.throttled++;
    return overlordJson({error:"Gateway busy"},503,{"retry-after":"2"});
  }
  overlordState.active++;
  try{
    const target=OVERLORD_SUPABASE_URL+"/rest/v1/rpc/"+match[1];
    const upstream=await fetch(target,{
      method:"POST",redirect:"error",
      headers:{"apikey":OVERLORD_PUBLISHABLE_KEY,authorization:bearer,
        "content-type":"application/json","accept":"application/json"},
      body:"{}",signal:AbortSignal.timeout(10000)
    });
    overlordState.forwarded++;
    overlordState.lastUpstreamAt=Date.now();overlordState.lastUpstreamStatus=upstream.status;
    if(upstream.status>=500)overlordState.upstream5xx++;
    // Return the upstream body/status. Never cache personal RPC data.
    const safeHeaders={"content-type":"application/json; charset=utf-8",
      "cache-control":"no-store","x-content-type-options":"nosniff"};
    if(upstream.status===429)safeHeaders["retry-after"]="30";
    return new Response(upstream.body,{status:upstream.status,headers:safeHeaders});
  }catch {
    overlordState.errors++;
    return overlordJson({error:"Upstream temporarily unavailable"},503);
  }finally{overlordState.active--;}
}
