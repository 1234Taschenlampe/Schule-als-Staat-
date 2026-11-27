import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const source = readFileSync(new URL('../sale-retry.js', import.meta.url), 'utf8');

function load(storage) {
  const window = {};
  runInNewContext(source, {
    window, TextEncoder, crypto,
    sessionStorage: {
      getItem: key => storage.get(key),
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
  });
  return window.SAS_SALE_RETRY;
}

test('an interrupted sale reuses its request ID after reload and a confirmed sale can be repeated intentionally', async () => {
  const storage = new Map();
  const args = { p_amount_cents: 125, p_note: 'synthetic note' };
  let key;
  await assert.rejects(load(storage)(async (_, input) => {
    key = input.p_request_id;
    throw Error('connection lost after committing');
  }, 'actor-a', 'record_cash_sale_idempotent', args));
  assert.equal(storage.size, 1);
  assert.equal(await load(storage)(async (_, input) => input.p_request_id, 'actor-a', 'record_cash_sale_idempotent', args), key);
  assert.equal(storage.size, 0);
  assert.notEqual(await load(storage)(async (_, input) => input.p_request_id, 'actor-a', 'record_cash_sale_idempotent', args), key);
});

test('concurrent identical browser calls share one pending request', async () => {
  const sale = load(new Map());
  let resolve;
  const started = new Promise(done => { resolve = done; });
  let attempts = 0;
  const submit = async () => {
    attempts++;
    await started;
    return 'receipt';
  };
  const args = { p_amount_cents: 25 };
  const calls = [1, 2].map(() => sale(submit, 'actor-a', 'record_cash_sale_idempotent', args));
  await new Promise(done => setTimeout(done, 20));
  resolve();
  assert.deepEqual(await Promise.all(calls), ['receipt', 'receipt']);
  assert.equal(attempts, 1);
});
