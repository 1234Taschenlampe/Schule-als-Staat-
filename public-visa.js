(function(){"use strict";
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const euro=n=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(Number(n||0)/100);
function form(){return '<section class="sas-public-visa"><div class="sas-public-visa-head"><span class="sas-kicker">SCHULE ALS STAAT · GÄSTE</span><h1>ViSA-Onboarding</h1><p>Du kommst von außerhalb? Beantrage hier dein ViSA ohne Bürgerkonto. Nach der E-Mail-Bestätigung folgt die sichere Bezahlung in Euro.</p></div><p class="sas-note" id="visa-availability" role="status">Verfügbarkeit wird geprüft …</p><form id="guest-visa-form" class="sas-form"><div class="sas-visa-grid"><label class="sas-field"><span>Vorname</span><input name="first_name" maxlength="80" required autocomplete="given-name"></label><label class="sas-field"><span>Nachname</span><input name="last_name" maxlength="80" required autocomplete="family-name"></label><label class="sas-field"><span>Herkunftsland</span><input name="origin_country" maxlength="80" required></label><label class="sas-field"><span>Geplantes Einreisedatum</span><input name="planned_entry" type="date" required></label><label class="sas-field"><span>Kontakt-E-Mail</span><input name="contact_email" type="email" maxlength="200" required autocomplete="email"></label><label class="sas-field"><span>Schule und Klasse (optional)</span><input name="school_class" maxlength="60"></label></div><label class="sas-visa-consent"><input type="checkbox" name="privacy_accepted" required> Ich habe die Datenschutzhinweise zur Bearbeitung dieses ViSA-Antrags gelesen. Meine Angaben werden nur für das ViSA-Verfahren verwendet und nicht öffentlich angezeigt.</label><div class="sas-visa-trap" aria-hidden="true"><label>Webseite<input name="website" tabindex="-1" autocomplete="off"></label></div><div id="visa-turnstile-container" aria-label="Bot-Schutz"></div><button id="visa-apply" class="sas-btn primary" type="submit" disabled>ViSA-Antrag starten</button><p id="guest-visa-feedback" role="status" aria-live="polite"></p></form><p class="sas-note">Es wird nichts abgebucht, bevor du ausdrücklich die Zahlungsseite aufrufst. Ein Antrag wird erst nach verifizierter E-Mail und serverseitig bestätigter Zahlung bearbeitet.</p></section>';}
async function showAdmin(api,node){node.innerHTML='<section class="sas-panel"><h2>ViSA-Anträge von Gästen</h2><p class="sas-note">Nur für Administratoren. Zahlungseingang wird vom Zahlungsanbieter geprüft.</p><div id="guest-visa-admin-list">Lade Anträge …</div></section>';const q=await api.from("guest_visa_applications").select("first_name,last_name,origin_country,planned_entry,contact_email,school_class,status,email_verified_at,paid_at,amount_cents,submitted_at").order("submitted_at",{ascending:false}).limit(100);const list=node.querySelector("#guest-visa-admin-list");if(q.error){list.textContent="Anträge konnten nicht geladen werden: "+q.error.message;return;}list.innerHTML=q.data.length?q.data.map(x=>'<article class="sas-item"><h3>'+esc(x.first_name+' '+x.last_name)+'</h3><p>'+esc(x.origin_country)+' · '+esc(x.school_class)+' · '+esc(x.planned_entry)+'</p><p>'+esc(x.contact_email)+' · Status: '+esc(x.status)+'</p><p>E-Mail: '+(x.email_verified_at?'verifiziert':'ausstehend')+' · Zahlung: '+(x.paid_at?'bestätigt ('+euro(x.amount_cents)+')':'nicht bestätigt')+'</p></article>').join(""):'Noch keine Gastanträge.';}
let turnstileLoader=null;
function loadTurnstile(){
 if(window.turnstile)return Promise.resolve(window.turnstile);
 if(turnstileLoader)return turnstileLoader;
 turnstileLoader=new Promise((resolve,reject)=>{
  const script=document.createElement("script");script.src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
  script.async=true;script.onload=()=>window.turnstile?resolve(window.turnstile):reject(new Error("Turnstile konnte nicht geladen werden"));
  script.onerror=()=>reject(new Error("Bot-Schutz konnte nicht geladen werden"));document.head.append(script);
 });
 return turnstileLoader;
}
async function showPublic(api,node){
 const status=node.querySelector("#visa-availability"),button=node.querySelector("#visa-apply");
 const slot=node.querySelector("#visa-turnstile-container");if(!status||!button||!slot)return;
 try{
  const r=await api.rpc("visa_public_settings");if(r.error)throw r.error;
  if(!r.data?.email_enabled || !r.data?.turnstile_site_key){
   status.textContent="Das ViSA-Antragsverfahren ist noch nicht freigeschaltet. "+
    (!r.data?.email_enabled?"Der E-Mail-Versand muss zuerst sicher eingerichtet werden. ":"Der Bot-Schutz ist noch nicht eingerichtet. ")+
    "Zurzeit können keine ViSA-Anträge eingereicht werden; es wird nichts abgebucht.";
   button.disabled=true;return;
  }
  status.textContent=r.data.payment_enabled?"E-Mail-Verifizierung und sicherer Euro-Checkout verfügbar.":"E-Mail-Bestätigung verfügbar. Die Zahlung wird freigeschaltet, sobald der ViSA-Preis beschlossen ist.";
  const turnstile=await loadTurnstile();
  if(!slot.isConnected)return;
  const widgetId=turnstile.render(slot,{sitekey:r.data.turnstile_site_key,action:"visa"});
  slot.dataset.widgetId=String(widgetId);button.disabled=false;
 }catch(e){status.textContent="ViSA derzeit nicht verfügbar. Bitte später erneut versuchen.";button.disabled=true;}
}
async function submit(api,formNode){
 const out=formNode.querySelector("#guest-visa-feedback"),btn=formNode.querySelector("button[type=submit]");
 if(btn.disabled)return;const f=new FormData(formNode);btn.disabled=true;out.textContent="Anfrage wird geprüft …";
 const widgetId=formNode.querySelector("#visa-turnstile-container")?.dataset.widgetId;
 try{
  const token=window.turnstile?.getResponse(widgetId);
  if(!token)throw Error("Bitte zuerst den Bot-Schutz bestätigen.");
  const data={first_name:String(f.get("first_name")||"").trim(),last_name:String(f.get("last_name")||"").trim(),
   origin_country:String(f.get("origin_country")||"").trim(),planned_entry:f.get("planned_entry"),
   contact_email:String(f.get("contact_email")||"").trim(),school_class:String(f.get("school_class")||"").trim(),
   privacy_accepted:f.has("privacy_accepted"),website:String(f.get("website")||"")};
  const r=await api.functions.invoke("visa-request",{body:{application:data,turnstileToken:token}});
  if(r.error)throw new Error(r.error.message||"Anfrage nicht verarbeitet");
  formNode.reset();out.textContent="Anfrage angenommen. Falls die Angaben akzeptiert wurden, erhältst du einen E-Mail-Bestätigungslink.";
  out.className="sas-visa-success";
 }catch(e){out.textContent="Anfrage nicht möglich: "+e.message;out.className="sas-visa-error";}
 finally{if(window.turnstile&&widgetId!==undefined)try{window.turnstile.reset(widgetId);}catch(e){}btn.disabled=false;}
}
/* The public verification and payment routes must render without requiring an account. */
function stage(message){
 return '<section class="sas-public-visa" aria-labelledby="visa-stage-title">'+
  '<div class="sas-public-visa-head"><span class="sas-kicker">SCHULE ALS STAAT · GÄSTE</span>'+
  '<h1 id="visa-stage-title">ViSA-Status</h1></div>'+
  '<p id="visa-stage-message" class="sas-note" role="status" aria-live="polite">'+esc(message)+'</p>'+
  '<div id="visa-stage-actions"></div></section>';
}
/* Never accept a payment destination provided directly by a visitor.
   Only the existing server-side checkout Edge Function creates a Stripe session. */
async function checkout(api,token,button,feedback){
 if(button.disabled)return;
 button.disabled=true;
 feedback.className="sas-note";
 feedback.textContent="Sichere Zahlungsseite wird vorbereitet …";
 try{
  if(!/^[0-9a-f]{64}$/.test(token))throw Error("Der Bestätigungslink ist ungültig.");
  const r=await api.functions.invoke("visa-create-checkout",{body:{token}});
  if(r.error)throw new Error(r.error.message||"Der Checkout ist derzeit nicht verfügbar.");
  const url=new URL(String(r.data?.url||""));
  if(url.protocol!=="https:"||url.hostname!=="checkout.stripe.com"){
   throw Error("Der Zahlungsanbieter hat kein gültiges Zahlungsziel bestätigt.");
  }
  feedback.textContent="Weiterleitung zum Zahlungsanbieter …";
  window.location.assign(url.href);
 }catch(e){
  feedback.className="sas-visa-error";
  feedback.textContent="Zahlung nicht möglich: "+(e?.message||"Unbekannter Fehler")+
    " Es wurde keine Zahlung durch diese Seite ausgelöst.";
  button.disabled=false;
 }
}
async function showVerification(api,node,token){
 node.innerHTML=stage("E-Mail-Bestätigung wird auf dem Server geprüft …");
 const feedback=node.querySelector("#visa-stage-message"),actions=node.querySelector("#visa-stage-actions");
 if(!/^[0-9a-f]{64}$/.test(token)){feedback.textContent="Ungültiger Bestätigungslink.";return;}
 try{const r=await api.rpc("verify_guest_visa_email",{p_token:token});if(r.error)throw r.error;
 feedback.textContent="Deine E-Mail-Adresse ist bestätigt. "+(r.data.payment_enabled?"Jetzt kannst du dein ViSA sicher in Euro bezahlen.":"Die Euro-Zahlung wird derzeit noch eingerichtet. Du musst nichts bezahlen.");
 if(!r.data.payment_enabled)return;
 const line=document.createElement("p");line.textContent="ViSA-Preis: "+euro(r.data.price_cents);
 const btn=document.createElement("button");btn.type="button";btn.className="sas-btn primary";btn.textContent="Jetzt sicher mit Karte / Apple Pay / Google Pay bezahlen";
 const msg=document.createElement("p");msg.setAttribute("role","status");
 btn.addEventListener("click",()=>checkout(api,token,btn,msg));
 actions.append(line,btn,msg);
 }catch(e){feedback.textContent="Der Bestätigungslink ist ungültig, abgelaufen oder die Prüfung derzeit nicht möglich.";}}
function showPaidRedirect(node){node.innerHTML=stage("Danke! Die Zahlungsseite wurde verlassen. Deine Zahlung wird serverseitig beim Zahlungsanbieter überprüft. Nur eine bestätigte Euro-Zahlung schaltet den Antrag für die Verwaltung frei.");}
window.SAS_PUBLIC_VISA={form,submit,showAdmin,showPublic,showVerification,showPaidRedirect};
})();
