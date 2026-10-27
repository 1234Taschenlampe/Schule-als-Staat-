import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const sql=readFileSync(new URL("../supabase/migrations/20261027_directory_privacy.sql",import.meta.url),"utf8");
const ui=readFileSync(new URL("../roles.js",import.meta.url),"utf8");
const client=readFileSync(new URL("../config.js",import.meta.url),"utf8");
test("directory quota is private",()=>{
 assert.match(sql,/create schema if not exists sas_private/i);
 assert.match(sql,/revoke all on schema sas_private from public, anon, authenticated/i);
 assert.match(sql,/enable row level security/i);
 assert.match(sql,/revoke all on table sas_private\.directory_search_budget from public, anon, authenticated/i);
});
test("wildcard enumeration is refused, search is capped and durable",()=>{
 assert.match(sql,/char_length\(v_query\)\s*<\s*4/);
 assert.match(sql,/position\('%' in v_query\)\s*>\s*0/);
 assert.match(sql,/position\('_' in v_query\)\s*>\s*0/);
 assert.match(sql,/position\(chr\(92\) in v_query\)\s*>\s*0/);
 assert.match(sql,/limit 10/i);
 assert.match(sql,/v_burst\s*>\s*20/);
 assert.match(sql,/v_daily\s*>\s*60/);
 assert.match(sql,/then matches\.email else null/i);
 assert.match(sql,/not public\.sas_can_manage_school\(\)/);
});
test("directory function checks role on the server",()=>{
 assert.match(sql,/revoke all on function public\.school_role_find_students\(text\) from public, anon, authenticated/i);
 assert.match(sql,/grant execute on function public\.school_role_find_students\(text\) to authenticated/i);
 assert.match(sql,/security definer/i);
});
test("UI enforces meaningful name search",()=>{
 assert.match(ui,/minlength="4"/);
 assert.match(ui,/keine Platzhalter/);
});
test("no service-role or secret API key in browser config",()=>{
 assert.match(client,/sb_publishable_/);
 assert.doesNotMatch(client,/sb_secret_[A-Za-z0-9_-]+/);
 assert.doesNotMatch(client,/eyJ[A-Za-z0-9_-]{40,}/);
});
