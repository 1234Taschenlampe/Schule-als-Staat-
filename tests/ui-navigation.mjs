import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const read=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8');
async function launch(role='member',email='ui@example.test',stubPublicVisa=false,schoolRoles={operator:false,jobs:[]}){
 const listeners={},intervals=[];
 const root={innerHTML:'',addEventListener:(k,v)=>listeners[k]=v};
 const windowListeners={},visaRoot={innerHTML:''};
 const user={id:'73abccce-04ad-49c0-a6b0-39234bc369c7',email};
 const profile={id:user.id,display_name:'Alex <Beispiel>',role,vote_eligible:true};
 const rows={profiles:profile,wallets:{balance_cents:12345},wallet_ledger:[],cash_sales:[],payment_requests:[]};
 const api={from:table=>{const q=new Proxy({},{get:(_,p)=>p==='then'?(ok)=>Promise.resolve(ok({data:rows[table]??[],error:null})):()=>q});return q;},rpc:async(name)=>({data:name==='my_school_roles'?schoolRoles:[],error:null}),auth:{getSession:async()=>({data:{session:{user}},error:null}),onAuthStateChange:()=>{}}};
 const document={getElementById:id=>id==='app'?root:id==='toast-root'?{appendChild:()=>{}}:id==='sas-visa-public-root'?visaRoot:null,addEventListener:()=>{},querySelector:()=>null,activeElement:null,hidden:false};
 const window={NV_CONFIG:{supabaseUrl:'https://example.test',supabaseAnonKey:'public'},supabase:{createClient:()=>api},addEventListener:(key,callback)=>windowListeners[key]=callback,scrollTo:()=>{},scrollY:0};
 const sandbox={window,document,location:{search:'',hash:'',href:'https://example.test/',origin:'https://example.test',pathname:'/'},URL,URLSearchParams,Intl,Date,console,setInterval:f=>intervals.push(f),setTimeout:()=>{},navigator:{},history:{replaceState:()=>{}}};
 window.location=sandbox.location;
 if(stubPublicVisa)window.SAS_PUBLIC_VISA={form:()=>'<form id="guest-visa-form"></form>',showPublic:()=>{},showVerification:()=>{},showPaidRedirect:()=>{}};
 vm.runInNewContext(read('features.js'),sandbox);
 vm.runInNewContext(read('app.js'),sandbox);
 await new Promise(resolve=>setImmediate(resolve));
 return {root,listeners,windowListeners,visaRoot,intervals,document,sandbox,async click(id){listeners.click({preventDefault(){},target:{closest:()=>({dataset:{nav:id}})}});await new Promise(resolve=>setImmediate(resolve));}};
}
test('dashboard and portal have usable role-aware navigation; user text is escaped',async()=>{
 for(const role of ['member','cashier','admin']){
  const x=await launch(role);
  assert.match(x.root.innerHTML,/Alex &lt;Beispiel&gt;/);
  assert.match(x.root.innerHTML,role==='member'?/Dein Schulstaat startet bald/:/Guten Tag,/);
  assert.doesNotMatch(x.root.innerHTML,/NaN|\.\/portal\/|V4 ·/);
  assert.equal(x.root.innerHTML.includes('data-nav="admin"'),role==='admin');
  assert.equal(x.root.innerHTML.includes('data-nav="register"'),role!=='member');
  await x.click('apps');
  assert.match(x.root.innerHTML,/Alle Bereiche/);
  for(const id of ['idcard','gallery','map','rooms','shops','votes','lost'])assert.match(x.root.innerHTML,new RegExp('data-nav="'+id+'"'));
  for(const id of ['visa','bulletin','blog','events','jobs','laws','parties','courts']){
   assert.equal(x.root.innerHTML.includes('data-nav="'+id+'"'),role==='admin'||role==='member',id+' navigation preview mismatch');
  }
  if(role==='member'){await x.click('admin');assert.match(x.root.innerHTML,/Alle Bereiche/);}
 }
});
test('prelaunch preview locks student modules but keeps polls, ID and account settings reachable',async()=>{
 const x=await launch('member');
 assert.match(x.root.innerHTML,/sas-preview-locked/);
 assert.match(x.root.innerHTML,/disabled aria-disabled="true"/);
 assert.match(x.root.innerHTML,/Umfragen & Abstimmungen/);
 assert.doesNotMatch(x.root.innerHTML,/Letzte Kontobewegungen/);
 await x.click('apps');
 assert.match(x.root.innerHTML,/data-nav="map"[^>]*disabled aria-disabled="true"/);
 await x.click('map'); // simulated direct click cannot bypass the route guard
 assert.match(x.root.innerHTML,/Alle Bereiche/);
 await x.click('votes');
 assert.match(x.root.innerHTML,/Abstimmungen/);
 await x.click('idcard');
 assert.match(x.root.innerHTML,/Schülerausweis/);
 await x.click('settings');
 assert.match(x.root.innerHTML,/Passwort ändern/);
});
test('existing higher school roles retain their previously permitted modules',async()=>{
 for(const [role,roles] of [
   ['admin',{operator:false,jobs:[]}],
   ['cashier',{operator:false,jobs:[]}],
   ['member',{operator:true,jobs:[{slug:'operator',tier:80}]}],
   ['member',{operator:false,jobs:[{slug:'journalist',tier:10}]}]
 ]){
   const x=await launch(role,'ui@example.test',false,roles);
   assert.doesNotMatch(x.root.innerHTML,/sas-preview-locked/,role+' must not see preview locks');
   await x.click('wallet');
   assert.match(x.root.innerHTML,/Mein Guthaben/,role+' wallet remains accessible');
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
  const expected=page==='visa'?0:1; // Historical ViSA is read-only; public guest ViSA is separate.
  assert.equal(forms.length,expected,page+' must have '+expected+' editable forms');
  if(expected)assert.ok(node.innerHTML.indexOf('</h1>')<node.innerHTML.indexOf('data-feature-form='));
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

test('citizen account shows real Bürgerkennung, administrative account shows real email',async()=>{
 const pupil=await launch('member','a1b2c3d4e5@accounts.schule-als-staat.invalid');
 await pupil.click('settings');
 assert.match(pupil.root.innerHTML,/<strong>Bürgerkennung<\/strong><p>SAS-A1B2C3D4E5<\/p>/);
 assert.doesNotMatch(pupil.root.innerHTML,/a1b2c3d4e5@accounts\.schule-als-staat\.invalid/);
 const admin=await launch('admin','verwaltung@example.test');
 await admin.click('settings');
 assert.match(admin.root.innerHTML,/<strong>E-Mail<\/strong><p>verwaltung@example\.test<\/p>/);
});
test('public ViSA hash link is handled even when a citizen is already logged in',async()=>{
 const user=await launch('member','a1b2c3d4e5@accounts.schule-als-staat.invalid',true);
 assert.equal(typeof user.windowListeners.hashchange,'function');
 user.sandbox.location.hash='#visa-onboarding';
 user.windowListeners.hashchange();
 assert.match(user.root.innerHTML,/sas-public-visa-page/);
 assert.match(user.visaRoot.innerHTML,/guest-visa-form/);
});
