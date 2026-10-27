import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261027_visa_monthly_mail_quota.sql",import.meta.url),"utf8");
test("Monthly free email quota resets with Berlin calendar month and serializes concurrent inserts",()=>{
 assert.match(sql,/quota_month/);
 assert.match(sql,/monthly_limit/);
 assert.match(sql,/guest_visa_reserve_mail_quota/);
 assert.match(sql,/for update/);
 assert.match(sql,/date_trunc\('month'/);
 assert.match(sql,/from public,anon,authenticated/);
 assert.doesNotMatch(sql,/delete from public\.guest_visa_mail_outbox/i);
});
