import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../styles.css",import.meta.url),"utf8");
test("all seven current password fields have accessible show/hide controls",()=>{
  const inputs=[...app.matchAll(/<input class="field" type="password"[^>]*\bid="([^"]+)"[^>]*>/g)];
  const buttons=[...app.matchAll(/data-password-toggle="([^"]+)"/g)];
  assert.equal(inputs.length,7);
  assert.deepEqual(buttons.map(m=>m[1]).sort(),inputs.map(m=>m[1]).sort());
  assert.match(app,/aria-label="Passwort anzeigen"/);
  assert.match(app,/type="button" class="sas-password-toggle"/);
  assert.match(app,/passwordInput\.type=reveal\?"text":"password"/);
  assert.match(app,/visibilityButton\.setAttribute\("aria-pressed"/);
  assert.match(css,/sas-password-toggle:focus-visible/);
  assert.match(css,/sas-password-input>\.field\{width:100%;padding-right:54px/);
});
test("first-login copy covers both first-issued and temporary passwords",()=>{
  assert.match(app,/Bei der ersten Anmeldung oder nach einem Reset legst du ein eigenes Passwort fest/);
  assert.doesNotMatch(app,/siebenstelliger Zugangscode/);
});
