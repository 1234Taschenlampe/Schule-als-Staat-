/**
 * Real production-origin browser smoke test; no login, SQL writes, accounts or bookings.
 * Exercises the actual Cloudflare HTML, live PDF proxy, deployed JS/CSS, CSP and
 * PDF.js rendering. Calls the UI with a mock catalog; never a write endpoint.
 */
import {chromium} from "playwright-core";
import {strict as assert} from "node:assert";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const BASE=process.env.RNG_PRODUCTION_BASE_URL||"https://schule-als-staat.schule-als-staat-jfe.workers.dev";
const baseUrl=new URL(BASE);
const catalog=[
 {id:"test-A003",name:"A003",floor:"Gebäude A · Erdgeschoss",plan_page:4,x_percent:41.63,y_percent:64.41,detail:"Klassenzimmer",slots:[]},
 {id:"test-D102",name:"D102",floor:"Gebäude D · 1. Obergeschoss",plan_page:5,x_percent:null,y_percent:null,detail:"Klassenraum, ungeklärte Lage",slots:[]}
];
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||"/usr/bin/google-chrome",args:["--no-sandbox"]});
const failures=[];
try{
  for(const width of [390,1280]){
    const page=await browser.newPage({viewport:{width,height:844},isMobile:width<500,hasTouch:width<500,deviceScaleFactor:2});
    const scriptErrors=[];
    const relevantNetworkErrors=[];
    page.on("pageerror",err=>{if(/shop-plan|pdf|Failed to fetch dynamically imported/i.test(err.stack||err.message))scriptErrors.push(err.message);});
    page.on("requestfailed",req=>{if(/rng-floorplan|pdfjs-dist/.test(req.url()))relevantNetworkErrors.push(req.url()+" "+req.failure()?.errorText);});
    const landing=await page.goto(baseUrl.href,{waitUntil:"domcontentloaded",timeout:30000});
    assert.equal(landing.status(),200,"public homepage status");
    const headers=landing.headers();
    assert.match(headers["content-security-policy"]||"",/cdn\.jsdelivr\.net/,"live CSP permits PDF.js CDN");
    await page.waitForFunction(()=>Boolean(window.SAS_SHOP_PLAN?.show),{timeout:20000});
    const script=await page.request.get(new URL("/shop-plan.js",BASE).href);
    const style=await page.request.get(new URL("/shop-plan.css",BASE).href);
    assert.equal(script.status(),200);
    assert.equal(style.status(),200);
    assert.match(script.headers()["content-type"]||"",/javascript/);
    assert.match(style.headers()["content-type"]||"",/css/);
    assert.equal(await script.text(),readFileSync(resolve(ROOT,"shop-plan.js"),"utf8"),"production JS matches repository");
    assert.equal(await style.text(),readFileSync(resolve(ROOT,"shop-plan.css"),"utf8"),"production CSS matches repository");
    const pdfResponse=await page.request.get(new URL("/rng-floorplan.pdf",BASE).href,{timeout:30000});
    assert.equal(pdfResponse.status(),200,"production proxy must return PDF");
    assert.match(pdfResponse.headers()["content-type"]||"",/application\/pdf/);
    const pdfBytes=await pdfResponse.body();
    assert.equal(pdfBytes.subarray(0,5).toString("ascii"),"%PDF-","valid original PDF header");
    await page.evaluate(async data=>{
      const target=document.createElement("main");
      target.id="rng-smoke-isolated";
      document.body.prepend(target);
      await window.SAS_SHOP_PLAN.show({
        target,
        api:{rpc:async name=>{
          if(name==="shop_room_catalog")return {data};
          throw Error("Write RPC prohibited in production smoke: "+name);
        }},
        user:{id:"qa-synthetic-no-account"},profile:{role:"citizen"}
      });
    },catalog);
    const root=page.locator("#rng-smoke-isolated");
    assert.equal(await root.locator(".sas-shopmap-floors button[data-page]").count(),7);
    for(const [n,count] of [[3,7],[4,37],[5,39],[6,27],[7,5]]){
      await root.locator('button[data-page="'+n+'"]').click();
      assert.equal(await root.locator(".sas-shopmap-pins button").count(),count,"original geometric markers on page "+n);
      await root.locator("#rng-plan-status").getByText(new RegExp("Originalplan · Seite "+n+" von 7")).waitFor({state:"visible",timeout:30000});
      assert.equal(await root.locator("#rng-floorplan-canvas").evaluate(c=>c.width>500&&c.height>500),true,
        "original PDF canvas should render on page "+n);
    }
    await root.locator('button[data-page="7"]').click();
    await root.locator('button[data-room="plan:A302:7"]').first().click();
    assert.equal(await root.locator('button[data-slot]').count(),0,"non-bookable art room");
    await root.locator('button[data-page="4"]').click();
    await root.locator('button[data-room="test-A003"]').first().click();
    assert.equal(await root.locator('button[data-slot]').count(),4);
    await root.locator('input#sas-shopmap-search').fill("D102");
    assert.equal(await root.locator('.sas-shopmap-roomlist button[data-room="test-D102"]').count(),1);
    await root.locator('button[data-page="5"]').click();
    await root.locator('input#sas-shopmap-search').fill("D102");
    await root.locator('.sas-shopmap-roomlist button[data-room="test-D102"]').click();
    assert.match(await root.locator(".sas-shopmap-anomaly").innerText(),/D105/);
    const fitWidth=await root.locator("#rng-plan-holder").evaluate(el=>el.getBoundingClientRect().width);
    await root.locator('button[data-map-zoom="in"]').click();
    assert.ok((await root.locator("#rng-plan-holder").evaluate(el=>el.getBoundingClientRect().width))>fitWidth);
    await root.locator('button[data-map-zoom="fit"]').click();
    assert.equal(await root.locator("#rng-zoom-label").innerText(),"100%");
    if(width===390){
      assert.ok((await root.locator(".sas-shopmap-floors").boundingBox()).width<=width,"mobile controls do not overflow");
    }
    assert.deepEqual(scriptErrors,[],"no PDF/room-plan script errors");
    assert.deepEqual(relevantNetworkErrors,[],"no PDF loading failures");
    await page.screenshot({path:resolve(ROOT,"rng-production-"+width+".png"),fullPage:true});
    console.log("PASS: production-origin "+width+"px, 7 PDF pages, 115 markers, controls, JS/CSS hash, no write RPC");
    await page.close();
  }
}catch(e){failures.push(e);throw e;}finally{await browser.close();}
