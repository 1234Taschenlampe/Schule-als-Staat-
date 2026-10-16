/* SaS ONE: QR challenge for in-person school membership verification, not email confirmation. */
(function(){
"use strict";
const pages={schoolverify:"Schulverifizierung",verifyadmin:"QR-Prüfung"};
const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let scanner=null,screen=null,activeContext=null;
function errorMessage(e){return String(e?.message||e||"Aktion fehlgeschlagen.");}
async function apiCall(api,name,params={}){const r=await api.rpc(name,params);if(r.error)throw r.error;return r.data;}
async function stop(){
  const current=scanner;scanner=null;
  if(!current)return;
  try{if(current.isScanning)await current.stop();}catch(e){}
  try{current.clear();}catch(e){}
}
function shell(title,subtitle,body){return '<div class="sas-space verify-module"><header class="sas-heading"><div><span class="sas-kicker">Schule als Staat · Mitgliedschaft</span><h1>'+escape(title)+'</h1><p>'+escape(subtitle)+'</p></div></header>'+body+'<p class="sas-feedback" id="verify-feedback" role="status" aria-live="polite"></p></div>';}
function note(s){return '<p class="sas-note">'+escape(s)+'</p>';}
function feedback(msg,bad=false){
  const el=screen?.querySelector("#verify-feedback");
  if(el){el.textContent=msg;el.className="sas-feedback"+(bad?" error":"");}
}
async function studentView(){
  const ctx=activeContext;
  const status=await apiCall(ctx.api,"my_school_verification_status");
  if(ctx!==activeContext||!screen?.isConnected)return;
  if(status?.verified){
    screen.innerHTML=shell("Schulidentität bestätigt","Dein Konto wurde vor Ort überprüft.",'<section class="sas-panel verify-success"><div class="verify-checkmark">✓</div><h2>Deine Mitgliedschaft wurde geprüft</h2><p>Prüfung am '+escape(new Date(status.verified_at).toLocaleDateString("de-DE"))+'. Du kannst dein Konto wie gewohnt nutzen.</p>'+note("Die Schulverifizierung ist unabhängig von E-Mail-Bestätigung, Stimmrecht und Kassenberechtigungen.")+'</section>');
    return;
  }
  screen.innerHTML=shell("Schulverifizierung","In der Schule weist du deine Mitgliedschaft persönlich nach.",
    '<section class="sas-panel verify-intro"><div class="verify-number">01</div><div><h2>QR-Code erstellen</h2><p>Zeige deinen QR-Code einer berechtigten Person in der Schule. Sie prüft deinen Namen und bestätigt anschließend deine Schulzugehörigkeit.</p></div></section>'+
    '<section class="sas-panel verify-code-panel"><div id="verify-qr-wrap" class="verify-qr-wrap"><span class="sas-note">Noch kein QR-Code erstellt.</span></div><div class="verify-qr-actions"><button type="button" class="sas-btn primary" data-verify-action="create">QR-Code erstellen</button><button type="button" class="sas-btn soft" data-verify-action="refresh">Status aktualisieren</button></div>'+note("Der Code ist höchstens 10 Minuten gültig und nur einmal verwendbar. Er enthält weder deinen Namen noch deine E-Mail-Adresse.")+'</section>'+
    '<section class="sas-panel"><div class="verify-number">02</div><h2>In der Schule vorzeigen</h2><p>Die zuständige Person scannt den Code und gleicht deine Identität mit den Schulunterlagen ab. Du brauchst keine Bestätigungs-E-Mail.</p></section>');
}
function adminView(){
  screen.innerHTML=shell("Schulidentität prüfen","Nur Administratoren dürfen QR-Codes bestätigen.",
    '<div class="sas-columns"><section class="sas-panel"><h2>QR-Code scannen</h2><p class="sas-note">Bitte vor Ort den Schüler anhand der Schulunterlagen prüfen – ein QR-Code allein ist kein Identitätsnachweis.</p><div id="verify-camera-area" class="verify-camera-area" aria-label="Kameravorschau"></div>'+
    '<div class="verify-qr-actions"><button class="sas-btn primary" data-verify-action="start-camera" type="button">Kamera starten</button><button class="sas-btn soft" data-verify-action="stop-camera" type="button">Kamera stoppen</button></div>'+
    '<form id="verify-manual-form" class="sas-form"><label class="sas-field"><span>Alternativ: QR-Inhalt eingeben</span><input id="verify-code-input" name="code" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="SAS-VERIFY:…" required></label><button class="sas-btn soft" type="submit">Code prüfen</button></form></section>'+
    '<section class="sas-panel"><h2>Identität und Mitgliedschaft</h2><div id="verify-review" class="verify-review">'+note("Scanne oder prüfe zuerst einen QR-Code. Anschließend erscheinen die Kontodaten zur Kontrolle.")+'</div></section></div>');
}
function showCandidate(details){
 const box=screen?.querySelector("#verify-review");
 if(!box)return;
 box.innerHTML='<div class="sas-item"><h3>'+escape(details.display_name||"Kein Name hinterlegt")+'</h3><p>Klasse: '+escape(details.class_label||"nicht angegeben")+'</p><p>E-Mail: '+escape(details.email||"–")+'</p>'+note("Die Angaben stammen aus dem Konto und sind vom Schüler gegebenenfalls selbst eingetragen worden. Nur die überprüften Schulunterlagen gelten als Beleg.")+
 '<label class="sas-checkbox"><input type="checkbox" id="verify-identity-checked"><span>Ich habe die Person vor Ort mit den Schulunterlagen abgeglichen und die Zugehörigkeit zur Schule bestätigt.</span></label>'+
 '<button type="button" class="sas-btn primary" data-verify-action="confirm">Schulidentität verbindlich bestätigen</button></div>';
}
async function review(raw){
 const current=activeContext;
 current.pendingCode=null;
 screen.querySelector("#verify-review").textContent="Prüfe QR-Code …";
 const details=await apiCall(current.api,"review_school_verification_qr",{p_code:raw});
 if(activeContext!==current||!screen?.isConnected)return;
 current.pendingCode=raw;
 showCandidate(details);
 feedback("QR-Code gültig. Gleiche die Person jetzt mit den Schulunterlagen ab.");
}
async function create(){
 const current=activeContext;
 const code=await apiCall(current.api,"create_school_verification_qr");
 if(current!==activeContext)return;
 const node=screen?.querySelector("#verify-qr-wrap");
 if(!node)return;
 node.replaceChildren();
 if(window.QRCode){
   try{new window.QRCode(node,{text:code,width:224,height:224,colorDark:"#19304b",colorLight:"#ffffff"});}
   catch(e){node.textContent="QR-Code konnte nicht dargestellt werden. Bitte Seite neu laden.";return;}
 }else{node.textContent="Die QR-Bibliothek ist noch nicht geladen. Bitte Seite neu laden.";return;}
 const text=document.createElement("p");text.className="sas-note";
 text.textContent="Bitte innerhalb von 10 Minuten an der Schule scannen lassen.";
 node.append(text);
 feedback("Neuer QR-Code erstellt. Der vorherige Code ist jetzt ungültig.");
}
async function startCamera(){
 const ctx=activeContext;
 if(!window.Html5Qrcode)throw Error("QR-Kamera ist noch nicht geladen. Du kannst einen Code auch manuell eingeben.");
 await stop();
 const el=screen?.querySelector("#verify-camera-area");
 if(!el)throw Error("Kamerabereich fehlt.");
 el.innerHTML="";
 const cam=new window.Html5Qrcode("verify-camera-area");
 scanner=cam;
 let busy=false;
 try{
 await cam.start({facingMode:"environment"},{fps:10,qrbox:{width:230,height:230}},async raw=>{
   if(busy||ctx!==activeContext)return;
   busy=true;
   await stop();
   try{await review(raw);}catch(e){feedback(errorMessage(e),true);}
 },()=>{});
 feedback("Kamera aktiv. Scanne den QR-Code auf dem Gerät des Schülers.");
 }catch(e){await stop();throw new Error("Kamera konnte nicht gestartet werden. Bitte Kamerazugriff freigeben oder den Code manuell eingeben.");}
}
async function show(context){
 await stop();
 activeContext=context;
 screen=context.target;
 if(!screen)throw Error("Verifizierungsbereich nicht verfügbar.");
 const isAdmin=context.profile?.role==="admin"||Boolean(context.schoolRoles?.operator);
 if(context.page==="verifyadmin"&&!isAdmin){
   screen.innerHTML=shell("Kein Zugriff","Nur Administratoren und Operatoren dürfen QR-Codes prüfen.",'');
   return;
 }
 if(context.page==="verifyadmin")adminView();else await studentView();
 const here=screen;
 if(here.dataset.verifyBound)return;
 here.dataset.verifyBound="1";
 here.addEventListener("submit",async e=>{
   const form=e.target.closest("#verify-manual-form");
   if(!form)return;
   e.preventDefault();e.stopPropagation();
   if(activeContext?.page!=="verifyadmin")return;
   const raw=String(new FormData(form).get("code")||"").trim();
   try{await stop();await review(raw);}catch(err){feedback(errorMessage(err),true);}
 });
 here.addEventListener("click",async e=>{
   const button=e.target.closest("[data-verify-action]");
   if(!button)return;
   e.preventDefault();e.stopPropagation();
   if(button.disabled)return;
   button.disabled=true;
   try{
    const action=button.dataset.verifyAction;
    if(action==="create")await create();
    else if(action==="refresh")await studentView();
    else if(action==="start-camera")await startCamera();
    else if(action==="stop-camera"){await stop();feedback("Kamera gestoppt.");}
    else if(action==="confirm"){
       const ctx=activeContext;
       if(ctx?.page!=="verifyadmin"||(ctx.profile?.role!=="admin"&&!ctx.schoolRoles?.operator))throw Error("Keine Berechtigung.");
       if(!ctx.pendingCode)throw Error("Bitte zuerst einen gültigen QR-Code prüfen.");
       const tick=here.querySelector("#verify-identity-checked");
       if(!tick?.checked)throw Error("Bestätige zuerst die persönliche Überprüfung.");
       const result=await apiCall(ctx.api,"confirm_school_verification_qr",{p_code:ctx.pendingCode,p_identity_checked:true});
       ctx.pendingCode=null;
       const panel=here.querySelector("#verify-review");
       if(panel)panel.innerHTML='<div class="verify-success"><div class="verify-checkmark">✓</div><h2>Schulidentität bestätigt</h2><p>'+escape(result.display_name||"Mitglied")+' wurde erfolgreich verifiziert.</p></div>';
       feedback("Erfolgreich gespeichert. Der QR-Code kann nicht erneut verwendet werden.");
    }
   }catch(err){feedback(errorMessage(err),true);}finally{button.disabled=false;}
 });
}
window.SAS_VERIFICATION={pages,show,stop};
})();