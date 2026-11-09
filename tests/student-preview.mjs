import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const sql=read("supabase/migrations/20261103_student_preview_write_guard.sql");
const app=read("app.js");
const tutorial=read("tutorial.js");

test("preview keeps cards available and hides voting from non-admins",()=>{
 assert.match(app,/previewOpenPages=new Set\(\["home","apps","idcard","gallery","cardshop","settings"\]\)/);
 assert.match(app,/previewTeaserPages=new Set/);
 assert.match(app,/id==="votes"&&!administrator/);
 assert.match(app,/function previewLocked\(id\)/);
 assert.match(app,/function roleAllowed\(id\)/);
 assert.match(app,/function allowed\(id\)/);
 assert.match(app,/disabled aria-disabled="true"/);
 assert.match(app,/!isPreviewMember\(\)/);
 assert.match(tutorial,/previewOnly/);
});

test("database disallows direct standard-student writes in locked modules",()=>{
 assert.match(sql,/create or replace function sas_private\.sas_student_preview_write_guard/);
 assert.match(sql,/security definer/);
 assert.match(sql,/p\.role = 'member'/);
 assert.match(sql,/public\.school_role_assignments/);
 assert.match(sql,/before insert or update or delete on public\.%I/);
 for(const t of [
  "wallets","payment_requests","wallet_ledger","cash_sales","room_bookings",
  "event_rsvps","lost_items","job_applications","school_self_jobs",
  "school_shop_stalls","shop_products","shop_stock_movements",
  "shop_sales","shop_sale_items","work_shifts","work_scan_tokens",
  "attendance_passes","attendance_scans","attendance_sessions"
 ])assert.ok(sql.includes("'"+t+"'"),t+" must have a guarded write path");
 for(const unlocked of ["student_cards","student_card_codes","student_onboarding",
  "polls","poll_options","poll_ballots","school_competition_entries"])
  assert.ok(sql.includes(unlocked),"unlocked service must be documented: "+unlocked);
 assert.match(sql,/revoke all on function sas_private\.sas_student_preview_write_guard/);
});

test("Nikolausmarkt voting cutoff is aligned between browser and database",()=>{
 assert.match(app,/2026-11-25T23:00:00Z/);
 assert.match(sql,/Europe\/Berlin/);
 assert.match(sql,/2026-11-26 00:00:00/);
 assert.match(sql,/before insert or update on public\.poll_ballots/);
 assert.doesNotMatch(sql,/delete\s+from\s+public\.poll_ballots/i);
});
