import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createServer} from "node:http";
import {resolve,extname} from "node:path";
import {chromium} from "playwright";

const root=resolve(import.meta.dirname,"..");
const app=readFileSync(resolve(root,"app.js"),"utf8");
const html=readFileSync(resolve(root,"index.html"),"utf8");
const css=readFileSync(resolve(root,"mobile-ui.css"),"utf8");
const build=readFileSync(resolve(root,"scripts/build-worker.mjs"),"utf8");
const mockSdk="(()=>{\n  const identity={id:\"72a34a2a-33bc-473a-8322-c827401f51e1\",email:\"beispiel@example.test\",app_metadata:{}};\n  function query(table){\n    const q={select(){return q},eq(){return q},order(){return q},limit(){return q},\n      single(){return Promise.resolve({data:table===\"profiles\"?{id:identity.id,display_name:\"Beispiel Bürger\",role:\"member\",vote_eligible:true,school_verified_at:null}:{balance_cents:0},error:null})},\n      then(resolve,reject){return Promise.resolve({data:[],error:null}).then(resolve,reject)}\n    };return q;\n  }\n  const auth={\n    getSession:async()=>({data:{session:window.__mockLoggedIn?{user:identity,access_token:\"fake-not-real\"}:null},error:null}),\n    onAuthStateChange(){return{data:{subscription:{unsubscribe(){}}}}},\n    getUser:async()=>({data:{user:identity},error:null})\n  };\n  const api={auth,from:query,rpc:async(name)=>({data:name===\"my_school_roles\"?{operator:false,jobs:[]}:[],error:null})};\n  window.supabase={createClient:()=>api};\n})();";

test("UI source has no manual refresh buttons or fake live status",()=>{
 assert.doesNotMatch(app,/btn\("Aktualisieren","reload"/);
 assert.doesNotMatch(app,/data-action="overlord-refresh"/);
 assert.doesNotMatch(app,/Daten auf Abruf|Live-Auswertung|Live-Daten/);
 assert.doesNotMatch(app,/id==="reload"/);
 assert.match(app,/lastResumeRefresh/);
 assert.match(app,/overlordRefresh/);
 assert.match(app,/Mit Passwort anmelden/);
});
test("mobile stylesheet comes after feature CSS and is bundled",()=>{
 assert.match(html,/viewport-fit=cover/);
 assert.ok(html.lastIndexOf('href="./mobile-ui.css"')>html.lastIndexOf('href="./tutorial.css"'));
 assert.match(build,/"mobile-ui\.css"/);
 assert.match(css,/@media \(max-width: 780px\)/);
 assert.match(css,/env\(safe-area-inset-bottom\)/);
 assert.match(css,/font-size: 16px/);
 assert.doesNotMatch(css,/linear-gradient|animation:.*infinite/i);
});
async function withBrowser(callback){
 const server=createServer((req,res)=>{
   const path=decodeURIComponent(new URL(req.url,"http://localhost").pathname);
   const name=path==="/"?"/index.html":path;
   if(!/^\/[A-Za-z0-9._-]+$/.test(name)){res.writeHead(404);res.end();return;}
   try{
     const data=readFileSync(resolve(root,name.slice(1)));
     const type=({".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"application/javascript; charset=utf-8"})[extname(name)]||"text/plain";
     res.writeHead(200,{"content-type":type,"cache-control":"no-store"});res.end(data);
   }catch{res.writeHead(404);res.end();}
 });
 await new Promise(done=>server.listen(0,"127.0.0.1",done));
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{return await callback(browser,"http://127.0.0.1:"+server.address().port);}
 finally{await browser.close();await new Promise(done=>server.close(done));}
}
async function openPage(browser,origin,width,loggedIn){
 const context=await browser.newContext({viewport:{width,height:812},deviceScaleFactor:1,isMobile:true,hasTouch:true,colorScheme:"light"});
 const page=await context.newPage();
 const errors=[];
 page.on("pageerror",error=>errors.push(String(error)));
 await page.addInitScript(value=>{window.__mockLoggedIn=value;},loggedIn);
 await page.route("https://cdn.jsdelivr.net/**",route=>{
   if(route.request().url().includes("supabase.min.js"))
     return route.fulfill({status:200,contentType:"application/javascript",body:mockSdk});
   return route.fulfill({status:200,contentType:"application/javascript",body:""});
 });
 await page.goto(origin,{waitUntil:"domcontentloaded",timeout:20000});
 if(loggedIn){
   await page.locator(".bottom-nav").waitFor({state:"visible",timeout:15000});
   await page.locator(".dashboard-intro h1").waitFor({state:"visible",timeout:15000});
 }else await page.locator("#password-login-form").waitFor({state:"visible",timeout:15000});
 return {context,page,errors};
}
test("phone layouts fit without horizontal scroll or inaccessible navigation",async()=>{
 await withBrowser(async(browser,origin)=>{
  for(const width of [320,375,390,430,768]){
   for(const loggedIn of [false,true]){
    const {context,page,errors}=await openPage(browser,origin,width,loggedIn);
    const size=await page.evaluate(()=>({
      documentWidth:document.documentElement.scrollWidth,
      viewportWidth:document.documentElement.clientWidth,
      bodyWidth:document.body.scrollWidth,
      hasRefresh:[...document.querySelectorAll("button")].some(b=>/^\s*(Aktualisieren|Refresh)\s*$/i.test(b.textContent)),
      bottomVisible:!!document.querySelector(".bottom-nav") && getComputedStyle(document.querySelector(".bottom-nav")).display!=="none"
    }));
    assert.ok(size.documentWidth<=size.viewportWidth+1,"horizontal overflow at "+width+": "+JSON.stringify(size));
    assert.ok(size.bodyWidth<=size.viewportWidth+1,"body overflow at "+width+": "+JSON.stringify(size));
    assert.equal(size.hasRefresh,false,"Redundant refresh button at "+width);
    if(loggedIn){
      assert.equal(size.bottomVisible,true);
      const tabs=page.locator(".bottom-nav .bottom-button");
      assert.equal(await tabs.count(),5);
      for(let i=0;i<5;i++){
        const rect=await tabs.nth(i).boundingBox();
        assert.ok(rect&&rect.width>=39&&rect.height>=44,"small touch target at "+width);
        assert.ok(rect.y+rect.height<=812,"bottom navigation out of viewport");
      }
      await page.locator('.bottom-nav [data-nav="apps"]').click();
      await page.locator(".module-grid .module-tile").first().waitFor({state:"visible",timeout:9000});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      assert.ok(overflow<=1,"overflow after app navigation at "+width);
    }else{
      const rect=await page.locator("#password-login-form").boundingBox();
      assert.ok(rect&&rect.width<=width-20,"login wider than viewport at "+width);
    }
    assert.deepEqual(errors,[],"Browser errors at "+width+" loggedIn="+loggedIn);
    await context.close();
   }
  }
 });
});
