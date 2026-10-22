/* SaS ONE: Work hours, 12–16 July 2027. Server is authoritative. */
(function(){
"use strict";
let context,host,scanner;
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
async function rpc(name,args={}){const r=await context.api.rpc(name,args);if(r.error)throw r.error;return r.data;}
async function stop(){const s=scanner;scanner=null;if(s){try{if(s.isScanning)await s.stop();}catch(_){}try{s.clear();}catch(_){}}}
function notice(t,error=false){const el=host.querySelector("#work-status");if(el){el.textContent=t;el.className="sas-feedback"+(error?" error":"");}}
async function show(ctx){
 await stop();context=ctx;host=ctx.target;
 const checker=ctx.profile?.role==="admin"||ctx.schoolRoles?.operator||ctx.schoolRoles?.can_check_attendance;
 host.innerHTML='<div class="sas-space"><div class="sas-heading"><div><span class="sas-kicker">SCHULE ALS STAAT · 12.–16. JULI 2027</span><h1>Meine Arbeitszeit</h1><p>Mindestens fünf Stunden an jedem der fünf Tage. Mehrarbeit ersetzt keine fehlende Tageszeit. Pausen zählen nicht.</p></div></div><section class="sas-panel"><h2>Arbeitszeiten</h2><div id="work-days">Lade …</div><button type="button" class="sas-btn soft" id="work-refresh">Aktualisieren</button></section><section class="sas-panel"><h2>Arbeitsbeginn und Arbeitsende</h2><p>Zeige den kurzzeitig gültigen QR-Code einer berechtigten Aufsicht. Der erste Scan beginnt, der nächste beendet deine Schicht.</p><button type="button" class="sas-btn primary" id="work-generate">QR-Code erstellen</button><div id="work-qr" class="verify-qr-wrap"></div></section>'+(checker?'<section class="sas-panel"><h2>Arbeitsausweis scannen</h2><div id="work-camera"></div><button type="button" class="sas-btn primary" id="work-camera-start">Kamera starten</button><button type="button" class="sas-btn soft" id="work-camera-stop">Kamera stoppen</button><form class="sas-form" id="work-manual"><label class="sas-field"><span>Alternativ QR-Inhalt</span><input name="code" autocomplete="off" required></label><button class="sas-btn soft" type="submit">Scan bestätigen</button></form></section>':'')+'<p id="work-status" role="status" aria-live="polite" class="sas-feedback"></p></div>';
 async function refresh(){const data=await rpc("my_work_hours");const days=data.days||[];host.querySelector("#work-days").innerHTML=days.map(d=>'<div class="sas-item"><strong>'+esc(new Date(d.date+"T12:00:00").toLocaleDateString("de-DE",{weekday:"short",day:"2-digit",month:"2-digit"}))+'</strong> · '+Math.floor(d.minutes/60)+' Std. '+(d.minutes%60)+' Min. / 5 Std. · '+(d.complete?"Erfüllt":d.open?"Schicht läuft":"Noch nicht erfüllt")+'</div>').join("")+'<p class="sas-note">Erfüllte Tage: '+days.filter(d=>d.complete).length+' von 5</p>';}
 async function scan(code){const result=await rpc("scan_work_token",{p_code:code});notice(result.action==="started"?"Arbeitsbeginn gespeichert.":"Arbeitsende gespeichert.");await refresh();}
 host.querySelector("#work-refresh").addEventListener("click",()=>refresh().catch(e=>notice(e.message,true)));
 host.querySelector("#work-generate").addEventListener("click",async e=>{e.currentTarget.disabled=true;try{const token=await rpc("create_work_scan_token");const node=host.querySelector("#work-qr");node.replaceChildren();if(!window.QRCode)throw Error("QR-Bibliothek fehlt.");new window.QRCode(node,{text:token,width:220,height:220});notice("QR-Code zwei Minuten gültig und einmal verwendbar.");}catch(err){notice(err.message,true);}finally{e.currentTarget.disabled=false;}});
 if(checker){
 host.querySelector("#work-manual").addEventListener("submit",async e=>{e.preventDefault();const btn=e.target.querySelector("button");btn.disabled=true;try{await scan(new FormData(e.target).get("code"));e.target.reset();}catch(err){notice(err.message,true);}finally{btn.disabled=false;}});
 host.querySelector("#work-camera-stop").addEventListener("click",()=>stop().then(()=>notice("Kamera gestoppt.")));
 host.querySelector("#work-camera-start").addEventListener("click",async()=>{try{await stop();if(!window.Html5Qrcode)throw Error("Scannerbibliothek fehlt.");scanner=new window.Html5Qrcode("work-camera");let busy=false;await scanner.start({facingMode:"environment"},{fps:8,qrbox:220},async code=>{if(busy)return;busy=true;await stop();try{await scan(code);}catch(e){notice(e.message,true);}},()=>{});}catch(e){notice(e.message,true);}});
 }
 await refresh();
}
window.SAS_WORK_HOURS={show,stop};
})();