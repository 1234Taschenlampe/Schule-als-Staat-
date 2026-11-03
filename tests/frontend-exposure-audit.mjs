import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("browser configuration contains a public Supabase key, never a privileged credential", () => {
  const config = read("config.js");
  assert.match(config, /supabaseAnonKey:\s*["']sb_publishable_[^"']+["']/);
  assert.match(config, /supabaseUrl:/);
  for (const file of ["config.js", "index.html", "app.js", "features.js", "public-visa.js"]) {
    const source = read(file);
    assert.doesNotMatch(source, /sb_secret_[A-Za-z0-9_-]{12,}|(?:sk_live_|sk_test_)[A-Za-z0-9_-]{12,}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/);
  }
});

test("project legal links are at the document bottom, not fixed over the mobile navigation", () => {
  const page = read("index.html");
  assert.match(page, /<footer class="sas-site-footer"/);
  assert.match(page, /href="\/datenschutz\.html"/);
  assert.match(page, /href="\/nutzungsregeln\.html"/);
  assert.ok(page.indexOf('<footer class="sas-site-footer"') > page.indexOf('<div id="app"'));
  assert.doesNotMatch(page, /sas-legal-link|\.sas-terms-link/);
  assert.match(page, /\.sas-site-footer\{position:relative;/);
});
