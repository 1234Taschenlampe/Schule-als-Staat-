import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync,statSync} from "node:fs";

const root=new URL("../",import.meta.url);
for(let i=1;i<=7;i++){
  const name="assets/flags/entwurf-"+String(i).padStart(2,"0")+".webp";
  test(name+" is a real WebP image",()=>{
    const url=new URL(name,root);
    assert.ok(statSync(url).size>10000,"Flag images must not be placeholders");
    const header=readFileSync(url).subarray(0,12);
    assert.equal(header.toString("ascii",0,4),"RIFF");
    assert.equal(header.toString("ascii",8,12),"WEBP");
  });
}
test("Worker and static builder both serve flag images locally",()=>{
  const build=readFileSync(new URL("scripts/build-worker.mjs",root),"utf8");
  const stat=readFileSync(new URL("scripts/build-static.sh",root),"utf8");
  assert.match(build,/flagImageAssets/);
  assert.match(build,/path in FLAG_ASSETS/);
  assert.ok(stat.includes("cp assets/flags/entwurf-*.webp _site/assets/flags/"));
});
