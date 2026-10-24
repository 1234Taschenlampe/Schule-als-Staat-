import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const src=readFileSync(new URL("../app.js",import.meta.url),"utf8");
async function scenario(loginInput){
  const handlers={};
  const root={innerHTML:"",addEventListener:(name,fn)=>handlers[name]=fn};
  const errorTexts=[];
  const toasts={appendChild(el){errorTexts.push(el.textContent);},querySelectorAll(){return []}};
  const calls=[];
  const api={
    auth:{
      getSession:async()=>({data:{session:null},error:null}),
      onAuthStateChange(){},
      signUp:async()=>{calls.push("auth.signUp");throw Error("PUBLIC SIGNUP MUST NOT RUN");},
      signInWithPassword:async payload=>{calls.push(payload);return {data:{session:null},error:null};}
    },
    rpc:async()=>({data:[],error:null})
  };
  const document={
    getElementById(id){return id==="app"?root:id==="toast-root"?toasts:null;},
    createElement(){return {className:"",textContent:"",isConnected:true,remove(){}};},
    querySelector(){return null;},
    addEventListener(){}
  };
  class MockFormData{constructor(form){this.fields=form.fields;}get(k){return this.fields[k];}}
  const sandbox={
    window:{NV_CONFIG:{supabaseUrl:"https://test.invalid",supabaseAnonKey:"public-test"},
      supabase:{createClient:()=>api},addEventListener(){},scrollTo(){}},
    document,history:{replaceState(){}},location:{hash:"",search:"",pathname:"/",origin:"https://test.invalid"},
    URLSearchParams,URL,Date,Intl,String,Array,Map,Set,Math,Number,FormData:MockFormData,
    setTimeout(){},setInterval(){},clearInterval(){},console
  };
  vm.runInNewContext(src,sandbox);
  for(let i=0;i<20;i++)await Promise.resolve();
  assert.match(root.innerHTML,/Bürgerkennung oder Verwaltungs-E-Mail/);
  assert.doesNotMatch(root.innerHTML,/<form id="signup-form"/);
  const button={disabled:false,isConnected:true};
  handlers.submit({preventDefault(){},target:{
    id:"signup-form",fields:{},querySelector:()=>button
  }});
  for(let i=0;i<30;i++)await Promise.resolve();
  assert.equal(calls.length,0,"Cannot sign up via discarded hidden HTML form");
  const form={
    id:"password-login-form",
    fields:{email:loginInput,password:"1234567"},
    querySelector:()=>button
  };
  handlers.submit({preventDefault(){},target:form});
  for(let i=0;i<60;i++)await Promise.resolve();
  assert.equal(calls.length,1,"login uses exactly one Supabase API request");
  const expected=/^SAS-[A-Z0-9]{10}$/.test(loginInput)?
    loginInput.slice(4).toLowerCase()+"@accounts.schule-als-staat.invalid":loginInput;
  assert.equal(calls[0].email,expected);
  assert.equal(calls[0].password,"1234567");
}
await scenario("SAS-ABCDEFGHJK");
await scenario("admin@example.test");
console.log("Citizen ID login, admin login and blocked self-signup passed (mocked).");
