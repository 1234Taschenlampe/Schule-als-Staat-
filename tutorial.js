/* SaS ONE: First-use tutorial for fifth graders. No actual passwords, payments or practice answers are collected. */
(function(){
"use strict";
const lessons=[
 {tag:"WILLKOMMEN",icon:"✦",title:"Hallo im Schulstaat!",desc:"Hier kannst du deinen Schülerausweis ansehen, Veranstaltungen finden und vieles mehr. Wir zeigen dir alles in kleinen Schritten.",question:"Tippe das Wort **LOS** in das Feld. Dann beginnt deine Entdeckungsreise.",answer:"LOS",hint:"Tipp: Das Wort steht fett in der Aufgabe.",tip:"Du musst hier keine persönlichen Daten eingeben."},
 {tag:"DEIN AUSWEIS",icon:"▣",title:"Wo ist mein Schülerausweis?",desc:"Im Bereich „Schülerausweis“ siehst du deine persönliche Projektkarte. Eine offiziell geprüfte Identität erhältst du erst nach der Kontrolle in der Schule.",question:"Wie heißt der Bereich mit deiner Karte? Tippe **AUSWEIS**.",answer:"AUSWEIS",hint:"Du suchst den Bereich „Schülerausweis“.",tip:"Deinen Ausweis findest du im Portal unter „Mein Bereich“."},
 {tag:"DEIN PASSWORT",icon:"●",title:"Ein Passwort bleibt geheim.",desc:"Dein Passwort ist nur für dich. Gib es niemals Freunden oder in fremde Formulare ein. Auch hier fragen wir dich NICHT nach deinem echten Passwort.",question:"Ein Passwort ist …? Tippe **GEHEIM**.",answer:"GEHEIM",hint:"Das Gegenteil von „öffentlich“.",tip:"Falls du Hilfe brauchst, frage eine erwachsene Vertrauensperson."},
 {tag:"SCHULVERIFIZIERUNG",icon:"▦",title:"So funktioniert dein Schul-QR.",desc:"Im Bereich „Schulverifizierung“ erstellst du einen QR-Code. Zeige ihn in der Schule. Eine berechtigte Person prüft dann deine Schulzugehörigkeit.",question:"Wo wird deine Identität geprüft? Tippe **SCHULE**.",answer:"SCHULE",hint:"Dort hast du Unterricht.",tip:"Ein QR-Code allein ist noch kein gültiger Schülerausweis."},
 {tag:"BEZAHLEN",icon:"◈",title:"Erst prüfen, dann bezahlen.",desc:"Mit der Schulwährung kannst du später im Projekt bezahlen. Schau dir vor jeder Buchung den Empfänger und den Betrag genau an. Hier wird KEIN Geld bewegt.",question:"Was machst du VOR jeder Zahlung? Tippe **PRÜFEN**.",answer:"PRÜFEN",hint:"Schau genau hin, bevor du etwas bestätigst.",tip:"Diese Übung ist kostenlos – wir buchen nichts von deinem Konto ab."},
 {tag:"DU BIST BEREIT",icon:"✓",title:"Du kennst die wichtigsten Dinge!",desc:"Du weißt jetzt, wo dein Ausweis ist, wie du dein Passwort schützt und wie der Schul-QR funktioniert. Du kannst jederzeit alle anderen Bereiche entdecken.",question:"Zum Abschluss: Tippe **FERTIG**.",answer:"FERTIG",hint:"Das Wort, wenn alles geschafft ist.",tip:"Du findest die Einführung später unter „Einstellungen“ wieder."}
];
const escape=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const normalize=s=>String(s||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").trim().replace(/\s+/g," ").toLocaleUpperCase("de-DE");
let api=null,userId="",progress=0,dialog=null,active=false,accountVersion=0,waiting=false,finished=false;
function asHtml(text){return escape(text).replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>");}
function find(selector){return dialog?.querySelector(selector);}
function hide(){
 if(!dialog)return;
 try{if(dialog.open)dialog.close();}catch(e){}
 dialog.remove();
 dialog=null;active=false;waiting=false;finished=false;
}
async function readProgress(currentApi,uid){
 const out=await currentApi.from("student_onboarding").select("current_step,completed_at").eq("user_id",uid).maybeSingle();
 if(out.error)throw out.error;
 return out.data||{current_step:0,completed_at:null};
}
async function saveProgress(step){
 if(!api||!userId)throw Error("Du bist nicht angemeldet.");
 const fields={user_id:userId,current_step:step,updated_at:new Date().toISOString(),completed_at:step>=lessons.length?new Date().toISOString():null};
 const r=await api.from("student_onboarding").upsert(fields,{onConflict:"user_id"});
 if(r.error)throw r.error;
 progress=step;
}
function renderLesson(){
 if(!dialog)return;
 if(progress>=lessons.length){renderDone();return;}
 const p=lessons[progress];
 dialog.innerHTML='<div class="intro-head"><div class="intro-kicker"><span class="intro-spark">✦</span> DEIN ERSTER BESUCH <span class="intro-number">Schritt '+(progress+1)+' von '+lessons.length+'</span></div><div class="intro-progress" role="progressbar" aria-label="Fortschritt" aria-valuemin="0" aria-valuemax="'+lessons.length+'" aria-valuenow="'+progress+'"><div class="intro-progress-bar" style="width:'+(progress/lessons.length*100)+'%"></div></div></div>'+
  '<div class="intro-main"><div class="intro-step-icon" aria-hidden="true">'+p.icon+'</div><span class="intro-topic">'+escape(p.tag)+'</span><h2 id="intro-title">'+escape(p.title)+'</h2><p class="intro-description">'+escape(p.desc)+'</p>'+
  '<div class="intro-practice"><div class="intro-practice-label"><span class="intro-keyboard" aria-hidden="true">⌨</span> JETZT BIST DU DRAN</div><p>'+asHtml(p.question)+'</p>'+
  '<form id="intro-answer-form"><label for="intro-answer">Deine Antwort</label><div class="intro-answer-line"><input id="intro-answer" name="answer" type="text" autocomplete="off" autocapitalize="characters" spellcheck="false" maxlength="24" placeholder="Hier eintippen …" required aria-describedby="intro-feedback"><button class="intro-primary" type="submit">Weiter <span aria-hidden="true">→</span></button></div><p id="intro-feedback" class="intro-feedback" role="status" aria-live="polite"></p></form></div>'+
  '<p class="intro-tip">ⓘ '+escape(p.tip)+'</p></div>'+
  '<div class="intro-footer"><button type="button" class="intro-text-button" data-intro="later">Später weitermachen</button><div class="intro-footer-right">'+(progress?'<button type="button" class="intro-text-button" data-intro="back">← Zurück</button>':'')+'<span>Nur zum Üben · Keine echten Daten</span></div></div>';
 const input=find("#intro-answer");
 if(input)input.focus({preventScroll:true});
}
function renderDone(){
 finished=true;
 dialog.innerHTML='<div class="intro-finished"><div class="intro-success-mark" aria-hidden="true">✓</div><div class="intro-kicker">ALLE '+lessons.length+' SCHRITTE GESCHAFFT</div><h2 id="intro-title">Super! Du bist startklar.</h2><p>Deine Einführung ist abgeschlossen. Jetzt kannst du die Webseite erkunden. Bei Fragen hilft dir die Schulverwaltung.</p><button type="button" class="intro-primary" data-intro="done">Zum Schulportal <span aria-hidden="true">→</span></button><p>Das Tutorial findest du jederzeit in den Einstellungen.</p></div>';
}
function show(){
 if(!document.body||!document.createElement)return;
 hide();
 dialog=document.createElement("dialog");
 dialog.id="sas-onboarding";
 dialog.className="sas-onboarding";
 dialog.setAttribute("aria-labelledby","intro-title");
 dialog.setAttribute("aria-describedby","intro-instructions");
 dialog.addEventListener("close",()=>{if(dialog&&!dialog.open)hide();});
 dialog.addEventListener("cancel",()=>{hide();});
 dialog.addEventListener("click",event=>{
  const button=event.target.closest("[data-intro]");
  if(!button)return;
  if(button.dataset.intro==="later"||button.dataset.intro==="done"){hide();return;}
  if(button.dataset.intro==="back"&&!waiting&&progress>0){
    progress--;renderLesson();
  }
 });
 dialog.addEventListener("submit",async event=>{
   if(event.target.id!=="intro-answer-form")return;
   event.preventDefault();
   if(waiting)return;
   const actual=normalize(find("#intro-answer")?.value);
   const expected=normalize(lessons[progress]?.answer);
   const info=find("#intro-feedback");
   if(actual!==expected){
     if(info){info.textContent="Fast! "+lessons[progress].hint+" Versuche es noch einmal.";info.classList.add("intro-wrong");}
     find("#intro-answer")?.focus();
     return;
   }
   waiting=true;
   const button=find('button[type="submit"]');
   if(button){button.disabled=true;button.textContent="Wird gespeichert …";}
   try{
      await saveProgress(progress+1);
      if(info){info.textContent="Richtig! Sehr gut gemacht.";info.classList.remove("intro-wrong");}
      renderLesson();
   }catch(e){
      if(info){info.textContent="Dein Fortschritt konnte gerade nicht gespeichert werden. Bitte erneut versuchen.";info.classList.add("intro-wrong");}
      if(button){button.disabled=false;button.innerHTML='Weiter <span aria-hidden="true">→</span>';}
   }finally{waiting=false;}
 });
 document.body.appendChild(dialog);
 renderLesson();
 if(typeof dialog.showModal==="function")dialog.showModal();
 else dialog.setAttribute("open","");
 active=true;
}
async function start(currentApi,uid,opts={}){
 const version=++accountVersion;
 hide();
 api=currentApi;userId=uid||"";progress=0;
 if(!api||!userId)return;
 if(opts.auto===false)return;
 try{
  const row=await readProgress(api,userId);
  if(version!==accountVersion||uid!==userId)return;
  if(row.completed_at||Number(row.current_step)>=lessons.length)return;
  progress=Math.max(0,Math.min(lessons.length-1,Number(row.current_step)||0));
  show();
 }catch(e){
  // Do not prevent access to the actual portal if the tutorial service is unavailable.
  console.warn("Einführung konnte nicht gestartet werden.",e?.message||e);
 }
}
async function reopen(currentApi,uid){
 ++accountVersion;
 hide();
 api=currentApi;userId=uid;progress=0;
 if(!api||!uid)throw Error("Bitte zuerst anmelden.");
 show();
}
function logout(){++accountVersion;hide();api=null;userId="";progress=0;}
window.SAS_TUTORIAL={start,reopen,logout,lessonsCount:lessons.length};
})();