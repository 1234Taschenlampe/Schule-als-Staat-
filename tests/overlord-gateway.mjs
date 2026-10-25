import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
import {webcrypto} from "node:crypto";

const source=readFileSync(new URL("../dist/schule-als-staat-worker.js",import.meta.url),"utf8");
const origin="https://school.example.test",jwt="abcdefgh.abcdefgh.abcdefgh";
function harness({role="admin",status=200,delay=0}={}){
  let handler,upstreamRpc=0,adminChecks=0;
  const routed=[];
  const fetchMock=async(url,opts={})=>{
    const parsed=new URL(String(url));
    routed.push({path:parsed.pathname,method:opts.method||"GET",headers:opts.headers,body:opts.body});
    if(delay)await new Promise(r=>setTimeout(r,delay));
    if(parsed.pathname==="/auth/v1/user"){
      adminChecks++;
      return new Response(JSON.stringify({id:"123e4567-e89b-12d3-a456-426614174000"}),{status:200});
    }
    if(parsed.pathname==="/rest/v1/profiles")
      return new Response(JSON.stringify([{role}]),{status:200});
    if(parsed.pathname==="/rest/v1/rpc/poll_catalog"||parsed.pathname==="/rest/v1/rpc/shop_room_catalog"){
      upstreamRpc++;
      return new Response(JSON.stringify({ok:status<500,from:"mock-supabase"}),{status});
    }
    throw new Error("Unexpected outbound network request: "+parsed.href);
  };
  vm.runInNewContext(source,{
    addEventListener:(type,fn)=>{if(type==="fetch")handler=fn},
    fetch:fetchMock,Response,Request,Headers,TextEncoder,Uint8Array,Date,URL,
    Map,Set,Object,JSON,Array,Promise,Math,Error,AbortSignal,crypto:webcrypto,
    console
  },{filename:"bundle.js",timeout:6000});
  const call=async(path,{method="GET",body,auth,headers={}}={})=>{
    const req=new Request(origin+path,{method,headers:{
      ...(auth?{authorization:auth}:{}),
      ...(body!==undefined?{"content-type":"application/json"}:{}),
      ...headers
    },...(body!==undefined?{body}:{} )});
    let result;
    handler({request:req,respondWith(promise){result=promise;}});
    const resp=await result;
    const out=await resp.text();
    return {status:resp.status,headers:resp.headers,body:out?JSON.parse(out):null};
  };
  return {call,routed,get upstreamRpc(){return upstreamRpc},get adminChecks(){return adminChecks}};
}
test("public health has no secrets or backend traffic",async()=>{
 const h=harness();let r=await h.call("/api/v1/health");
 assert.equal(r.status,200);assert.equal(r.body.scope,"worker-health-only");
 assert.equal(h.routed.length,0);assert.doesNotMatch(JSON.stringify(r.body),/sb_publishable|wdebwgc/);
});
test("all writes, fake RPC paths, queries, cross-origin and oversized requests fail closed",async()=>{
 const h=harness();
 assert.equal((await h.call("/api/v1/rpc/settle_payment_request",{method:"POST",auth:"Bearer "+jwt,body:"{}"})).status,404);
 assert.equal((await h.call("/api/v1/rpc/poll_catalog",{method:"GET",auth:"Bearer "+jwt})).status,405);
 assert.equal((await h.call("/api/v1/rpc/poll_catalog",{method:"POST",auth:"Bearer "+jwt,body:'{"admin":true}'})).status,400);
 assert.equal((await h.call("/api/v1/rpc/poll_catalog",{method:"POST",body:"{}"})).status,401);
 assert.equal((await h.call("/api/v1/rpc/poll_catalog",{method:"POST",auth:"Bearer "+jwt,body:"{}",headers:{"origin":"https://attacker.invalid"}})).status,403);
 assert.equal((await h.call("/api/v1/rpc/poll_catalog?other=x",{method:"POST",auth:"Bearer "+jwt,body:"{}"})).status,403);
 assert.equal((await h.call("/api/v1/rpc/poll_catalog",{method:"POST",auth:"Bearer "+jwt,body:" ".repeat(2050)})).status,413);
 assert.equal(h.upstreamRpc,0);
});
test("valid allowlisted RPC forwards ONLY caller JWT and public API key, no caching or mutation",async()=>{
 const h=harness();
 const result=await h.call("/api/v1/rpc/poll_catalog",{method:"POST",auth:"Bearer "+jwt,body:"{}"});
 assert.equal(result.status,200);assert.equal(result.headers.get("cache-control"),"no-store");
 assert.equal(h.upstreamRpc,1);
 const req=h.routed.at(-1);
 assert.equal(req.path,"/rest/v1/rpc/poll_catalog");assert.equal(req.method,"POST");
 assert.equal(req.body,"{}");assert.equal(req.headers.authorization,"Bearer "+jwt);
 assert.match(req.headers.apikey,/^sb_publishable_/);
 assert.equal(req.headers["service_role"],undefined);
});
test("admin monitoring verifies live Auth identity AND database role",async()=>{
 const h=harness();
 assert.equal((await h.call("/api/v1/overlord/metrics")).status,401);
 const ok=await h.call("/api/v1/overlord/metrics",{auth:"Bearer "+jwt});
 assert.equal(ok.status,200);
 assert.equal(ok.body.scope,"current-worker-isolate");
 assert.ok(ok.body.counters.requests>=2);
 assert.ok(h.adminChecks>=1);
 assert.deepEqual(Array.from(ok.body.rpcAllowlist),["poll_catalog","shop_room_catalog"]);
 const normal=harness({role:"member"});
 assert.equal((await normal.call("/api/v1/overlord/metrics",{auth:"Bearer "+jwt})).status,403);
});
test("429 protects per-token repeated requests; upstream 500 and 503 are not cached",async()=>{
 const h=harness({status:500});
 let r=await h.call("/api/v1/rpc/poll_catalog",{method:"POST",auth:"Bearer "+jwt,body:"{}"});
 assert.equal(r.status,500);
 for(let i=0;i<89;i++){
   r=await h.call("/api/v1/rpc/shop_room_catalog",{method:"POST",auth:"Bearer "+jwt,body:"{}"});
   assert.equal(r.status,500);
 }
 const exhausted=await h.call("/api/v1/rpc/poll_catalog",{method:"POST",auth:"Bearer "+jwt,body:"{}"});
 assert.equal(exhausted.status,429);assert.equal(exhausted.headers.get("retry-after"),"60");
 assert.equal(h.upstreamRpc,90);
});
test("event-driven refresh removes permanent database polling and keeps manual updates",()=>{
 const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
 assert.doesNotMatch(app,/setInterval\(function\(\)/);
 assert.match(app,/addEventListener\("visibilitychange"/);
 assert.match(app,/lastResumeRefresh/);
 assert.match(app,/Date\.now\(\)-lastResumeRefresh<120000/);
 assert.match(app,/safeRpc=new Set\(\[\]\)/);
 assert.match(app,/var refreshPending=false/);
 assert.doesNotMatch(app,/btn\("Aktualisieren","reload"/);
 assert.match(app,/role==="admin"/);
});
test("authenticated startup reads use direct Supabase rather than an intermediary",async()=>{
 const source=readFileSync(new URL("../app.js",import.meta.url),"utf8");
 const start=source.indexOf("var safeRpc=new Set([])");
 const finish=source.indexOf("var api=ready?",start);
 assert.ok(start>=0&&finish>start);
 const snippet=source.slice(start,finish);
 const called=[];
 const sandbox={
   URL,location:{origin:"https://schule-als-staat.schule-als-staat-jfe.workers.dev"},
   cfg:{supabaseUrl:"https://wdebwgcferieedkpqbvk.supabase.co"},
   fetch:async(url,opts)=>{called.push({url,opts});return{status:200};}
 };
 vm.runInNewContext(snippet+";globalFn=sasGatewayFetch;",sandbox);
 const addresses=["poll_catalog","shop_room_catalog","my_school_roles","admin_list_users"];
 for(const name of addresses){
   const url="https://wdebwgcferieedkpqbvk.supabase.co/rest/v1/rpc/"+name;
   await sandbox.globalFn(url,{method:"POST",body:"{}",headers:{authorization:"Bearer test.session.token"}});
 }
 assert.equal(called.length,4);
 assert.ok(called.every(x=>String(x.url).startsWith("https://wdebwgcferieedkpqbvk.supabase.co/")));
 assert.doesNotMatch(source,/root.textContent="Start fehlgeschlagen/);
 assert.match(source,/Das Schulportal konnte nicht geladen werden/);
 assert.match(source,/sas-start-retry/);
});
test("100 simultaneous synthetic requests complete without privileged operations or state changes",async()=>{
 const h=harness({delay:1});
 const response=await Promise.all(Array.from({length:100},()=>h.call("/api/v1/rpc/poll_catalog",{method:"POST",auth:"Bearer "+jwt,body:"{}"})));
 assert.equal(response.length,100);
 assert.ok(response.every(x=>[200,429,503].includes(x.status)));
 assert.equal(h.routed.some(x=>x.path.includes("settle_payment_request")||x.path.includes("admin_")),false);
 assert.equal(h.upstreamRpc,response.filter(x=>x.status===200).length);
});
