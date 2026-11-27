import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const file = name => readFileSync(new URL('../supabase/' + name, import.meta.url), 'utf8');
function legacy(fileName, functionName) {
  const source = file(fileName);
  const start = source.indexOf('create or replace function public.' + functionName + '(');
  const end = source.indexOf('\n$$;', start);
  assert.ok(start >= 0 && end > start);
  return source.slice(start, end + 4);
}
const actor = suffix => '00000000-0000-4000-8000-0000000000' + suffix;
const fixture = `
  create role anon;
  create role authenticated;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create table public.profiles(id uuid primary key, role text);
  create table public.school_places(id uuid, owner_id uuid, kind text, active boolean);
  create table public.shop_products(id uuid primary key, shop_id uuid, is_active boolean, unit_price_cents int, stock_quantity int, name text);
  create table public.shop_tax_configuration(singleton boolean, enabled boolean, rate_basis_points int);
  create table public.cash_sales(id uuid default gen_random_uuid(), cashier_id uuid, amount_cents int, note text);
  create table public.payment_requests(id uuid default gen_random_uuid(), cashier_id uuid, amount_cents int, note text);
  create table public.shop_sales(id uuid default gen_random_uuid(), shop_id uuid, cashier_id uuid, payment_method text, status text,
    amount_cents int, tax_rate_basis_points int, tax_cents int, cash_sale_id uuid, payment_request_id uuid, paid_at timestamptz);
  create table public.shop_sale_items(sale_id uuid, product_id uuid, quantity int, unit_price_cents int);
  create table public.shop_stock_movements(product_id uuid, delta int, reason text, created_by uuid);
  create function public.sas_is_operator() returns boolean language sql stable as $$ select auth.uid() = '${actor('03')}'::uuid $$;
  insert into public.profiles values ('${actor('01')}', 'cashier'), ('${actor('04')}', 'admin');
  insert into public.school_places values ('${actor('10')}', '${actor('01')}', 'shop', true);
  insert into public.shop_products values ('${actor('11')}', '${actor('10')}', true, 125, 4, 'Synthetic item');
  insert into public.shop_tax_configuration values (true, false, 0);
`;

test('isolated SQL keeps cash and checkout atomic and enforces actor permissions on replay', async () => {
  const db = new PGlite();
  try {
    await db.exec(fixture);
    await db.exec(legacy('schema.sql', 'record_cash_sale'));
    for (const name of ['shop_can_manage', 'shop_checkout']) await db.exec(legacy('v16_shop_inventory_tax_jobs.sql', name));
    await db.exec(file('migrations/20261127080200_sas_sale_idempotency.sql'));
    await db.exec(file('cutover/issue-59-sale-rpc.sql'));
    const uid = suffix => db.query("select set_config('request.jwt.claim.sub', $1, false)", [actor(suffix)]);
    const checkout = (suffix = '20', quantity = 1, method = 'cash') => db.query(
      'select public.shop_checkout_idempotent($1,$2,$3,$4) receipt',
      [actor('10'), JSON.stringify([{ product_id: actor('11'), quantity }]), method, actor(suffix)],
    );
    const cash = (amount = 250) => db.query('select public.record_cash_sale_idempotent($1,$2,$3) receipt', [amount, 'Synthetic note', actor('21')]);
    await db.exec('set role anon');
    await assert.rejects(checkout(), { code: '42501' });
    await db.exec('set role authenticated');
    await uid('02');
    await assert.rejects(checkout(), { code: '42501' });
    await assert.rejects(cash(), { code: '42501' });
    await uid('01');
    const receipt = (await checkout()).rows;
    assert.deepEqual((await checkout()).rows, receipt);
    await assert.rejects(checkout('20', 2), { code: '22023' });
    await assert.rejects(checkout('22', 9));
    assert.equal((await checkout('22')).rows.length, 1);
    const cashReceipt = (await cash()).rows;
    assert.deepEqual((await cash()).rows, cashReceipt);
    await assert.rejects(cash(251), { code: '22023' });
    await assert.rejects(db.query("select public.record_cash_sale(100, '')"), { code: '42501' });
    await uid('02');
    await assert.rejects(checkout(), { code: '42501' });
    await uid('03');
    const qr = (await checkout('23', 1, 'qr')).rows;
    assert.ok(qr[0].receipt.payment_request_id);
    assert.deepEqual((await checkout('23', 1, 'qr')).rows, qr);
    await uid('04');
    assert.ok((await cash()).rows[0].receipt);
    await db.exec('reset role');
    assert.deepEqual((await db.query(`select stock_quantity,
      (select count(*)::int from public.cash_sales) cash_count,
      (select count(*)::int from public.payment_requests) qr_count
      from public.shop_products`)).rows, [{ stock_quantity: 2, cash_count: 4, qr_count: 1 }]);
  } finally {
    await db.close();
  }
});

test('SQL login quota protects the global and per-alias budgets and exposes no client grant', async () => {
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(file('migrations/20261127080100_sas_login_quota.sql'));
    const grants = await db.query(`select array(
      select has_function_privilege(role, 'public.sas_consume_login_quota(text)', 'execute')
      from unnest(array['anon', 'authenticated', 'service_role']) role
    ) acl`);
    assert.deepEqual(grants.rows[0].acl, [false, false, true]);
    // Put the shared counter close to the limit and keep the synthetic window
    // fixed across a wall-clock minute boundary.
    await db.exec(`update sas_login_guard.quota
      set window_start = date_trunc('minute', clock_timestamp()) + interval '1 minute', attempts = 1787;
      set role service_role;`);
    const use = async key => (await db.query('select public.sas_consume_login_quota($1) allowed', [key])).rows[0].allowed;
    assert.equal(await use('raw identifier'), false);
    for (let attempt = 0; attempt < 13; attempt++) assert.equal(await use('a'.repeat(64)), attempt < 12);
    assert.equal(await use('b'.repeat(64)), false);
    await db.exec("reset role; update sas_login_guard.quota set window_start = '-infinity'; set role service_role;");
    assert.equal(await use('a'.repeat(64)), true);
    await db.exec('reset role');
    const counters = await db.query('select attempts, alias_throttles, saturated_windows from sas_login_guard.quota');
    const { attempts, alias_throttles, saturated_windows } = counters.rows[0];
    assert.deepEqual([attempts, Number(alias_throttles), Number(saturated_windows)], [1, 1, 1]);
  } finally {
    await db.close();
  }
});
