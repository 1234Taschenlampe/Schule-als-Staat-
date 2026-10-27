import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../supabase/functions/visa-gmail-dispatch/index.ts",import.meta.url),"utf8");
const KEY="test-dispatch-secret".padEnd(40,"x");
function harness({missingGmail=false,emailEnabled=false,oauthError=null,provider='gmail',resendReady=true,resendHttp=200}={}){
  let handle;
  const hits=[],sent=[];
  const env={
    SUPABASE_URL:"https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY:"fake-for-isolated-tests",
    VISA_GMAIL_DISPATCH_SECRET:KEY,
    GMAIL_CLIENT_ID:missingGmail?"":"fake.apps.googleusercontent.com",
    GMAIL_CLIENT_SECRET:missingGmail?"":"test-only",
    GMAIL_REFRESH_TOKEN:missingGmail?"":"fake",
    GMAIL_SENDER_EMAIL:missingGmail?"":"test@example.test",
    VISA_EMAIL_PROVIDER:provider,
    RESEND_API_KEY:resendReady?"re_mockKeyOnlyNotForProd1234567":"",
    RESEND_FROM_EMAIL:resendReady?"visa@school.example.org":""
  };
  const fakeFetch=async (url,options)=>{
    hits.push(String(url));
    if(String(url).endsWith("/rest/v1/rpc/visa_gmail_vault_authorize")){
      const supplied=JSON.parse(options.body).p_token;
      return new Response(JSON.stringify(supplied==="a".repeat(64)),{status:200});
    }
    if(String(url).endsWith("/rest/v1/rpc/visa_public_settings"))
      return new Response(JSON.stringify({email_enabled:emailEnabled,turnstile_site_key:null}),{status:200});
    if(String(url).endsWith("/rest/v1/rpc/visa_mail_claim"))
      return new Response(JSON.stringify([{id:"a4c57d8e-0643-48e5-8d8c-fdd1b519d827",recipient:"guest@example.test",token:"f".repeat(64),attempt:1}]),{status:200});
    if(String(url).endsWith("/rest/v1/rpc/visa_mail_ack"))
      return new Response("true",{status:200});
    if(String(url)==="https://api.resend.com/emails"){
      sent.push({body:JSON.parse(options.body),headers:options.headers});
      return new Response(JSON.stringify(resendHttp===200?{id:"mock-message-id"}:{message:"Rejected"}),{status:resendHttp});
    }
    if(String(url)==="https://oauth2.googleapis.com/token")
      return oauthError
        ? new Response(JSON.stringify({error:oauthError,error_description:"REDACTED"}),{status:400})
        : new Response(JSON.stringify({access_token:"test-token"}),{status:200});
    throw Error("Unsafe/unexpected outbound request: "+url);
  };
  vm.runInNewContext(source,{
    Deno:{env:{get:k=>env[k]},serve:fn=>{handle=fn;}},
    URLSearchParams,Response,TextEncoder,btoa,fetch:fakeFetch,console
  },{filename:"visa-gmail-dispatch/index.ts",timeout:3000});
  async function send(mode,authorized=true){
    const chosen=authorized===true?KEY:(typeof authorized==="string"?authorized:"invalid");
    const req=new Request("https://example.test/functions/v1/visa-gmail-dispatch",{
      method:"POST",headers:{"authorization":"Bearer "+chosen},
      body:JSON.stringify({mode})
    });
    const resp=await handle(req);
    return {status:resp.status,body:await resp.json()};
  }
  return {send,hits,sent};
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

test("generated Vault token authenticates without changing the existing Edge Secret",async()=>{
 const h=harness({emailEnabled:false});
 const result=await h.send("check","a".repeat(64));
 assert.equal(result.status,200);
 assert.equal(result.body.oauth_refresh_valid,true);
 assert.deepEqual(h.hits,[
  "https://example.supabase.co/rest/v1/rpc/visa_gmail_vault_authorize",
  "https://example.supabase.co/rest/v1/rpc/visa_public_settings",
  "https://oauth2.googleapis.com/token"
 ]);
});
test("wrong random 64-hex token cannot trigger Gmail dispatch",async()=>{
 const h=harness({emailEnabled:true});
 const result=await h.send("dispatch","b".repeat(64));
 assert.equal(result.status,401);
 assert.deepEqual(h.hits,["https://example.supabase.co/rest/v1/rpc/visa_gmail_vault_authorize"]);
});

test("Google invalid_grant is classified without exposing secrets or error_description",async()=>{
 const h=harness({emailEnabled:false,oauthError:"invalid_grant"});
 const result=await h.send("check","a".repeat(64));
 assert.equal(result.status,503);
 assert.equal(result.body.error,"Gmail OAuth preflight failed");
 assert.equal(result.body.oauth_error_code,"invalid_grant");
 assert.ok(!JSON.stringify(result.body).includes("REDACTED"));
 assert.ok(!h.hits.includes("https://gmail.googleapis.com/gmail/v1/users/me/messages/send"));
});

test("Resend provider is disabled without verified sender configuration",async()=>{
 const h=harness({provider:"resend",resendReady:false,emailEnabled:true});
 const r=await h.send("dispatch");
 assert.equal(r.status,503);
 assert.equal(h.sent.length,0);
 assert.deepEqual(h.hits,[]);
});
test("Resend no-send preflight explicitly does not claim delivery",async()=>{
 const h=harness({provider:"resend"});
 const r=await h.send("check");
 assert.equal(r.status,200);
 assert.equal(r.body.provider,"resend");
 assert.equal(r.body.verified_delivery,false);
 assert.equal(r.body.sent_messages,0);
 assert.deepEqual(h.hits,["https://example.supabase.co/rest/v1/rpc/visa_public_settings"]);
});
test("Resend sends one valid confirmation through existing queue with idempotency",async()=>{
 const h=harness({provider:"resend",emailEnabled:true});
 const r=await h.send("dispatch");
 assert.equal(r.status,200);
 assert.equal(r.body.sent,1);
 assert.equal(h.sent.length,1);
 assert.deepEqual(h.sent[0].body.to,["guest@example.test"]);
 assert.equal(h.sent[0].headers["Idempotency-Key"],"sas-visa-a4c57d8e-0643-48e5-8d8c-fdd1b519d827");
 assert.match(h.sent[0].body.text,/#visa-verify=/);
 assert.equal(h.hits.includes("https://oauth2.googleapis.com/token"),false);
});
test("Resend failure does not falsely acknowledge email sent",async()=>{
 const h=harness({provider:"resend",emailEnabled:true,resendHttp:429});
 const r=await h.send("dispatch");
 assert.equal(r.status,200);
 assert.equal(r.body.sent,0);
 assert.equal(r.body.retried,1);
 assert.equal(h.sent.length,1);
});
