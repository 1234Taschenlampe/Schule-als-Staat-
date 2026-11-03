import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");

test("privacy notice is comprehensive and accessible without login", () => {
  const html = read("datenschutz.html");
  assert.match(html, /<title>Datenschutzhinweise/);
  assert.ok((html.match(/<section id="/g) || []).length >= 15);
  for (const section of ["verantwortung", "daten", "zwecke", "abstimmungen", "hosting", "minderjaehrige", "rechte", "speicherung", "ausland"]) {
    assert.ok(html.includes('id="' + section + '"'), "missing section: " + section);
  }
  assert.match(html, /nicht vollständig anonym/i);
  assert.match(html, /Verantwortlichkeit.*?Rechtsgrundlagen.*?Löschfristen/s);
  assert.match(html, /diese eigenständige Projektwebseite/i);
});
test("privacy link stays visible across login and app pages", () => {
  const index = read("index.html");
  assert.match(index, /<a class="sas-legal-link" href="\/datenschutz\.html"/);
  assert.match(index, /body:has\(\.bottom-nav\)/);
  assert.match(read("public-visa.js"), /<a href="\/datenschutz\.html"/);
});
test("official worker publishes notice with conservative headers", () => {
  const build = read("scripts/build-worker.mjs");
  assert.match(build, /"datenschutz\.html"/);
  assert.match(build, /'Referrer-Policy':'no-referrer'/);
  assert.match(build, /path==='\/datenschutz\.html'/);
});
test("own name is read via gated database function, not the local profile alias", () => {
  assert.match(read("app.js"), /rpc\('my_secure_school_name'/);
  assert.match(read("features.js"), /name=ctx\.profile\.display_name\|\|c\?\.display_name/);
});