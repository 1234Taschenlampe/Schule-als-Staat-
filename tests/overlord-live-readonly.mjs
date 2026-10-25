import assert from "node:assert/strict";
import test from "node:test";
const base="https://schule-als-staat.schule-als-staat-jfe.workers.dev";
async function get(path,method="GET"){
  const res=await fetch(base+path,{method,signal:AbortSignal.timeout(15000),redirect:"error",cache:"no-store"});
  return res;
}
test("live Cloudflare Overlord health returns JSON without leaking infrastructure secrets",async()=>{
  const res=await get("/api/v1/health");
  assert.equal(res.status,200);
  assert.equal(res.headers.get("cache-control"),"no-store");
  const body=await res.json();
  assert.equal(body.ok,true);assert.equal(body.service,"sas-overlord");
  assert.equal(body.scope,"worker-health-only");
  assert.ok(!JSON.stringify(body).includes("service_role"));
});
test("live admin monitor denies unauthenticated GET and protects personal information",async()=>{
  const r=await get("/api/v1/overlord/metrics");
  assert.equal(r.status,401);
  const data=await r.json();assert.equal(data.error,"Authentication required");
});
test("live gateway rejects unknown and write RPC routes without backend traffic",async()=>{
  for(const path of ["/api/v1/rpc/settle_payment_request","/api/v1/rpc/issue_credits",
    "/api/v1/rpc/admin_list_users","/api/v1/unknown"]){
    const res=await get(path);assert.equal(res.status,404,path);
  }
  const allowedGet=await get("/api/v1/rpc/poll_catalog");
  assert.equal(allowedGet.status,405);
});
test("live existing Cloudflare website, PDF route and updated polling are preserved",async()=>{
  const home=await get("/");
  assert.equal(home.status,200);assert.match(await home.text(),/Schule als Staat/);
  const app=await get("/app.js");
  assert.equal(app.status,200);
  const code=await app.text();
  assert.match(code,/safeRpc=new Set/);
  assert.doesNotMatch(code,/setInterval\(function\(\)/);
  assert.match(code,/lastResumeRefresh/);
  assert.match(code,/Daten auf Abruf/);
  assert.match(code,/overlordRefresh\(\)/);
  const pdf=await get("/rng-floorplan.pdf","HEAD");
  assert.ok([200,502].includes(pdf.status),"Expected PDF or upstream school outage, got "+pdf.status);
});
