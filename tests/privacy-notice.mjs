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
  assert.match(html, /sas-privacy-promise/);
  assert.match(html, /Nach dem Projekt werden alle nicht mehr benötigten personenbezogenen Projektdaten gelöscht/);
  assert.match(html, /Geplanter Löschabschluss: 31. Juli 2027/);
  assert.match(html, /unmittelbar nach ihrer Verwendung zu löschen/);
  assert.match(html, /technische Löschung einschließlich der Prüfung von Backups ist noch nicht automatisiert/);
  assert.match(html, /Was bleibt für die Auswertung übrig/);
  assert.match(html, /Verantwortlichkeit.*?Rechtsgrundlagen.*?Löschfristen/s);
  assert.match(html, /diese eigenständige Projektwebseite/i);
  assert.match(html, /Verantwortlichkeit der Projektwebseite: in Prüfung/);
  assert.match(html, /Projektteam „Schule als Staat“/);
  assert.doesNotMatch(html, /Schulischer Datenschutzkontakt:/);
});
test("privacy link stays visible across login and app pages", () => {
  const index = read("index.html");
  assert.match(index, /<footer class="sas-site-footer"/);
  assert.match(index, /href="\/datenschutz\.html"/);
  assert.match(index, /href="\/nutzungsregeln\.html"/);
  assert.match(index, /position:relative;z-index:1;background:#111820/);
  assert.doesNotMatch(index, /sas-legal-link/);
  assert.match(index, /@media\(max-width:780px\).*?sas-site-footer/s);
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