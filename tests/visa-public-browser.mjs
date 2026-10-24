import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname,resolve} from "node:path";
import {chromium} from "playwright-core";

const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const visaSource=readFileSync(resolve(root,"public-visa.js"),"utf8");
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||"/usr/bin/google-chrome",args:["--no-sandbox"]});
try {
 for(const width of [390,1280]){
  const page=await browser.newPage({viewport:{width,height:820},isMobile:width===390,hasTouch:width===390});
  const errors=[];
  page.on("pageerror",e=>errors.push(e.message));
  await page.goto("about:blank");
  await page.setContent('<!doctype html><html lang="de"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');
  await page.addScriptTag({content:visaSource});

  // The real production settings currently disable email/Turnstile/payment.
  await page.evaluate(async()=>{
    let root=document.getElementById("root");
    root.innerHTML=window.SAS_PUBLIC_VISA.form();
    await window.SAS_PUBLIC_VISA.showPublic({rpc:async()=>({data:{email_enabled:false,payment_enabled:false,turnstile_site_key:null}})},root);
  });
  assert.equal(await page.locator("#visa-apply").isDisabled(),true);
  assert.match(await page.locator("#visa-availability").textContent(),/E-Mail-Versand/);
  assert.equal(await page.locator("#visa-turnstile-container iframe").count(),0);

  // Invalid token must not call a server and must render a visible error.
  let calls=await page.evaluate(async()=>{
    let n=0;
    await window.SAS_PUBLIC_VISA.showVerification({rpc:async()=>{n++;throw Error("must not be called");}},document.getElementById("root"),"BAD");
    return n;
  });
  assert.equal(calls,0);
  assert.match(await page.locator("#visa-stage-message").textContent(),/Ungültiger Bestätigungslink/);

  const token="a".repeat(64);
  // Valid, verified email without configured payment: display info, no payment button.
  await page.evaluate(async token=>{
    await window.SAS_PUBLIC_VISA.showVerification({rpc:async()=>({data:{verified:true,payment_enabled:false}})},document.getElementById("root"),token);
  },token);
  assert.match(await page.locator("#visa-stage-message").textContent(),/E-Mail-Adresse ist bestätigt/);
  assert.equal(await page.locator("#visa-stage-actions button").count(),0);

  // Valid, verified email and a server-advertised payment window: server errors
  // must be handled without taking payment or navigating to a third-party URL.
  await page.evaluate(async token=>{
    const api={rpc:async()=>({data:{verified:true,payment_enabled:true,price_cents:500}}),
      functions:{invoke:async name=>{
        if(name!=="visa-create-checkout")throw Error("wrong function");
        return {error:{message:"Checkout gerade gesperrt"}};
      }}};
    await window.SAS_PUBLIC_VISA.showVerification(api,document.getElementById("root"),token);
  },token);
  assert.equal(await page.locator("#visa-stage-actions button").count(),1);
  assert.match(await page.locator("#visa-stage-actions").innerText(),/5,00/);
  await page.locator("#visa-stage-actions button").click();
  assert.match(await page.locator("#visa-stage-actions p[role=status]").innerText(),/Checkout gerade gesperrt/);
  assert.equal(await page.locator("#visa-stage-actions button").isEnabled(),true);

  // Even a compromised backend response must not cause a redirect to an
  // untrusted host. No Stripe request is made in this regression test.
  await page.evaluate(async token=>{
    const api={rpc:async()=>({data:{verified:true,payment_enabled:true,price_cents:500}}),
      functions:{invoke:async()=>({data:{url:"https://not-stripe.example/phish"}})}};
    await window.SAS_PUBLIC_VISA.showVerification(api,document.getElementById("root"),token);
  },token);
  await page.locator("#visa-stage-actions button").click();
  assert.match(await page.locator("#visa-stage-actions p[role=status]").innerText(),/kein gültiges Zahlungsziel/);
  assert.equal(page.url(),"about:blank");

  // External payment return is explicitly only pending verification, not paid.
  await page.evaluate(()=>window.SAS_PUBLIC_VISA.showPaidRedirect(document.getElementById("root")));
  assert.match(await page.locator("#visa-stage-message").innerText(),/serverseitig/);
  assert.doesNotMatch(await page.locator("#visa-stage-message").innerText(),/erfolgreich bezahlt/);
  assert.deepEqual(errors,[]);
  console.log("PASS Visa guest onboarding at "+width+"px: disabled config, verification, checkout error, safe redirect, return stage");
  await page.close();
 }
}finally{await browser.close();}
