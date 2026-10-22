/* Interactive first-use tour: visits real portal pages; no typing or test payments. */
(function(){"use strict";
const steps=[
 {page:"home",title:"Willkommen in deinem Schulstaat",desc:"Das ist deine Startseite. Wir besuchen jetzt gemeinsam die wichtigsten Bereiche."},
 {page:"idcard",title:"Dein Schülerausweis",desc:"Hier ist dein persönlicher Ausweis mit festem QR-Code. Er wird beim Scannen zur Zuordnung verwendet."},
 {page:"wallet",title:"Dein Guthaben",desc:"Hier siehst du deine Schulwährung und Buchungen. Nur die Verwaltung kann neues Guthaben ausgeben."},
 {page:"pay",title:"So funktioniert Bezahlen",desc:"Hier kannst du einen Zahlungs-QR scannen. Vor einer echten Zahlung musst du Empfänger und Betrag bestätigen. Im Tutorial wird nichts bezahlt."},
 {page:"votes",title:"Mitbestimmen",desc:"Hier findest du Abstimmungen und Umfragen. Wir geben während der Einführung keine Stimme ab."},
 {page:"lost",title:"Fundsachen",desc:"Hier kannst du verlorene oder gefundene Gegenstände melden. Wir speichern jetzt keine Meldung."}
];
let api=null,uid="",step=0,layer=null,version=0,busy=false,finished=false;
const esc=s=>String(s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function clear(){if(layer){layer.remove();layer=null;}busy=false;finished=false;document.querySelectorAll(".sas-tour-highlight").forEach(x=>x.classList.remove("sas-tour-highlight"));}
function focusPage(page){const nav=window.SAS_TUTORIAL_NAV;if(typeof nav==="function")nav(page);}
async function save(n){if(!api||!uid)return;const r=await api.from("student_onboarding").upsert({user_id:uid,current_step:n,updated_at:new Date().toISOString(),completed_at:n>=steps.length?new Date().toISOString():null},{onConflict:"user_id"});if(r.error)throw r.error;}
function draw(){if(!layer)return;if(step>=steps.length){finished=true;layer.innerHTML='<div class="sas-tour-panel" role="dialog" aria-labelledby="sas-tour-title"><div class="sas-tour-counter">Einführung abgeschlossen</div><h2 id="sas-tour-title">Du kennst dich jetzt aus!</h2><p>Du hast die wichtigsten Seiten direkt in der App besucht. Du kannst die Einführung später in den Einstellungen wiederholen.</p><div class="sas-tour-actions"><button class="btn primary" data-tour="done">Zum Portal</button></div></div>';return;}
const s=steps[step];focusPage(s.page);
layer.innerHTML='<div class="sas-tour-panel" role="dialog" aria-labelledby="sas-tour-title" aria-describedby="sas-tour-desc"><div class="sas-tour-counter">Rundgang · '+(step+1)+' von '+steps.length+'</div><div class="sas-tour-progress"><span style="width:'+((step+1)/steps.length*100)+'%"></span></div><h2 id="sas-tour-title">'+esc(s.title)+'</h2><p id="sas-tour-desc">'+esc(s.desc)+'</p><div class="sas-tour-actions"><button class="btn" data-tour="later">Später</button>'+(step?'<button class="btn" data-tour="back">Zurück</button>':'')+'<button class="btn primary" data-tour="next">'+(step===steps.length-1?'Abschließen':'Weiter →')+'</button></div></div>';
}
function show(){clear();layer=document.createElement("div");layer.id="sas-guided-tour";layer.className="sas-guided-tour";layer.setAttribute("aria-live","polite");layer.addEventListener("click",async e=>{const action=e.target.closest("[data-tour]")?.dataset.tour;if(!action||busy)return;if(action==="later"||action==="done"){clear();return;}busy=true;const button=e.target.closest("button");if(button)button.disabled=true;try{if(action==="back"){step=Math.max(0,step-1);draw();}else if(action==="next"){await save(step+1);step++;draw();}}catch(err){const p=layer?.querySelector("#sas-tour-desc");if(p)p.textContent="Fortschritt konnte nicht gespeichert werden. Bitte erneut versuchen.";}finally{busy=false;}});document.body.append(layer);draw();}
async function start(client,user,options={}){const token=++version;clear();api=client;uid=user||"";step=0;if(!api||!uid||options.auto===false)return;try{const r=await api.from("student_onboarding").select("current_step,completed_at").eq("user_id",uid).maybeSingle();if(r.error)throw r.error;if(token!==version||uid!==user)return;if(r.data?.completed_at||Number(r.data?.current_step)>=steps.length)return;step=Math.max(0,Math.min(steps.length-1,Number(r.data?.current_step)||0));show();}catch(err){console.warn("Rundgang nicht verfügbar",err?.message||err);}}
async function reopen(client,user){++version;clear();api=client;uid=user;step=0;if(!api||!uid)throw Error("Bitte anmelden.");show();}
function logout(){++version;clear();api=null;uid="";step=0;}
window.SAS_TUTORIAL={start,reopen,logout,lessonsCount:steps.length};
})();