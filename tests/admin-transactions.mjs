import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

const source=name=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const app=source("app.js");
const html=source("index.html");
const widget=source("admin-transactions.js");
const sql=source("supabase/migrations/20261110100000_admin_transaction_centre.sql");
const worker=source("scripts/build-worker.mjs");
const staticBundle=source("scripts/build-static.sh");

test("all new JavaScript parses",()=>{
  new vm.Script(widget,{filename:"admin-transactions.js"});
  new vm.Script(app,{filename:"app.js"});
});

test("admin-only page and asset routing are wired",()=>{
  assert.match(app,/transactions","Transaktionen"/);
  assert.match(app,/id==="transactions".*return administrator/);
  assert.match(app,/page==="transactions"&&window\.SAS_ADMIN_TRANSACTIONS/);
  assert.match(app,/to-transactions/);
  assert.match(html,/admin-transactions\.js\?v=20261110-finance/);
  assert.match(worker,/"admin-transactions\.js"/);
  assert.match(staticBundle,/admin-transactions\.js/);
});

test("UI does not offer this tool to a nonadmin",async()=>{
  const win={};
  vm.runInNewContext(widget,{window:win,Intl,Date,Number,String,Array,Error});
  let queried=false;
  const target={textContent:""};
  await win.SAS_ADMIN_TRANSACTIONS.show({
    target,profile:{role:"member"},api:{rpc:()=>{queried=true;throw Error("must not query");}}
  });
  assert.match(target.textContent,/Nur für die Administration/);
  assert.equal(queried,false);
});

test("client makes no table writes and requires explicit confirmation",()=>{
  assert.doesNotMatch(widget,/\.from\(["'](?:wallets|wallet_ledger|cash_sales)["']\)/);
  assert.match(widget,/admin_reverse_transaction/);
  assert.match(widget,/admin_list_transactions/);
  assert.match(widget,/p_operation_id:operationId/);
  assert.match(widget,/name="confirm" required/);
  assert.match(widget,/minlength="8" maxlength="500"/);
  assert.match(widget,/Diese Seite als CSV/);
  assert.match(widget,/^\s*if\(\/\^\[\\s\]\*\[=\+\\-@\]\//m);
});

test("database role checks are server-side and privileged SQL API is explicitly scoped",()=>{
  assert.match(sql,/create or replace function public\.admin_list_transactions/);
  assert.match(sql,/create or replace function public\.admin_reverse_transaction/);
  assert.match(sql,/where id=v_admin and role='admin'/);
  assert.match(sql,/revoke all on function public\.admin_reverse_transaction\(uuid,uuid,text\)/);
  assert.match(sql,/revoke all on function public\.admin_list_transactions/);
  assert.match(sql,/grant execute on function public\.admin_list_transactions[\s\S]*to authenticated;/);
  assert.match(sql,/unique index if not exists wallet_ledger_reverse_of_unique/);
  assert.match(sql,/unique index if not exists wallet_ledger_reversal_operation_unique/);
  assert.match(sql,/pg_advisory_xact_lock/);
  assert.match(sql,/where id=p_original_ledger_id for update/);
  assert.match(sql,/order by user_id for update/);
  assert.match(sql,/v_recipient_balance < v_original\.amount_cents/);
  assert.match(sql,/v_original\.kind not in \('credit','payment'\)/);
  assert.match(sql,/before update or delete on sas_private\.financial_audit_events/);
  assert.match(sql,/from public\.cash_sales/);
  assert.doesNotMatch(sql,/delete from public\.wallet_ledger/i);
});

test("existing wallet reconciliation and personal history handle counterbookings",()=>{
  assert.match(sql,/case when l\.kind='reversal' then -1 else 1 end/);
  assert.match(sql,/case when kind='reversal' then -1 else 1 end/);
  assert.match(sql,/event_type in \('credit','payment','reversal'\)/);
  assert.match(app,/x\.kind==="reversal"\?x\.payer_id===state\.user\.id/);
  assert.match(app,/Zahlung erstattet/);
  assert.match(sql,/kind='cash' then 'bar_erfasst'/);
});
