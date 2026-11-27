import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { boundedText } from '../supabase/functions/_shared/body.js';

const source = readFileSync(new URL('../supabase/functions/sas-login-short/index.ts', import.meta.url), 'utf8');
const endpoint = stripTypeScriptTypes(source.replace(/^import .*supabase-js.*;$/m, '').replace(/^import .*boundedText.*;$/m, ''));

async function login({ alias = 'SAS-123456', allowed = true, roster = null, secret = 'x'.repeat(32), quotaError = null, password = 'synthetic password', rawBody, headers = {} } = {}) {
  const calls = [];
  let handler;
  runInNewContext(endpoint, {
    Deno: {
      env: { get: (key) => key === 'SAS_LOGIN_QUOTA_HMAC_KEY' ? secret : 'https://example.invalid' },
      serve: (callback) => { handler = callback; },
    },
    createClient: () => ({
      rpc: async (name, args) => {
        calls.push(name);
        assert.match(args.p_alias_key, /^[a-f0-9]{64}$/);
        return { data: allowed, error: quotaError };
      },
      from: (name) => {
        calls.push(name);
        const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: roster }) };
        return query;
      },
    }),
    fetch: async () => {
      calls.push('auth');
      return new Response(null, { status: 400 });
    },
    Headers, Request, Response, TextDecoder, TextEncoder, crypto, boundedText,
  });
  const response = await handler(new Request('https://example.invalid/functions/v1/sas-login-short', {
    method: 'POST',
    headers,
    body: rawBody ?? JSON.stringify({ login_id: alias, password }),
  }));
  return { status: response.status, body: await response.json(), calls };
}

test('direct Edge requests consume a quota before roster lookup', async () => {
  assert.deepEqual((await login()).calls, ['sas_consume_login_quota', 'school_roster_members', 'auth']);
  for (const [options, status] of [[{ allowed: false }, 429], [{ quotaError: {} }, 503], [{ allowed: null }, 503]]) {
    const response = await login(options);
    assert.equal(response.status, status);
    assert.deepEqual(response.calls, ['sas_consume_login_quota']);
  }
  assert.deepEqual((await login({ secret: '' })).calls, []);
});

test('known and unknown aliases have equal invalid-password responses', async () => {
  const known = await login({ roster: { login_id: 'SAS-ABCDEFGHJK' } });
  const unknown = await login({ alias: 'SAS-234567' });
  assert.deepEqual(known, unknown);
  assert.equal(known.status, 401);
});

test('oversized bodies are rejected before any database access', async () => {
  const response = await login({ alias: 'X'.repeat(2200) });
  assert.equal(response.status, 400);
  assert.deepEqual(response.calls, []);
});

test('malformed JSON, invalid UTF-8 and declared oversized bodies are rejected before quota or roster access', async () => {
  for (const options of [{ rawBody: '{' }, { rawBody: new Uint8Array([0xff]) }, { headers: { 'content-length': '2049' } }]) {
    const response = await login(options);
    assert.equal(response.status, 400);
    assert.deepEqual(response.calls, []);
  }
});

test('invalid identifier and overlong passwords never reach the database', async () => {
  for (const options of [{alias:'SAS-'+'A'.repeat(30)}, {alias:'<code>example</code>'}, {password:'x'.repeat(201)}]) {
    const response = await login(options);
    assert.equal(response.status, 401);
    assert.deepEqual(response.calls, []);
  }
  assert.equal((await login({password:'x'.repeat(30)})).status,401);
});
