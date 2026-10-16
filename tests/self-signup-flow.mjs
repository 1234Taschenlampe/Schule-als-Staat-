import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const src=readFileSync(new URL("../app.js",import.meta.url),"utf8");
async function scenario(noSession){
  const handlers={};
  const root={innerHTML:"",addEventListener:(name,fn)=>handlers[name]=fn};
  const errors=[];const toasts={appendChild(el){errors.push(el.textContent);},querySelectorAll(){return []}};
  const user={id:"d06806b7-fd65-4990-8e38-6d8e0ad5f874",email:"student@example.test"};
  const calls=[];
  function from(table){
    calls.push(table);
    const q={
      select(){return q;},eq(){return q;},order(){return q;},
      single(){return Promise.resolve({data:table==="profiles"?{id:user.id,role:"member",vote_eligible:false,display_name:"Testnutzer"}:{balance_cents:0},error:null});},
      limit(){return Promise.resolve({data:[],error:null});}
    };
    return q;
  }
  const api={
    auth:{
      getSession:async()=>({data:{session:null},error:null}),
      onAuthStateChange(){},
      signUp:async()=>({data:{user,session:noSession?null:{user}},error:null}),
      signInWithPassword:async()=>({data:{user,session:{user}},error:null})
    },
    from,
    rpc:async()=>({data:[],error:null})
  };
  const document={
    getElementById(id){return id==="app"?root:id==="toast-root"?toasts:null;},
    createElement(){return {className:"",textContent:"",isConnected:true,remove(){}};},
    querySelector(){return null;},
    addEventListener(){}
  };
  class MockFormData{constructor(form){this.form=form;}get(k){return this.form.fields[k];}}
  const sandbox={
    window:{NV_CONFIG:{supabaseUrl:"https://test.invalid",supabaseAnonKey:"public-test",currencyLabel:"Einheiten"},supabase:{createClient:()=>api},addEventListener(){},scrollTo(){}},
    document,history:{replaceState(){}},location:{hash:"",search:"",pathname:"/",origin:"https://test.invalid"},
    URLSearchParams,URL,Date,Intl,String,Array,Map,Set,Math,Number,FormData:MockFormData,
    setTimeout(){},setInterval(){},clearInterval(){},console
  };
  vm.runInNewContext(src,sandbox);
  for(let i=0;i<10;i++)await Promise.resolve();
  assert.match(root.innerHTML,/signup-form/);
  const button={disabled:false,isConnected:true};
  const feedback={textContent:"",className:""};
  const form={
    id:"signup-form",
    fields:{email:user.email,password:"example-for-test-123",repeat:"example-for-test-123"},
    querySelector(key){return key==="#signup-feedback"?feedback:key==='[type="submit"]'?button:null;}
  };
  handlers.submit({preventDefault(){},target:form});
  for(let i=0;i<120;i++)await Promise.resolve();
  assert.match(root.innerHTML,/Guten Tag, Testnutzer/,"registration must open account dashboard: "+errors.join(" | "));
  assert.ok(calls.includes("profiles"));
  assert.ok(calls.includes("wallets"));
  assert.equal(feedback.textContent,"");
}
await scenario(false);
await scenario(true);
console.log("Student self-signup integration simulations passed (Supabase mocked).");
