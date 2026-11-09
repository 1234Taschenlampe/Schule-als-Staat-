import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
const read=n=>readFileSync(new URL('../'+n,import.meta.url),'utf8');
async function launch(role='member',email='ui@example.test',stubPublicVisa=false,schoolRoles={operator:false,jobs:[]},clock=Date){
 const listeners={},intervals=[];
 const root={innerHTML:'',addEventListener:(k,v)=>listeners[k]=v};
 const windowListeners={},visaRoot={innerHTML:''};
 const featureRoot={innerHTML:'',textContent:'',isConnected:true,addEventListener(){},querySelector(){return null;}};
 const user={id:'73abccce-04ad-49c0-a6b0-39234bc369c7',email};
 const profile={id:user.id,display_name:'Alex <Beispiel>',role,vote_eligible:true};
 const rows={profiles:profile,wallets:{balance_cents:12345},wallet_ledger:[],cash_sales:[],payment_requests:[]};
 const api={from:table=>{const q=new Proxy({},{get:(_,p)=>p==='then'?(ok)=>Promise.resolve(ok({data:rows[table]??[],error:null})):()=>q});return q;},rpc:async(name)=>({data:name==='my_school_roles'?schoolRoles:name==='my_short_login_id'?'SAS-583204':[],error:null}),auth:{getSession:async()=>({data:{session:{user}},error:null}),onAuthStateChange:()=>{}}};
 const document={getElementById:id=>id==='app'?root:id==='toast-root'?{appendChild:()=>{}}:id==='sas-visa-public-root'?visaRoot:id==='sas-live-module'?featureRoot:null,addEventListener:()=>{},querySelector:()=>null,activeElement:null,hidden:false};
 const window={NV_CONFIG:{supabaseUrl:'https://example.test',supabaseAnonKey:'public'},supabase:{createClient:()=>api},addEventListener:(key,callback)=>windowListeners[key]=callback,scrollTo:()=>{},scrollY:0};
 const sandbox={window,document,location:{search:'',hash:'',href:'https://example.test/',origin:'https://example.test',pathname:'/'},URL,URLSearchParams,Intl,Date:clock,console,setInterval:f=>intervals.push(f),setTimeout:()=>{},navigator:{},history:{replaceState:()=>{}}};
 window.location=sandbox.location;
 if(stubPublicVisa)window.SAS_PUBLIC_VISA={form:()=>'<form id="guest-visa-form"></form>',showPublic:()=>{},showVerification:()=>{},showPaidRedirect:()=>{}};
 vm.runInNewContext(read('features.js'),sandbox);
 vm.runInNewContext(read('app.js'),sandbox);
 await new Promise(resolve=>setImmediate(resolve));
 return {root,listeners,windowListeners,visaRoot,featureRoot,intervals,document,sandbox,async click(id){listeners.click({preventDefault(){},target:{closest:()=>({dataset:{nav:id}})}});await new Promise(resolve=>setImmediate(resolve));}};
}
test('dashboard and portal use role-aware navigation and never render a profile name',async()=>{
 for(const role of ['member','cashier','admin']){
  const x=await launch(role);
  assert.doesNotMatch(x.root.innerHTML,/Alex|Beispiel/);
  assert.match(x.root.innerHTML,role==='member'?/Dein Zugang ist eingerichtet/:/Guten Tag,/);
  assert.doesNotMatch(x.root.innerHTML,/NaN|\.\/portal\/|V4 ·/);
  assert.equal(x.root.innerHTML.includes('data-nav="admin"'),role==='admin');
  assert.equal(x.root.innerHTML.includes('data-nav="register"'),role!=='member');
  await x.click('apps');
  assert.match(x.root.innerHTML,/Alle Bereiche/);
  for(const id of ['idcard','gallery','map','rooms','shops','lost'])assert.match(x.root.innerHTML,new RegExp('data-nav="'+id+'"'));
  assert.doesNotMatch(x.root.innerHTML,/data-nav="(?:visa|guestvisa)"/,'paused ViSA is not listed for any role');
  for(const page of ['votes','itsupport'])assert.equal(x.root.innerHTML.includes('data-nav="'+page+'"'),role==='admin');
  for(const id of ['bulletin','blog','events','jobs','laws','parties','courts']){
   assert.equal(x.root.innerHTML.includes('data-nav="'+id+'"'),role==='admin'||role==='member',id+' navigation preview mismatch');
  }
  if(role==='member'){await x.click('admin');assert.match(x.root.innerHTML,/Alle Bereiche/);}
 }
});
test('prelaunch preview keeps ID and settings reachable and hides polls',async()=>{
 const x=await launch('member');
 assert.match(x.root.innerHTML,/sas-preview-locked/);
 assert.match(x.root.innerHTML,/disabled aria-disabled="true"/);
 assert.doesNotMatch(x.root.innerHTML,/Umfragen|Abstimmungen/);
 assert.doesNotMatch(x.root.innerHTML,/Letzte Kontobewegungen/);
 await x.click('apps');
 assert.match(x.root.innerHTML,/data-nav="map"[^>]*disabled aria-disabled="true"/);
 await x.click('map'); // simulated direct click cannot bypass the route guard
 assert.match(x.root.innerHTML,/Alle Bereiche/);
 await x.click('votes');
 assert.match(x.root.innerHTML,/Alle Bereiche/);
 await x.click('idcard');
 assert.match(x.document.title,/Schülerausweis/);
 assert.match(x.featureRoot.innerHTML,/Schülerausweis/);
 await x.click('settings');
 assert.match(x.root.innerHTML,/Passwort ändern/);
});
test('poll and IT support routes reject non-admins, including operators and cashiers',async()=>{
 for(const [role,schoolRoles] of [
   ['member',{operator:false,jobs:[]}],
   ['member',{operator:true,jobs:[{slug:'operator'}]}],
   ['cashier',{operator:false,jobs:[]}]
 ]){
  const account=await launch(role,'ui@example.test',false,schoolRoles);
  const initial=account.document.title;
  for(const page of ['votes','itsupport']){
   await account.click(page);
   assert.equal(account.document.title,initial);
   account.sandbox.location.hash='#'+page;
   account.windowListeners.hashchange();
   assert.equal(account.document.title,initial);
   assert.doesNotMatch(account.root.innerHTML,new RegExp('data-nav="'+page+'"'));
  }
 }
 const admin=await launch('admin');
 await admin.click('votes');
 assert.match(admin.document.title,/Abstimmungen/);
 await admin.click('itsupport');
 assert.match(admin.document.title,/Konten & IT-Support/);
 assert.match(admin.root.innerHTML,/id="sas-support-lookup"/);
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

test('account settings display the short citizen ID and a copy control',async()=>{
 const pupil=await launch('member','a1b2c3d4e5@accounts.schule-als-staat.invalid');
 await pupil.click('settings');
 assert.match(pupil.root.innerHTML,/<strong>Bürgerkennung<\/strong><p>SAS-583204<\/p>/);
 assert.doesNotMatch(pupil.root.innerHTML,/a1b2c3d4e5@accounts\.schule-als-staat\.invalid/);
 const admin=await launch('admin','verwaltung@example.test');
 await admin.click('settings');
 assert.doesNotMatch(admin.root.innerHTML,/verwaltung@example\.test/);
 assert.match(pupil.root.innerHTML,/data-action="copy-citizen"/);
});
test('paused ViSA is hidden from login, administration and direct hash routes',async()=>{
 const admin=await launch('admin','verwaltung@example.test',true);
 await admin.click('apps');
 assert.doesNotMatch(admin.root.innerHTML,/data-nav="(?:visa|guestvisa)"/);
 await admin.click('visa');
 assert.doesNotMatch(admin.root.innerHTML,/sas-public-visa-page|Öffentliches ViSA/);
 const member=await launch('member','a1b2c3d4e5@accounts.schule-als-staat.invalid',true);
 assert.equal(typeof member.windowListeners.hashchange,'function');
 member.sandbox.location.hash='#visa-onboarding';
 member.windowListeners.hashchange();
 assert.doesNotMatch(member.root.innerHTML,/sas-public-visa-page|guest-visa-form/);
 assert.equal(member.visaRoot.innerHTML,'');
});

test('transaction history opens for authorized accounts',async()=>{
 const x=await launch('cashier');
 await x.click('history');
 assert.match(x.document.title,/Verlauf/);
 assert.match(x.root.innerHTML,/Noch keine digitalen Buchungen/);
});
