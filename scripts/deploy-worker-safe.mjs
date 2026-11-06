/**
 * Safe Cloudflare asset synchronization: preserves the live Worker runtime,
 * PDF proxy, API gateway, settings and bindings. Requires existing Worker.
 */
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
const script="schule-als-staat";
const accountId=process.env.CLOUDFLARE_ACCOUNT_ID||"";
const token=process.env.CLOUDFLARE_API_TOKEN||"";
if(!/^[0-9a-f]{32}$/.test(accountId)||!token)throw Error("Cloudflare credentials missing; deployment aborted.");
const names=[
 "index.html","datenschutz.html","nutzungsregeln.html","styles.css","features.css","tutorial.css","brand-emblem.css",
 "public-visa.css","shop-plan.css","portal-extras.css","flag-voting.css","flag-voting.js","app.js","features.js",
 "physical-card-shop.css","physical-card-shop.js",
 "roles.js","attendance.js","tutorial.js","config.js","work-hours.js",
 "shop-management.js","admin-credit.js","public-visa.js","shop-plan.js",
 "mobile-ui.css","portal-extras.js"
];
const bundle=Object.fromEntries(names.map(n=>["/"+n,readFileSync(resolve(process.cwd(),n),"utf8")]));
const type=n=>n.endsWith(".html")?"text/html; charset=utf-8":n.endsWith(".css")?"text/css; charset=utf-8":"application/javascript; charset=utf-8";
const endpoint="https://api.cloudflare.com/client/v4/accounts/"+accountId+"/workers/scripts/"+script;
async function cloudflare(path,method="GET",body){
 const res=await fetch(endpoint+path,{method,headers:{Authorization:"Bearer "+token,...(body===undefined?{}:{"Content-Type":"application/javascript"})},body});
 if(!res.ok)throw Error("Cloudflare "+method+" returned HTTP "+res.status);
 if(method==="GET")return res.text();
 const data=await res.json();if(!data.success)throw Error("Cloudflare rejected deployment");
 return data;
}
function segment(source,key,next){
 const prefix="const "+key+"=",suffix=";\nconst "+next+"=";
 const start=source.indexOf(prefix),end=source.indexOf(suffix,start);
 if(start<0||end<0||source.indexOf(prefix,start+1)>=0)throw Error("Unsupported Worker layout for "+key);
 return {start,end,data:JSON.parse(source.slice(start+prefix.length,end))};
}
function patch(source){
 if(!source.includes("path==='/rng-floorplan.pdf'")||!source.includes("overlordHandle("))
  throw Error("Required Worker routes were not found; abort");
 const a=segment(source,"ASSETS","TYPES"),t=segment(source,"TYPES","OVERLORD_SUPABASE_URL");
 // Never silently change gateway routing by publishing a new public configuration.
 if(a.data["/config.js"]!==bundle["/config.js"])throw Error("Public Supabase config changed: review Worker gateway configuration before deployment.");

 const assets={...a.data,...bundle};
 const types={...t.data,...Object.fromEntries(names.map(n=>["/"+n,type(n)]))};
 let result=source.slice(0,t.start)+"const TYPES="+JSON.stringify(types)+source.slice(t.end);
 result=result.slice(0,a.start)+"const ASSETS="+JSON.stringify(assets)+result.slice(a.end);
 return result;
}
const before=await cloudflare("");
const after=patch(before);
if(after===before){console.log("Existing Worker already matches the tested website assets.");process.exit(0);}
await cloudflare("/content","PUT",after);
const remote=await cloudflare("");
const assets=segment(remote,"ASSETS","TYPES").data;
for(const name of names)if(assets["/"+name]!==bundle["/"+name])throw Error("Deployment verification failed for "+name);
if(!remote.includes("path==='/rng-floorplan.pdf'")||!remote.includes("overlordHandle("))
 throw Error("Worker proxy or gateway changed");
console.log("Verified "+names.length+" website assets on the existing free Worker.");
