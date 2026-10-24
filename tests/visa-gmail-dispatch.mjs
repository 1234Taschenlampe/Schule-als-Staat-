import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../supabase/functions/visa-gmail-dispatch/index.ts",import.meta.url),"utf8");
const KEY="test-dispatch-secret".padEnd(40,"x");
function harness({missingGmail=false,emailEnabled=false}={}){
  let handle;
  const hits=[];
  const env={
    SUPABASE_URL:"https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY:"fake-for-isolated-tests",
    VISA_GMAIL_DISPATCH_SECRET:KEY,
    GMAIL_CLIENT_ID:missingGmail?"":"fake.apps.googleusercontent.com",
    GMAIL_CLIENT_SECRET:missingGmail?"":"test-only",
    GMAIL_REFRESH_TOKEN:missingGmail?"":"fake",
    GMAIL_SENDER_EMAIL:missingGmail?"":"test@example.test"
  };
  const fakeFetch=async (url,options)=>{
    hits.push(String(url));
    if(String(url).endsWith("/rest/v1/rpc/visa_public_settings"))
      return new Response(JSON.stringify({email_enabled:emailEnabled,turnstile_site_key:null}),{status:200});
    if(String(url)==="https://oauth2.googleapis.com/token")
      return new Response(JSON.stringify({access_token:"test-token"}),{status:200});
    throw Error("Unsafe/unexpected outbound request: "+url);
  };
  vm.runInNewContext(source,{
    Deno:{env:{get:k=>env[k]},serve:fn=>{handle=fn;}},
    URLSearchParams,Response,TextEncoder,btoa,fetch:fakeFetch,console
  },{filename:"visa-gmail-dispatch/index.ts",timeout:3000});
  async function send(mode,authorized=true){
    const req=new Request("https://example.test/functions/v1/visa-gmail-dispatch",{
      method:"POST",headers:{"authorization":"Bearer "+(authorized?KEY:"invalid")},
      body:JSON.stringify({mode})
    });
    const resp=await handle(req);
    return {status:resp.status,body:await resp.json()};
  }
  return {send,hits};
}
test("unauthenticated checks cannot learn configuration or send emails",async()=>{
 const h=harness();const r=await h.send("check",false);
 assert.equal(r.status,401);assert.deepEqual(h.hits,[]);
});
test("authenticated check reports missing Gmail secrets without exposing them",async()=>{
 const h=harness({missingGmail:true});const r=await h.send("check");
 assert.equal(r.status,503);assert.equal(r.body.error,"Gmail sender not configured");assert.deepEqual(h.hits,[]);
});
test("no-send OAuth check works even when public Visa applications are disabled",async()=>{
 const h=harness({emailEnabled:false});const r=await h.send("check");
 assert.equal(r.status,200);
 assert.equal(r.body.oauth_refresh_valid,true);
 assert.equal(r.body.email_enabled,false);
 assert.equal(r.body.sent_messages,0);
 assert.deepEqual(h.hits,["https://example.supabase.co/rest/v1/rpc/visa_public_settings",
 "https://oauth2.googleapis.com/token"]);
});
test("disabled public email gating blocks dispatch before Gmail send and queue claim",async()=>{
 const h=harness({emailEnabled:false});const r=await h.send("dispatch");
 assert.equal(r.status,503);assert.equal(r.body.error,"ViSA email delivery is disabled");
 assert.deepEqual(h.hits,["https://example.supabase.co/rest/v1/rpc/visa_public_settings"]);
});
test("unsupported mode must not make an external request",async()=>{
 const h=harness();const r=await h.send("send_all");
 assert.equal(r.status,400);assert.deepEqual(h.hits,[]);
});
