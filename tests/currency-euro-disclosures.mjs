import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync} from "node:fs";
const read=(name)=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const app=read("app.js"),privacy=read("datenschutz.html"),terms=read("nutzungsregeln.html"),index=read("index.html");
test("school currency is distinct from euro but can have real financial cost",()=>{
 for(const source of [app,privacy,terms]){
  assert.match(source,/Schulwährung/);
  assert.match(source,/Euro/);
  assert.doesNotMatch(source,/kein Echtgeld|kein echtes Geld|nicht um echtes Geld|Kein Bank- oder Echtgeldsystem/i);
 }
 assert.match(app,/Guthaben hat damit einen realen finanziellen Bezug/);
 assert.match(app,/Schulwährung · mit Euro erwerbbar/);
 assert.match(terms,/tatsächliche finanzielle Nachteile/);
 assert.match(privacy,/finanziellen Bezug/);
});
test("delete requests never waive cash-linked refund or repayment rights",()=>{
 assert.match(app,/Ein Löschantrag lässt solche Ansprüche nicht automatisch entfallen/);
 assert.match(app,/der Löschantrag ist kein Verzicht darauf/);
 assert.doesNotMatch(app,/Eine Auszahlung in Euro findet nicht statt/);
});
test("no fabricated online euro purchase is promised",()=>{
 assert.match(terms,/Ein automatischer Rücktausch in Euro wird durch die Webseite nicht zugesagt/);
 assert.match(terms,/Wechselkurs, Ausgabe, Nutzung und Bedingungen/);
 assert.match(privacy,/etwaigen Euro-Erwerb außerhalb der Webseite/);
 assert.match(index,/supabase/);
});
