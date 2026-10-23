import { chromium } from "playwright-core";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import assert from "node:assert/strict";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const mockCatalog=[
 {id:"class-A003",name:"A003",floor:"Gebäude A · Erdgeschoss",plan_page:4,
  x_percent:41.63,y_percent:64.41,detail:"Klassenraum",slots:[]},
 {id:"class-D102",name:"D102",floor:"Gebäude D · 1. Obergeschoss",plan_page:5,
  x_percent:null,y_percent:null,detail:"Klassenraum",slots:[]}
];
const server=createServer((req,res)=>{
 const path=new URL(req.url||"/", "http://localhost").pathname;
 let body,type;
 try {
  if(path==="/"){body=Buffer.from('<!doctype html><html lang="de"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="map"></main><script src="/shop-plan.js"></script><link rel="stylesheet" href="/shop-plan.css"></body></html>');type="text/html";}
  else if(path==="/rng-floorplan.pdf"){body=readFileSync(resolve(root,"rng-floorplan.pdf"));type="application/pdf";}
  else if(["/shop-plan.js","/shop-plan.css"].includes(path)){body=readFileSync(resolve(root,path.slice(1)));type=path.endsWith(".css")?"text/css":"application/javascript";}
  else {res.writeHead(404);res.end("Not found");return;}
  res.writeHead(200,{"Content-Type":type,"Cache-Control":"no-store"});res.end(body);
 } catch(e){res.writeHead(500);res.end(String(e));}
});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||"/usr/bin/google-chrome",args:["--no-sandbox"]});
const errors=[];
try {
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:844},isMobile:width===390,hasTouch:width===390,deviceScaleFactor:2});
  page.on("pageerror",e=>errors.push(width+": "+e.message));
  await page.goto("http://127.0.0.1:"+server.address().port);
  await page.waitForFunction(()=>Boolean(window.SAS_SHOP_PLAN),{timeout:10000});
  await page.evaluate(async catalog=>window.SAS_SHOP_PLAN.show({
    target:document.querySelector("#map"),
    api:{rpc:async name=>name==="shop_room_catalog"?{data:catalog}:{data:null}},
    user:{id:"test-id"},
    profile:{role:"student"}
  }),mockCatalog);
  assert.equal(await page.locator(".sas-shopmap-floors button[data-page]").count(),7);
  for(const [n,count] of [[1,5],[2,0],[3,7],[4,37],[5,39],[6,27],[7,5]]){
    await page.locator('button[data-page="'+n+'"]').click();
    const actual=await page.locator(".sas-shopmap-pins button").count();
    assert.equal(actual,count,"page "+n+" at "+width+"px");
  }
  await page.locator('button[data-room="plan:A302:7"]').first().click();
  assert.match(await page.locator(".sas-shopmap-readonly-info").innerText(),/keine Shops gebucht|keine Shops gebucht werden|keine Shops gebucht/i);
  assert.equal(await page.locator(".sas-shopmap-slots button[data-slot]").count(),0);
  await page.locator('button[data-page="4"]').click();
  await page.locator('button[data-room="class-A003"]').first().click();
  assert.equal(await page.locator(".sas-shopmap-slots button[data-slot]").count(),4);
  await page.locator("#sas-shopmap-search").fill("D102");
  assert.equal(await page.locator('.sas-shopmap-roomlist button[data-room="class-D102"]').count(),1,
    "search across all houses must ignore currently selected room's building");
  await page.locator('button[data-page="5"]').click();
  assert.equal(await page.locator(".sas-shopmap-pins button").count(),39,
    "floor switch must reset incidental building filter");
  await page.locator('#sas-shopmap-search').fill("D102");
  await page.locator('button[data-room="class-D102"]').first().click();
  assert.match(await page.locator(".sas-shopmap-anomaly").innerText(),/D105/);
  assert.equal(await page.locator('.sas-shopmap-pins button[data-room="class-D102"]').count(),0);
  if(width===390){
    const scroll=page.locator("#rng-plan-scroll"),holder=page.locator("#rng-plan-holder");
    const initial=await holder.evaluate(el=>el.getBoundingClientRect().width);
    await page.locator('button[data-map-zoom="in"]').click();
    const after=await holder.evaluate(el=>el.getBoundingClientRect().width);
    assert.ok(after>initial,"mobile zoom increases map and pin layer width");
    assert.ok(await scroll.evaluate(el=>el.scrollWidth>el.clientWidth),"mobile map can pan horizontally");
    await page.locator('button[data-map-zoom="fit"]').click();
    assert.equal(await page.locator("#rng-zoom-label").innerText(),"100%");
    assert.ok((await page.locator(".sas-shopmap-floors").boundingBox()).width<=width);
  }
  await page.screenshot({path:resolve(root,"rng-mobile-"+width+".png"),fullPage:true});
  await page.close();
  console.log("RNG viewport "+width+"px: seven pages, pins, booking isolation, zoom and D102 verified");
 }
 assert.deepEqual(errors,[]);
} finally {
 await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
