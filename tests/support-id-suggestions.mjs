import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const app=read("app.js"),html=read("index.html"),css=read("styles.css");

// Execute the real pure suggestion function in isolation without fetching student data.
const start=app.indexOf("  function supportIdCandidates(value,users){");
const end=app.indexOf("  function updateSupportSuggestions(){",start);
assert.ok(start>=0&&end>start,"Support candidate helper must exist");
const supportIdCandidates=vm.runInNewContext(app.slice(start,end)+"\nsupportIdCandidates;");
const users=[
  ...Array.from({length:14},(_,n)=>({login_id:"SAS-"+String(610100+n).padStart(6,"0"),role:"member"})),
  {login_id:"SAS-620777",role:"cashier"},
  {login_id:"SAS-610999",role:"admin"},
  {login_id:"SAS-X123456789",role:"member"},
  {login_id:"SAS-100111",role:"member"},
  {login_id:"SAS-610045",role:"member"}
];

test("six-digit suggestions are real, ordered and limited to ten",()=>{
  const values=Array.from(supportIdCandidates("6101",users));
  assert.equal(values.length,10);
  assert.deepEqual(values,Array.from({length:10},(_,n)=>String(610100+n)));
  assert.ok(values.every(id=>users.some(u=>u.login_id==="SAS-"+id)));
});

test("no public enumeration on blank or single-digit input",()=>{
  for(const input of ["","6","SAS-6","abc","6%","6101 OR 1=1"]){
    assert.deepEqual(Array.from(supportIdCandidates(input,users)),[],input);
  }
});

test("supports both optional SAS prefix and a complete six-digit ID",()=>{
  assert.deepEqual(Array.from(supportIdCandidates("SAS-620",users)),["620777"]);
  assert.deepEqual(Array.from(supportIdCandidates("620777",users)),["620777"]);
  assert.deepEqual(Array.from(supportIdCandidates("620778",users)),[]);
});

test("suggestions exclude administrator IDs, preserve valid cashier accounts",()=>{
  assert.equal(Array.from(supportIdCandidates("610",users)).includes("610999"),false);
  assert.deepEqual(Array.from(supportIdCandidates("620",users)),["620777"]);
});

test("admin-only UI: suggestion selects a value and invokes existing lookup, not reset",()=>{
  assert.match(app,/state\.profile\?\.role==="admin"&&state\.page==="itsupport"/);
  assert.match(app,/suggestion&&state\.page==="itsupport"&&state\.profile\?\.role==="admin"/);
  assert.match(app,/data-support-suggest=/);
  assert.match(app,/supportForm\.requestSubmit\(\)/);
  assert.match(app,/supportRequest\("lookup",lookup,false\)/);
  assert.match(app,/data\.get\("identity_checked"\)==="on"/);
  assert.match(app,/if\(oldResult\)oldResult\.hidden=true/);
  assert.doesNotMatch(app,/supportRequest\("qr",suggested/);
});

test("all existing recovery markers and responsive controls remain",()=>{
  new vm.Script(app,{filename:"app.js"});
  const scriptVersion=html.match(/<script defer src="\.\/app\.js\?v=([0-9]{8}-[a-z0-9-]+)"><\/script>/)?.[1];
  assert.ok(scriptVersion,"Versioned app.js is required");
  assert.ok(Number(scriptVersion.slice(0,8))>=20261110,"app.js cache version must not regress");
  assert.match(html,/styles\.css\?v=20261110-support-suggest/);
  assert.match(css,/\.sas-support-suggestions\{display:grid/);
  assert.match(css,/min-height:48px/);
  assert.match(app,/aria-autocomplete="list"/);
  assert.match(app,/aria-controls="sas-support-suggestions"/);
});
