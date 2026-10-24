import assert from "node:assert/strict";
import {readFileSync,writeFileSync,mkdtempSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import test from "node:test";
import vm from "node:vm";

const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
const migration=readFileSync(new URL("../supabase/migrations/20261024_roster_only_signup_guard.sql",import.meta.url),"utf8");

test("public signup removed without modifying admin or job selection",()=>{
 assert.doesNotMatch(app,/Konto erstellen<\/button>/);
 assert.match(app,/SAS-\[A-Z0-9\]\{10\}/);
 assert.match(app,/roster-first-password-form/);
 assert.match(app,/set_my_school_job_title/);
 assert.match(app,/app_metadata\?\.sas_initial_password/);
 assert.match(app,/auth\.updateUser\(\{password:pw\}\)/);
});
test("server signup guard trusts only app_metadata and preserves old accounts",()=>{
 assert.match(migration,/before insert on auth\.users/);
 assert.match(migration,/new\.raw_app_meta_data->>'sas_roster_provisioned'/);
 assert.doesNotMatch(migration,/old\.raw_user_meta_data->>'sas_roster_provisioned'/);
 assert.match(migration,/old\.encrypted_password is distinct from new\.encrypted_password/);
 assert.match(migration,/sas_initial_password/);
 assert.match(migration,/revoke all on public\.school_roster_members from public,anon,authenticated/);
});
test("roster provision script is write-protected and uses Admin API only",()=>{
 const s=readFileSync(new URL("../scripts/provision-school-roster.mjs",import.meta.url),"utf8");
 assert.match(s,/process\.argv\.includes\("--apply"\)/);
 assert.match(s,/\/auth\/v1\/admin\/users/);
 assert.match(s,/sas_roster_provisioned:true/);
 assert.match(s,/sas_initial_password:true/);
 assert.match(s,/\.invalid/);
 assert.doesNotMatch(s,/auth\.signUp\(/);
});
test("offline XLSX generator produces unique credentials and one-page-per-person PDF",()=>{
 const path=join(tmpdir(),"rng-roster-tests-"+process.pid);
 const p=spawnSync("python3",["tests/roster-offline-smoke.py",path],{encoding:"utf8"});
 assert.equal(p.status,0,p.stdout+"\n"+p.stderr);
});
