/* Interactive first-use tour: visits real portal pages; no typing or test payments. */
(function(){"use strict";
const fullSteps=[
 {page:"home",title:"Rundgang durch das Portal",desc:"Hier findest du einen Überblick über Ausweis, Guthaben und Mitteilungen."},
 {page:"idcard",title:"Dein Schülerausweis",desc:"Dein digitaler Ausweis enthält einen festen QR-Code zur Identifikation im Projekt."},
 {page:"wallet",title:"Dein Guthaben",desc:"Hier siehst du deine Schulwährung und Buchungen. Nur die Verwaltung kann neues Guthaben ausgeben."},
 {page:"pay",title:"QR-Zahlungen",desc:"An der Kasse kannst du einen Zahlungs-QR-Code scannen. Eine Zahlung erfolgt erst nach deiner Bestätigung. In diesem Rundgang wird nichts bezahlt."},
 {page:"votes",title:"Mitbestimmen",desc:"Hier findest du Abstimmungen und Umfragen. Wir geben während der Einführung keine Stimme ab."},
 {page:"lost",title:"Fundsachen",desc:"Hier kannst du verlorene oder gefundene Gegenstände melden. Wir speichern jetzt keine Meldung."}
];
let steps=fullSteps;
function selectSteps(options={}){steps=(options.previewOnly?fullSteps.filter(s=>s.page==="home"||s.page==="idcard"||(options.pollsOpen!==false&&s.page==="votes")):fullSteps).filter(s=>s.page!=="votes"||options.pollsVisible===true);}
let api=null,uid="",step=0,layer=null,version=0,busy=false,finished=false;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function clear(){if(layer){layer.remove();layer=null;}busy=false;finished=false;document.querySelectorAll(".sas-tour-highlight").forEach(x=>x.classList.remove("sas-tour-highlight"));}
function focusPage(page){const nav=window.SAS_TUTORIAL_NAV;if(typeof nav==="function")nav(page);}
async function save(n){if(!api||!uid)return;const r=await api.from("student_onboarding").upsert({user_id:uid,current_step:n,updated_at:new Date().toISOString(),completed_at:n>=steps.length?new Date().toISOString():null},{onConflict:"user_id"});if(r.error)throw r.error;}
function draw(){if(!layer)return;if(step>=steps.length){finished=true;layer.innerHTML='<div class="sas-tour-panel" role="dialog" aria-labelledby="sas-tour-title"><div class="sas-tour-counter">Einführung abgeschlossen</div><h2 id="sas-tour-title">Rundgang abgeschlossen</h2><p>Du kannst den Rundgang in den Einstellungen erneut öffnen.</p><div class="sas-tour-actions"><button class="btn primary" data-tour="done">Zum Portal</button></div></div>';return;}
const s=steps[step];focusPage(s.page);
layer.innerHTML='<div class="sas-tour-panel" role="dialog" aria-labelledby="sas-tour-title" aria-describedby="sas-tour-desc"><div class="sas-tour-counter">Rundgang · '+(step+1)+' von '+steps.length+'</div><div class="sas-tour-progress"><span style="width:'+((step+1)/steps.length*100)+'%"></span></div><h2 id="sas-tour-title">'+esc(s.title)+'</h2><p id="sas-tour-desc">'+esc(s.desc)+'</p><div class="sas-tour-actions"><button class="btn" data-tour="later">Später</button>'+(step?'<button class="btn" data-tour="back">Zurück</button>':'')+'<button class="btn primary" data-tour="next">'+(step===steps.length-1?'Abschließen':'Weiter →')+'</button></div></div>';
}
function show(){clear();layer=document.createElement("div");layer.id="sas-guided-tour";layer.className="sas-guided-tour";layer.setAttribute("aria-live","polite");layer.addEventListener("click",async e=>{const action=e.target.closest("[data-tour]")?.dataset.tour;if(!action||busy)return;if(action==="later"||action==="done"){clear();return;}busy=true;const button=e.target.closest("button");if(button)button.disabled=true;try{if(action==="back"){step=Math.max(0,step-1);draw();}else if(action==="next"){step++;draw();save(step).catch(function(err){console.warn("Tutorial-Fortschritt konnte nicht gespeichert werden:",err?.message||err);});}}catch(err){const p=layer?.querySelector("#sas-tour-desc");if(p)p.textContent="Fortschritt konnte nicht gespeichert werden. Bitte erneut versuchen.";}finally{busy=false;}});document.body.append(layer);draw();}
async function start(client,user,options={}){const token=++version;clear();api=client;uid=user||"";step=0;selectSteps(options);if(!api||!uid||options.auto===false)return;try{const r=await api.from("student_onboarding").select("current_step,completed_at").eq("user_id",uid).maybeSingle();if(r.error)throw r.error;if(token!==version||uid!==user)return;if(r.data?.completed_at||Number(r.data?.current_step)>=steps.length)return;step=Math.max(0,Math.min(steps.length-1,Number(r.data?.current_step)||0));show();}catch(err){console.warn("Rundgang nicht verfügbar",err?.message||err);}}
async function reopen(client,user,options={}){++version;clear();api=client;uid=user;step=0;selectSteps(options);if(!api||!uid)throw Error("Bitte anmelden.");show();}
function logout(){++version;clear();api=null;uid="";step=0;}
window.SAS_TUTORIAL={start,reopen,logout,lessonsCount:fullSteps.length};
})();