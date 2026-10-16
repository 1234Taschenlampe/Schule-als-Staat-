/**
 * Schule als Staat: 10 disposable password test accounts.
 * One-time administrator script, never served on the website.
 * Requires: Node.js >=18, SUPABASE_SECRET_KEY in the local environment.
 * Usage: node scripts/create-test-accounts.mjs --confirm-create
 */
import { randomBytes } from 'node:crypto';
import { openSync, writeSync, closeSync } from 'node:fs';
import { resolve } from 'node:path';

const projectUrl = process.env.SUPABASE_URL || 'https://wdebwgcferieedkpqbvk.supabase.co';
const secretKey = process.env.SUPABASE_SECRET_KEY;
const hostname = new URL(projectUrl).hostname;
if (process.argv.includes('--help')) {
  console.log('Usage: SUPABASE_SECRET_KEY=<secret> node scripts/create-test-accounts.mjs --confirm-create');
  process.exit(0);
}
if (!process.argv.includes('--confirm-create')) throw Error('Nicht ausgeführt: --confirm-create fehlt.');
if (!secretKey || secretKey.startsWith('sb_publishable_')) throw Error('SUPABASE_SECRET_KEY muss ein geheimer Supabase-Admin-Schlüssel sein.');
if (!/^https:\/\/[a-z0-9.-]+$/.test(projectUrl) || !hostname.endsWith('.supabase.co')) {
  throw Error('Unerwartete Supabase-Projekt-URL.');
}

const authHeaders = { apikey: secretKey, 'Content-Type': 'application/json' };
// Legacy service_role keys are JWTs; new sb_secret keys belong only in apikey.
if (secretKey.split('.').length === 3 && !secretKey.startsWith('sb_')) authHeaders.Authorization = `Bearer ${secretKey}`;
const csvEscape = value => `"${String(value).replaceAll('"','""')}"`;
const stamp = new Date().toISOString().replaceAll(':','-').replaceAll('.','-');
const outfile = resolve(`schule-als-staat-testkonten-${stamp}.csv`);
// Exclusive creation: never overwrite a previous credential file.
const file = openSync(outfile, 'wx', 0o600);
writeSync(file, 'Nummer;E-Mail;Passwort;Rolle;Supabase-ID\n');
console.log('Zugangsdaten werden ausschließlich lokal gespeichert:', outfile);

async function jsonRequest(path, method, data, moreHeaders = {}) {
  const response = await fetch(`${projectUrl}${path}`, {
    method, headers: { ...authHeaders, ...moreHeaders },
    body: data === undefined ? undefined : JSON.stringify(data),
    signal: AbortSignal.timeout(15000)
  });
  const raw = await response.text();
  let body;
  try { body = raw ? JSON.parse(raw) : null; } catch { body = { message: 'Unlesbare Serverantwort' }; }
  if (!response.ok) {
    throw Error(`Supabase ${response.status} (${path.split('?')[0]}): ${body?.msg || body?.message || body?.error_description || body?.code || 'Unbekannter Fehler'}`);
  }
  return body;
}

let createdCount = 0;
try {
  for (let n = 1; n <= 10; n++) {
    const number = String(n).padStart(2, '0');
    const email = `sas-test${number}@example.com`;
    const password = randomBytes(24).toString('base64url');
    const role = n === 1 ? 'admin' : n === 2 ? 'cashier' : 'member';
    // Supabase Admin API bypasses confirmation without sending mail.
    const result = await jsonRequest('/auth/v1/admin/users','POST',{
      email, password, email_confirm: true,
      user_metadata: { full_name: `Testkonto ${number}`, test_account: true }
    });
    const userId = result?.id || result?.user?.id;
    if (!userId) throw Error(`Benutzer ${number} angelegt, aber ohne bestätigte ID zurückgegeben.`);
    // Persist the credentials BEFORE the role update, so a partial failure is recoverable.
    writeSync(file, [number,email,password,role,userId].map(csvEscape).join(';') + '\n');
    createdCount++;
    const updated = await jsonRequest(`/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}`,'PATCH',{
      role, vote_eligible: n !== 10
    },{ Prefer: 'return=representation' });
    if (!Array.isArray(updated) || updated.length !== 1 || updated[0].role !== role || updated[0].vote_eligible !== (n !== 10)) {
      throw Error(`Rolle oder Stimmberechtigung für ${email} konnte nicht bestätigt werden.`);
    }
    console.log(`${number}/10: ${email} – ${role} angelegt, Rolle überprüft.`);
  }
  console.log('Fertig: 10 Testkonten, keine E-Mails verschickt. Nur lokale CSV enthält Passwörter.');
} catch (e) {
  console.error(`Abbruch nach ${createdCount} angelegten Konten: ${e.message}`);
  console.error('Bereits angelegte Konten NICHT blind neu anlegen. Zugangsdaten stehen in:', outfile);
  process.exitCode = 1;
} finally {
  closeSync(file);
}
