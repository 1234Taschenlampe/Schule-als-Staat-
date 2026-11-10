import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL("../"+p, import.meta.url), "utf8");
const app = read("app.js");
const edge = read("supabase/functions/sas-account-recovery-qr/index.ts");
const html = read("index.html");

test("QR recovery browser flow parses and keeps secrets in fragment only", () => {
  new vm.Script(app, { filename:"app.js" });
  assert.match(app, /#sas-reset=\(\[A-Za-z0-9_-\]/);
  assert.match(app, /history\.replaceState\(null,"",location\.pathname\+location\.search\)/);
  assert.match(app, /verifyOtp\(\{token_hash:resetMatch\[1\],type:"recovery"\}\)/);
  assert.match(app, /state\.recovering=false;await fetchData\(\)/);
  assert.match(html, /meta name="referrer" content="no-referrer"/);
  assert.match(html, /app\.js\?v=20261110-support-suggest/);
});

test("Only administrators can request recovery after identity verification", () => {
  assert.match(app, /state\.profile\?\.role!=="admin"\|\|state\.page!=="itsupport"/);
  assert.match(app, /supportRequest\("qr",target,verified\)/);
  assert.match(edge, /input\?\.identity_checked !== true/);
  assert.match(edge, /service\.auth\.getUser\(jwt\)/);
  assert.match(edge, /service\.rpc\("sas_account_support"/);
  assert.ok(edge.indexOf("service.auth.getUser(jwt)") < edge.indexOf('service.rpc("sas_account_support"'));
  assert.match(edge, /p_reset: true/);
  assert.match(edge, /case "limited"/);
  assert.match(edge, /case "forbidden"/);
  assert.match(edge, /case "blocked"/);
});

test("QR recovery never sends mail, shares admin secret or targets admin accounts", () => {
  assert.match(edge, /service\.auth\.admin\.generateLink\(/);
  assert.match(edge, /type: "recovery", email/);
  assert.match(edge, /hashed_token/);
  assert.match(edge, /school_password_reset_audit/);
  assert.match(edge, /status !== "completed"/);
  assert.doesNotMatch(edge, /signInWithOtp|sendEmail|sendPasswordReset|recovery_link:.*temporary_password/);
  assert.match(edge, /recovery_link: portal \+ "\/#sas-reset="/);
  assert.doesNotMatch(app, /id="sas-support-secret"/);
  assert.match(app, /sas-support-qr/);
});

test("Six-digit student IDs work without SAS prefix while admin login stays separate", () => {
  assert.match(app, /if\(\/\^\[0-9\]\{6\}\$\/\.test\(rawLogin\)\)rawLogin="SAS-"\+rawLogin/);
  assert.match(app, /if\(\/\^\[0-9\]\{6\}\$\/\.test\(lookup\)\)lookup="SAS-"\+lookup/);
  assert.match(app, /longLogin\.indexOf\("@"\)<0/);
});
