import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {chromium} from "playwright";

test("actual Chromium user flow: shop owner views inventory and downloads a safe CSV at phone and iPad widths",async()=>{
 const browser=await chromium.launch({headless:true,args:["--no-sandbox"]});
 try{
  for(const width of [375,820,1024]){
   const page=await browser.newPage({viewport:{width,height:900},acceptDownloads:true});
   await page.setContent('<!doctype html><html lang="de"><meta name="viewport" content="width=device-width,initial-scale=1"><body><div id="host"></div></body></html>');
   await page.addStyleTag({content:readFileSync(resolve(import.meta.dirname,"../styles.css"),"utf8")});
   await page.addStyleTag({content:readFileSync(resolve(import.meta.dirname,"../features.css"),"utf8")});
   await page.addStyleTag({content:readFileSync(resolve(import.meta.dirname,"../mobile-ui.css"),"utf8")});
   await page.addScriptTag({path:resolve(import.meta.dirname,"../shop-management.js")});
   await page.evaluate(async()=>{
    const ownerId="fictional-owner",shopId="fictional-shop";
    const store={id:shopId,name:"Beispiel Shop",floor_label:"Haus A",owner_id:ownerId,kind:"shop"};
    const q={select(){return q},eq(){return q},then(ok){return Promise.resolve({data:[store],error:null}).then(ok)}};
    const api={from(){return q},rpc:async(name)=>({
     data:name==="shop_catalog"?{
      shop:store,products:[
       {id:"p1",name:"Brezel",price_cents:120,stock:3,active:true},
       {id:"p2",name:'=HYPERLINK("https://example.test","bad")',price_cents:150,stock:20,active:true}
      ],sales:[],tax:{enabled:false,rate_basis_points:0}
     }:null,error:null})};
    await window.SAS_SHOPS.show({target:document.getElementById("host"),api,user:{id:ownerId},profile:{role:"member"},schoolRoles:{operator:false}});
   });
   await page.locator('[data-shop="fictional-shop"]').click();
   await page.locator(".sas-stock-stats").waitFor();
   assert.match(await page.locator(".sas-stock-stats").innerText(),/23/);
   assert.match(await page.locator(".sas-stock-summary").innerText(),/Bestand/);
   const downloadPromise=page.waitForEvent("download");
   await page.getByRole("button",{name:"Inventurliste als CSV speichern"}).click();
   const download=await downloadPromise;
   assert.equal(download.suggestedFilename(),"sas-shop-inventur.csv");
   const data=readFileSync(await download.path(),"utf8");
   assert.match(data,/Brezel/);
   assert.match(data,/'=HYPERLINK/);
   const docWidth=await page.evaluate(()=>document.documentElement.scrollWidth);
   assert.ok(docWidth<=width+1,"horizontal overflow at "+width+": "+docWidth);
   await page.close();
  }
 }finally{await browser.close();}
});
