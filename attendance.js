/* SaS ONE – student ID attendance scan. No real money; private, unique Supabase attendance records. */
(function(){
"use strict";
const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let ctx=null,host=null,scanner=null,sessions=[],selected="",status="";
async function rpc(name,args={}){const r=await ctx.api.rpc(name,args);if(r.error)throw r.error;return r.data;}
async function stop(){
 const c=scanner;scanner=null;if(!c)return;
 try{if(c.isScanning)await c.stop();}catch(e){}
 try{c.clear();}catch(e){}
}
function feedback(message,err=false){
 const n=host?.querySelector("#attendance-feedback");
 if(n){n.className="sas-feedback"+(err?" error":"");n.textContent=message;}
}
function drawCode(node,token){
 if(!node)throw Error("QR-Bereich fehlt.");
 node.replaceChildren();
 if(!window.QRCode)throw Error("QR-Darstellung ist nicht geladen. Bitte die Webseite neu laden.");
 new window.QRCode(node,{text:token,width:220,height:220,colorDark:"#20364f",colorLight:"#ffffff"});
 const meta=document.createElement("p");meta.className="sas-note";meta.textContent="Nur 2 Minuten gültig · Nur einmal nutzbar";
 node.append(meta);
}
async function createStudentPass(api,node){
 const result=await api.rpc("create_attendance_pass");
 if(result.error)throw result.error;
 drawCode(node,result.data);
 return true;
}
async function refreshSessions(){sessions=await rpc("list_attendance_sessions");if(!Array.isArray(sessions))sessions=[];if(!sessions.some(x=>x.id===selected&&x.is_open))selected=sessions.find(x=>x.is_open)?.id||"";}
function paint(){
 const active=sessions.find(x=>x.id===selected);
 host.innerHTML='<div class="sas-space"><div class="sas-heading"><div><span class="sas-kicker">SCHULSTAAT / ANWESENHEIT</span><h1>Anwesenheit kontrollieren</h1><p>Schüler zeigen den einmalig gültigen QR-Code auf ihrem digitalen Schülerausweis.</p></div></div>'+
 '<div class="sas-columns"><section class="sas-panel"><h2>Anwesenheitsliste auswählen</h2><form class="sas-form" id="attendance-new"><label class="sas-field"><span>Bezeichnung, z. B. „Klasse 5a – 1. Stunde“</span><input name="title" minlength="3" maxlength="100" required></label><label class="sas-field"><span>Wie lange bleibt die Liste offen?</span><select name="minutes"><option value="30">30 Minuten</option><option value="60" selected>60 Minuten</option><option value="120">120 Minuten</option><option value="240">4 Stunden</option></select></label><button type="submit" class="sas-btn primary">Neue Liste öffnen</button></form>'+
 '<div class="sas-list attendance-list">'+sessions.map(s=>'<div class="sas-item"><h3>'+escape(s.title)+'</h3><p>'+Number(s.scans||0)+' anwesend · '+(s.is_open?"Offen":"Geschlossen")+'</p><div>'+ (s.is_open?'<button class="sas-btn '+(s.id===selected?"muted":"soft")+'" type="button" data-att-action="select" data-id="'+escape(s.id)+'">Auswählen</button>':'')+
 '<button class="sas-btn soft" type="button" data-att-action="details" data-id="'+escape(s.id)+'">Einträge: '+Number(s.scans||0)+'</button>'+(s.is_open?'<button class="sas-btn soft" type="button" data-att-action="close" data-id="'+escape(s.id)+'">Schließen</button>':'')+'</div></div>').join("")+'</div></section>'+
 '<section class="sas-panel"><h2>Schülerausweis scannen</h2>'+(active?'<p class="sas-note">Aktive Liste: <strong>'+escape(active.title)+'</strong></p>':'<p class="sas-note">Wähle oder erstelle zuerst eine offene Anwesenheitsliste.</p>')+
 '<div class="verify-camera-area" id="attendance-camera"></div><div class="verify-qr-actions"><button type="button" class="sas-btn primary" data-att-action="scan" '+(active?'':'disabled')+'>Kamera starten</button><button type="button" class="sas-btn soft" data-att-action="stop">Kamera stoppen</button></div>'+
 '<form id="attendance-manual" class="sas-form"><label class="sas-field"><span>Alternativ: QR-Code-Inhalt</span><input name="code" placeholder="SAS-ATTEND:…" autocapitalize="off" autocomplete="off" spellcheck="false" required></label><button class="sas-btn soft" '+(active?'':'disabled')+'>Code prüfen und Anwesenheit speichern</button></form>'+
 '<div id="attendance-result" class="attendance-result"></div><p class="sas-note">Es wird nur eine Anwesenheit pro Schüler und Termin gespeichert. Ein erneuter Scan führt zu keiner zweiten Anwesenheit.</p></section></div><p class="sas-feedback" role="status" aria-live="polite" id="attendance-feedback">'+escape(status)+'</p></div>';
}
async function scanCode(code){
 if(!selected)throw Error("Bitte zuerst eine Liste auswählen.");
 const res=await rpc("scan_attendance_pass",{p_code:code,p_session_id:selected});
 const area=host?.querySelector("#attendance-result");
 if(area)area.innerHTML='<div class="verify-success"><div class="verify-checkmark">✓</div><h2>'+escape(res.already_present?"Bereits eingetragen":"Anwesenheit gespeichert")+'</h2><p>'+escape(res.display_name)+" · "+escape(res.class_label||"Keine Klassenangabe")+'</p></div>';
 await refreshSessions();
 const count=sessions.find(x=>x.id===selected)?.scans??0;
 status=(res.already_present?"Kein doppelter Eintrag.":"Erfolgreich eingetragen.")+" Jetzt "+count+" anwesend.";
 feedback(status);
}
async function scanCamera(){
 if(!window.Html5Qrcode)throw Error("Die Kamerabibliothek ist nicht verfügbar.");
 await stop();
 const el=host?.querySelector("#attendance-camera");
 if(!el)return;
 const c=new window.Html5Qrcode("attendance-camera");scanner=c;
 let processing=false;
 try{
  await c.start({facingMode:"environment"},{fps:10,qrbox:{width:220,height:220}},async result=>{
    if(processing)return;
    processing=true;
    await stop();
    try{await scanCode(result);}catch(e){feedback(e.message||String(e),true);}
  },()=>{});
  feedback("Kamera aktiv. Scanne den Code vom Schülerausweis.");
 }catch(e){await stop();throw Error("Kamera nicht erreichbar. Erlaube den Zugriff oder gib den Code manuell ein.");}
}
async function show(context){
 await stop();
 ctx=context;host=context.target;
 if(!host)throw Error("Anwesenheitsbereich fehlt.");
 if(context.profile?.role!=="admin"&&!context.schoolRoles?.can_check_attendance){
   host.innerHTML='<div class="sas-space"><section class="sas-panel"><h2>Kein Zugriff</h2><p>Nur berechtigte Anwesenheitskontrolleure dürfen die Listen führen.</p></section></div>';return;
 }
 host.textContent="Anwesenheitslisten werden geladen …";
 await refreshSessions();paint();
 if(host.dataset.attBound)return;
 host.dataset.attBound="1";
 host.addEventListener("submit",async e=>{
  const form=e.target.closest("#attendance-new,#attendance-manual");if(!form)return;
  e.preventDefault();e.stopPropagation();
  const b=form.querySelector('button[type="submit"],button:not([type])');if(b)b.disabled=true;
  try{
    const d=new FormData(form);
    if(form.id==="attendance-new"){
      selected=await rpc("open_attendance_session",{p_title:String(d.get("title")||"").trim(),p_minutes:Number(d.get("minutes")||60)});
      await refreshSessions();paint();feedback("Anwesenheitsliste geöffnet.");
    }else await scanCode(String(d.get("code")||"").trim());
  }catch(err){feedback(err.message||String(err),true);}
  finally{if(b)b.disabled=false;}
 });
 host.addEventListener("click",async e=>{
   const b=e.target.closest("[data-att-action]");if(!b)return;
   e.preventDefault();e.stopPropagation();if(b.disabled)return;
   const action=b.dataset.attAction,id=b.dataset.id;
   b.disabled=true;
   try{
     if(action==="stop"){await stop();feedback("Kamera gestoppt.");}
     else if(action==="scan")await scanCamera();
     else if(action==="select"){await stop();selected=id;paint();}
     else if(action==="details"){
       const students=await rpc("attendance_session_roster",{p_session_id:id});
       const area=host?.querySelector("#attendance-result");
       if(area){
         const list=Array.isArray(students)?students:[];
         area.innerHTML='<div class="sas-item"><h3>Anwesenheitsliste · '+list.length+' Personen</h3>'+
           (list.length?'<div class="sas-list">'+list.map((p,i)=>'<div class="sas-item"><strong>'+(i+1)+'. '+escape(p.display_name)+'</strong> · '+escape(p.class_label||"Klasse offen")+'<p>'+escape(new Date(p.scanned_at).toLocaleString("de-DE",{dateStyle:"short",timeStyle:"short"}))+'</p></div>').join("")+'</div>':'<p>Es sind noch keine Schüler eingetragen.</p>')+'</div>';
         area.scrollIntoView({behavior:"smooth",block:"nearest"});
       }
       feedback("Teilnehmerliste geladen. Nur berechtigtes Schulpersonal kann sie einsehen.");
     }
     else if(action==="close"){
       if(!confirm("Diese Anwesenheitsliste schließen? Danach sind keine neuen Scans mehr möglich."))return;
       await rpc("close_attendance_session",{p_session_id:id});
       await stop();await refreshSessions();paint();feedback("Liste geschlossen.");
     }
   }catch(err){feedback(err.message||String(err),true);}finally{b.disabled=false;}
 });
}
window.SAS_ATTENDANCE={show,stop,createStudentPass};
})();