// One-shot production Auth smoke test. Only test@example.test-style addresses; no real users, mail or payments.
// Run via .github/workflows/live-signup-once.yml only after deliberately enabling test workflow.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
const conf = readFileSync(new URL("../config.js", import.meta.url), "utf8");
const url = conf.match(/supabaseUrl:\s*"([^"]+)"/)?.[1];
const key = conf.match(/supabaseAnonKey:\s*"([^"]+)"/)?.[1];
assert.ok(url && key && url.endsWith(".supabase.co"), "Missing public Supabase client config.");
const email = "sas-smoke-" + randomBytes(6).toString("hex") + "@example.test";
const password = randomBytes(30).toString("base64url") + "!Aa1";
const publicHeaders = { "apikey":key, "Content-Type":"application/json", "X-Client-Info":"sas-school-test" };
async function call(path, method="GET", data, token){
  const response=await fetch(url+path,{method,headers:{...publicHeaders,...(token?{Authorization:"Bearer "+token}:{})},...(data?{body:JSON.stringify(data)}:{})});
  const parsed=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(path+" HTTP "+response.status+": "+String(parsed.code||parsed.msg||parsed.error_code||parsed.message||"Unknown error").slice(0,180));
  return parsed;
}
let userId=null;
try{
  const signup=await call("/auth/v1/signup","POST",{email,password,data:{full_name:"SaS Smoke Test",class_label:"TEST"}});
  userId=signup.user?.id;
  assert.ok(userId,"Supabase signup returned no user.");
  console.log("CLEANUP_TEST_EMAIL="+email);
  console.log("CLEANUP_TEST_USER_ID="+userId);
  assert.ok(signup.access_token && signup.refresh_token,"Signup created an account without a session. Confirm Email may still be active.");
  const login=await call("/auth/v1/token?grant_type=password","POST",{email,password});
  assert.equal(login.user?.id,userId,"Password login did not match newly created user.");
  const token=login.access_token;
  assert.ok(token,"No valid sign-in token received");
  const [profiles, wallets, cards]=await Promise.all([
    call("/rest/v1/profiles?select=id,role,vote_eligible,display_name", "GET", null, token),
    call("/rest/v1/wallets?select=user_id,balance_cents", "GET", null, token),
    call("/rest/v1/student_cards?select=user_id,display_name,class_label,design", "GET", null, token)
  ]);
  assert.equal(profiles.length,1,"Member RLS must expose exactly one own profile");
  assert.equal(profiles[0].id,userId);
  assert.equal(profiles[0].role,"member");
  assert.equal(profiles[0].vote_eligible,false);
  assert.equal(profiles[0].display_name,"SaS Smoke Test");
  assert.equal(wallets.length,1,"New user must have exactly one wallet");
  assert.equal(wallets[0].user_id,userId);
  assert.equal(wallets[0].balance_cents,0);
  assert.equal(cards.length,1,"New user must have one draft ID card");
  assert.equal(cards[0].user_id,userId);
  assert.equal(cards[0].display_name,"SaS Smoke Test");
  assert.equal(cards[0].class_label,"TEST");
  assert.equal(cards[0].design,"classic");
  await call("/auth/v1/logout","POST",{},token);
  console.log("LIVE_AUTH_TEST_PASSED; email confirmation, signup, login, profile, wallet, card and RLS verified.");
}catch(e){
  console.error("LIVE_AUTH_TEST_FAILED: "+String(e.message||e).slice(0,250));
  if(!userId)console.error("No test account was created.");
  process.exitCode=1;
}
