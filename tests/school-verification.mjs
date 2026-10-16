import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const source=read("verification.js"),sql=read("supabase/v10_school_qr_verification.sql"),
  app=read("app.js"),page=read("index.html"),bundle=read("scripts/build-worker.mjs");
new vm.Script(source,{filename:"verification.js"});
new vm.Script(app,{filename:"app.js"});

test("QR verifier has student and admin views with correct permission labels",async()=>{
 const sandbox={window:{},document:{},console,Date,Array,String};
 vm.runInNewContext(source,sandbox);
 const mod=sandbox.window.SAS_VERIFICATION;
 assert.ok(mod&&mod.show&&mod.stop);
 assert.equal(Object.keys(mod.pages).length,2);
 const mk=()=>({innerHTML:"",isConnected:true,dataset:{},addEventListener:()=>{},querySelector:()=>null});
 const student=mk();
 await mod.show({page:"schoolverify",target:student,user:{id:"u1"},profile:{role:"member"},api:{rpc:async()=>({data:{verified:false},error:null})}});
 assert.match(student.innerHTML,/QR-Code erstellen/);
 assert.match(student.innerHTML,/10 Minuten/);
 const finished=mk();
 await mod.show({page:"schoolverify",target:finished,user:{id:"u1"},profile:{role:"member"},api:{rpc:async()=>({data:{verified:true,verified_at:"2026-10-16T09:00:00Z"},error:null})}});
 assert.match(finished.innerHTML,/Schulidentität bestätigt/);
 const forbidden=mk();
 await mod.show({page:"verifyadmin",target:forbidden,profile:{role:"member"},api:{rpc:async()=>{throw Error("must not query as member")}}});
 assert.match(forbidden.innerHTML,/Kein Zugriff/);
 assert.doesNotMatch(forbidden.innerHTML,/data-verify-action="confirm"/);
 const allowed=mk();
 await mod.show({page:"verifyadmin",target:allowed,profile:{role:"admin"},api:{rpc:async()=>({data:null,error:null})}});
 assert.match(allowed.innerHTML,/Kamera starten/);
 assert.match(allowed.innerHTML,/Code prüfen/);
 assert.doesNotMatch(allowed.innerHTML,/data-verify-action="confirm"/);
});

test("verification enforces review before explicit physical approval",()=>{
 assert.match(source,/review_school_verification_qr/);
 assert.match(source,/confirm_school_verification_qr/);
 assert.match(source,/verify-identity-checked/);
 assert.match(source,/p_identity_checked:true/);
 assert.match(source,/await stop\(\)/);
 assert.doesNotMatch(source,/vote_eligible\s*=/);
});

test("QR secrets hashed at rest, expire in ten minutes, are single use, and cannot assign roles",()=>{
 assert.match(sql,/extensions\.gen_random_bytes\(32\)/);
 assert.match(sql,/extensions\.digest\(v_token,'sha256'\)/);
 assert.match(sql,/expires_at/);
 assert.match(sql,/interval '10 minutes'/);
 assert.match(sql,/interval '20 seconds'/);
 assert.match(sql,/for update/);
 assert.match(sql,/delete from public\.school_verification_challenges/);
 assert.match(sql,/p\.role='admin'/);
 assert.match(sql,/school_verified_at/);
 assert.match(sql,/p_identity_checked is distinct from true/);
 assert.match(sql,/revoke all on public\.school_verification_challenges from public,anon,authenticated/);
 assert.doesNotMatch(sql,/set role='admin'/);
 assert.doesNotMatch(sql,/set vote_eligible=true/);
 assert.doesNotMatch(sql,/grant (select|insert|update|delete) on public\.school_verification_challenges/);
});

test("school verification available on same Cloudflare build and role-filtered navigation",()=>{
 assert.match(app,/\["verifyadmin","admin","settings"\]/);
 assert.match(app,/window\.SAS_VERIFICATION\.show/);
 assert.match(app,/window\.SAS_VERIFICATION\.stop/);
 assert.match(app,/state\.profile\.role==="admin"/);
 assert.match(page,/verification\.js/);
 assert.match(page,/verification\.css/);
 assert.match(bundle,/verification\.js/);
 assert.match(bundle,/verification\.css/);
});
