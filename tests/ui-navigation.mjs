import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const read=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8');
async function launch(role='member'){
 const listeners={},intervals=[];
 const root={innerHTML:'',addEventListener:(k,v)=>listeners[k]=v};
 const user={id:'73abccce-04ad-49c0-a6b0-39234bc369c7',email:'ui@example.test'};
 const profile={id:user.id,display_name:'Alex <Beispiel>',role,vote_eligible:true};
 const rows={profiles:profile,wallets:{balance_cents:12345},wallet_ledger:[],cash_sales:[],payment_requests:[]};
 const api={from:table=>{const q=new Proxy({},{get:(_,p)=>p==='then'?(ok)=>Promise.resolve(ok({data:rows[table]??[],error:null})):()=>q});return q;},rpc:async()=>({data:[],error:null}),auth:{getSession:async()=>({data:{session:{user}},error:null}),onAuthStateChange:()=>{}}};
 const document={getElementById:id=>id==='app'?root:id==='toast-root'?{appendChild:()=>{}}:null,addEventListener:()=>{},querySelector:()=>null,activeElement:null,hidden:false};
 const window={NV_CONFIG:{supabaseUrl:'https://example.test',supabaseAnonKey:'public'},supabase:{createClient:()=>api},addEventListener:()=>{},scrollTo:()=>{},scrollY:0};
 const sandbox={window,document,location:{search:'',hash:'',href:'https://example.test/',origin:'https://example.test',pathname:'/'},URL,URLSearchParams,Intl,Date,console,setInterval:f=>intervals.push(f),setTimeout:()=>{},navigator:{},history:{replaceState:()=>{}}};
 vm.runInNewContext(read('features.js'),sandbox);
 vm.runInNewContext(read('app.js'),sandbox);
 await new Promise(resolve=>setImmediate(resolve));
 return {root,listeners,intervals,document,sandbox,async click(id){listeners.click({preventDefault(){},target:{closest:()=>({dataset:{nav:id}})}});await new Promise(resolve=>setImmediate(resolve));}};
}
test('dashboard and portal have usable role-aware navigation; user text is escaped',async()=>{
 for(const role of ['member','cashier','admin']){
  const x=await launch(role);
  assert.match(x.root.innerHTML,/Guten Tag, Alex &lt;Beispiel&gt;/);
  assert.doesNotMatch(x.root.innerHTML,/NaN|\.\/portal\/|V4 ·/);
  assert.equal(x.root.innerHTML.includes('data-nav="admin"'),role==='admin');
  assert.equal(x.root.innerHTML.includes('data-nav="register"'),role!=='member');
  await x.click('apps');
  assert.match(x.root.innerHTML,/Alles an einem Ort/);
  for(const id of ['idcard','gallery','visa','bulletin','blog','map','rooms','events','lost','jobs','laws','parties','courts'])assert.match(x.root.innerHTML,new RegExp('data-nav="'+id+'"'));
  if(role==='member'){await x.click('admin');assert.match(x.root.innerHTML,/Alles an einem Ort/);}
 }
});
test('module wrappers render each form only once',async()=>{
 const x=await launch('admin');
 const feature=x.sandbox.window.SAS_FEATURES;
 const api={from:()=>{const q=new Proxy({},{get:(_,p)=>p==='then'?(ok)=>ok({data:[],error:null}):()=>q});return q;}};
 for(const page of ['visa','bulletin','lost','events','jobs']){
  const node={innerHTML:'',isConnected:true,addEventListener(){},querySelector(){return null;}};
  await feature.show({api,user:{id:'73abccce-04ad-49c0-a6b0-39234bc369c7',email:'ui@example.test'},profile:{role:'admin',display_name:'Test'},page,target:node});
  const forms=node.innerHTML.match(/data-feature-form=/g)||[];
  assert.equal(forms.length,1,page+' must have exactly one form');
  assert.ok(node.innerHTML.indexOf('</h1>')<node.innerHTML.indexOf('data-feature-form='));
 }
});
test('late module responses cannot overwrite the newly selected module',async()=>{
 const x=await launch('member');
 let release;
 const delayed=new Promise(resolve=>release=resolve);
 const feature=x.sandbox.window.SAS_FEATURES;
 function api(result){return {from:()=>{const q=new Proxy({},{get:(_,p)=>p==='then'?(ok)=>Promise.resolve(result).then(ok):()=>q});return q;}};}
 function node(){return {innerHTML:'',isConnected:true,addEventListener(){},querySelector(){return null;}};}
 const old=node(),fresh=node(),user={id:'73abccce-04ad-49c0-a6b0-39234bc369c7',email:'ui@example.test'},profile={role:'member',display_name:'Current'};
 const pending=feature.show({api:api(delayed),user,profile,page:'visa',target:old});
 await feature.show({api:api({data:[],error:null}),user,profile,page:'gallery',target:fresh});
 const rendered=fresh.innerHTML;
 release({data:[{first_name:'Old request'}],error:null});
 await pending;
 assert.equal(fresh.innerHTML,rendered);
 assert.match(fresh.innerHTML,/Ausweis-Galerie/);
});
if(process.env.SAS_UI_FIXTURES){
 const x=await launch('admin');const dir=process.env.SAS_UI_FIXTURES;mkdirSync(dir,{recursive:true});
 const shell=body=>'<!doctype html><html lang="de"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lokale Layoutprüfung mit Testdaten</title><style>'+read('styles.css')+'\n'+read('features.css')+'</style><body>'+body+'</body></html>';
 writeFileSync(dir+'/dashboard.html',shell(x.root.innerHTML));
 x.sandbox.window.supabase.createClient=()=>({auth:{getSession:async()=>({data:{session:null}}),onAuthStateChange(){}}});
 vm.runInNewContext(read('app.js'),x.sandbox);await new Promise(resolve=>setImmediate(resolve));
 writeFileSync(dir+'/login.html',shell(x.root.innerHTML));
}
