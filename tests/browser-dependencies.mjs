import {readFileSync} from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
const read=name=>readFileSync(new URL(name,import.meta.url),"utf8");

test("CDN package versions match the audited lockfile",()=>{
  const html=read("../index.html");
  const sources=html+"\n"+read("../shop-plan.js");
  const packages=new Map();
  for(const match of sources.matchAll(/https:\/\/cdn\.jsdelivr\.net\/npm\/((?:@[\w-]+\/)?[\w-]+)@([\d.]+)\//g)){
    if(packages.has(match[1]))assert.equal(packages.get(match[1]),match[2]);
    packages.set(match[1],match[2]);
  }
  assert.deepEqual(Object.fromEntries(packages),JSON.parse(read("./dependencies/package.json")).dependencies);
  const lock=JSON.parse(read("./dependencies/package-lock.json"));
  for(const [name,version] of packages)assert.equal(lock.packages["node_modules/"+name].version,version);
  for(const [tag] of html.matchAll(/<script\b[^>]+src="https:\/\/cdn\.jsdelivr\.net[^>]+>/g)){
    assert.match(tag,/integrity="sha384-[A-Za-z0-9+/]{64}"/);
    assert.match(tag,/crossorigin="anonymous"/);
  }
});
