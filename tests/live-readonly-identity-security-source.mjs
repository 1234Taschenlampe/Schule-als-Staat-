import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const s=readFileSync(new URL("./live-readonly-identity-security.sql",import.meta.url),"utf8");

test("security smoke checks anonymous, two citizens, operator and admin",()=>{
  assert.match(s,/SET LOCAL ROLE anon/);
  assert.equal((s.match(/SET LOCAL ROLE authenticated/g)||[]).length,4);
  assert.match(s,/my_secure_school_name/);
  assert.match(s,/sas_initial_password/);
  assert.match(s,/admin_list_users/);
  assert.match(s,/admin_poll_results/);
  assert.match(s,/public\.submit_vote/);
});
test("every role scenario is read only and rolls back",()=>{
  assert.equal((s.match(/BEGIN READ ONLY;/g)||[]).length,5);
  assert.equal((s.match(/^ROLLBACK;$/gm)||[]).length,5);
  assert.doesNotMatch(s,/^COMMIT;/mi);
  assert.doesNotMatch(s,/^\s*(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP|CREATE|GRANT|REVOKE)\s/im);
});
test("no hardcoded citizen tokens or identifying user data in audit",()=>{
  assert.doesNotMatch(s,/@accounts\.schule-als-staat\.invalid/);
  assert.doesNotMatch(s,/SAS-[A-Z0-9]{10}/);
  assert.doesNotMatch(s,/sb_secret_[A-Za-z0-9_-]+/);
  assert.doesNotMatch(s,/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
});
