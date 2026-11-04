import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const roster=read("supabase/migrations/20261104_enforce_official_roster.sql");
const votes=read("supabase/migrations/20261104_roster_scoped_vote_authorization.sql");
const rotatedVotes=read("supabase/migrations/20261104_enforce_initial_password_rotation.sql");
const signup=read("supabase/migrations/20261024_roster_only_signup_guard.sql");
const app=read("app.js");

test("closed signup remains enforced by auth.users trigger, not a hidden form",()=>{
  assert.match(signup,/before insert on auth\.users/i);
  assert.match(signup,/new\.raw_app_meta_data->>'sas_roster_provisioned'/);
  assert.doesNotMatch(app,/<form id="signup-form"/);
  assert.match(app,/roster-first-password-form/);
});

test("roster switch is guarded by complete imported roster, without forging verification",()=>{
  assert.match(roster,/v_complete_count<>v_roster_count/);
  assert.match(roster,/v_stray_count<>0/);
  assert.match(roster,/school_names_encrypted/);
  assert.match(roster,/roster_enforced=true/);
  assert.doesNotMatch(roster,/school_verified_at\s*=/);
});

test("one-vote RPC checks active roster, admin and duplicate votes",()=>{
  assert.match(votes,/p\.vote_eligible=true/);
  assert.match(votes,/r\.active/);
  assert.match(votes,/p\.role='admin'/);
  assert.match(votes,/FOR SHARE/);
  assert.match(votes,/unique_violation/);
  assert.match(votes,/REVOKE ALL ON FUNCTION public\.submit_vote\(uuid,uuid\) FROM PUBLIC,anon/);
});

test("the login never invites public account creation",()=>{
  assert.match(app,/Bürgerkennung oder Verwaltungs-E-Mail/);
  assert.match(app,/Eigenständige Registrierung ist deaktiviert/);
  assert.doesNotMatch(app,/Dein Konto wird von der Schule anhand der offiziellen Bürgerliste angelegt\./);
});

test("official votes cannot be cast using the unchanged seven-digit start PIN",()=>{
  assert.match(rotatedVotes,/auth\.users u/);
  assert.match(rotatedVotes,/sas_initial_password/);
  assert.match(rotatedVotes,/Bitte ändere zuerst dein einmaliges Startpasswort/);
  assert.match(rotatedVotes,/r\.active/);
  assert.match(rotatedVotes,/unique_violation/);
});
