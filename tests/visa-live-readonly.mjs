import {chromium} from "playwright-core";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve,dirname} from "node:path";
import assert from "node:assert/strict";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const base="https://schule-als-staat.schule-als-staat-jfe.workers.dev/";
const expected=readFileSync(resolve(root,"public-visa.js"),"utf8");
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||"/usr/bin/google-chrome",args:["--no-sandbox"]});
try {
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:840},isMobile:width===390,hasTouch:width===390});
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  const response=await page.goto(base+"#visa-onboarding",{waitUntil:"domcontentloaded",timeout:30000});
  assert.equal(response.status(),200);
  await page.locator("#visa-apply").waitFor({timeout:25000});
  await page.waitForFunction(()=>{
    const e=document.querySelector("#visa-availability");
    return e&&e.textContent&&!e.textContent.includes("Verfügbarkeit wird geprüft");
  },{timeout:25000});
  const jsResponse=await page.request.get(base+"public-visa.js");
  assert.equal(jsResponse.status(),200);
  assert.equal(await jsResponse.text(),expected,"live worker Visa script matches the GitHub source");
  const status=await page.locator("#visa-availability").innerText();
  assert.match(status,/noch nicht freigeschaltet/,"public Visa clearly explains disabled state");
  assert.match(status,/E-Mail-Versand/,"public Visa explains missing email delivery");
  assert.equal(await page.locator("#visa-apply").isDisabled(),true,
    "no application acceptance without email verification and Turnstile");
  await page.screenshot({path:resolve(root,"visa-live-onboarding-"+width+".png"),fullPage:true});

  await page.goto(base+"#visa-verify=invalid",{waitUntil:"domcontentloaded"});
  await page.locator("#visa-stage-message").waitFor({timeout:20000});
  assert.match(await page.locator("#visa-stage-message").innerText(),/Ungültiger Bestätigungslink/);
  await page.goto(base+"#visa-payment-success",{waitUntil:"domcontentloaded"});
  await page.locator("#visa-stage-message").waitFor({timeout:20000});
  assert.match(await page.locator("#visa-stage-message").innerText(),/serverseitig/);
  assert.deepEqual(errors,[],"no runtime errors in public Visa onboarding, verification or return");
  console.log("PASS: real Cloudflare Visa at "+width+"px: production JS, disabled state, verification and return page");
  await page.close();
 }
}finally{await browser.close();}
