import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const src=readFileSync(new URL("../app.js",import.meta.url),"utf8");
async function scenario(loginInput, password='1234567', expected=null){
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
      signInWithPassword:async payload=>{calls.push({type:'admin',...payload});return {data:{session:null},error:null};},
      setSession:async payload=>{calls.push({type:'session',...payload});return {data:{session:null},error:null};}
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
    fetch:async (url,options)=>{assert.equal(url,'https://test.invalid/functions/v1/sas-login-short');calls.push({type:'citizen',...JSON.parse(options.body)});return {ok:true,status:200,json:async()=>({access_token:'test-access',refresh_token:'test-refresh'})};},
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
    fields:{email:loginInput,password},
    querySelector:()=>button
  };
  handlers.submit({preventDefault(){},target:form});
  for(let i=0;i<60;i++)await Promise.resolve();
  if(!expected){assert.equal(calls.length,0,"invalid input must not reach network");return;}
  assert.equal(calls[0].password,password,"password is passed unchanged as data");
  if(expected.type==="citizen"){
    assert.equal(calls.length,2);
    assert.deepEqual(calls[0],{type:"citizen",login_id:expected.value,password});
    assert.equal(calls[1].type,"session");
  }else{
    assert.equal(calls.length,1);
    assert.deepEqual(calls[0],{type:"admin",email:expected.value,password});
  }
}
await scenario("SAS-ABCDEFGHJK","1234567",{type:"citizen",value:"SAS-ABCDEFGHJK"});
await scenario("123456","1234567",{type:"citizen",value:"SAS-123456"});
await scenario("admin@example.test","1234567",{type:"admin",value:"admin@example.test"});
await scenario("SAS-ABCDEFGHJK","x".repeat(30),{type:"citizen",value:"SAS-ABCDEFGHJK"});
await scenario("admin@example.test","<code>example</code>",{type:"admin",value:"admin@example.test"});
await scenario("SAS-"+"A".repeat(30));
await scenario("<code>example</code>");
await scenario("bad address@example.test");
await scenario("SAS-ABCDEFGHJK","x".repeat(201));
console.log("Login validation, citizen Edge routing, admin login and blocked signup passed (mocked).");
