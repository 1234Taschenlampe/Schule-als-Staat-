(() => {
"use strict";
const main=document.getElementById("visa-main"), message=document.getElementById("visa-message"), cfg=window.NV_CONFIG||{};
const api=window.supabase?.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
let mode="", stationKey="", quote=null, draft=null, current=null, scanner=null, generation=0, busy=false;
const statusLabels={pending:"Zahlung und Verifizierung ausstehend",booked:"Freigeschaltet, noch nicht gültig",active:"Gültig",expired:"Abgelaufen",refunded:"Erstattet und gesperrt"};
const euro=n=>new Intl.NumberFormat("de-DE",{style:"currency",currency:"EUR"}).format(Number(n)/100);
const randomKey=()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),x=>x.toString(16).padStart(2,"0")).join("");
function notify(t){message.textContent=t;}
function element(tag,value,cls){const node=document.createElement(tag);node.textContent=String(value??"");if(cls)node.className=cls;return node;}
function button(t,fn){const b=element("button",t,"btn");b.type="button";b.addEventListener("click",fn);return b;}
function textLine(parent,label,value){parent.append(element("p",label+": "+value));}
function codeLine(parent,value){parent.append(element("code",value,"visa-code"));}
function validKey(s){return /^[a-f0-9]{64}$/.test(s);}
async function call(action,key,input={}){
 if(!validKey(key))throw Error("Ungültiger Zugangsschlüssel.");
 const res=await fetch(cfg.supabaseUrl+"/functions/v1/onsite-visa",{method:"POST",headers:{"Content-Type":"application/json","apikey":cfg.supabaseAnonKey},body:JSON.stringify({action,key,input}),cache:"no-store"});
 if(!res.ok)throw Error(res.status===429?"Zu viele Anfragen. Bitte kurz warten.":"Zugang, Zeitraum oder Freigabe prüfen.");
 return res.json();
}
async function staff(action,input={}){
 if(!api)throw Error("Verbindung nicht verfügbar.");
 const result=await api.rpc("onsite_visa_staff",{p_action:action,p_input:input});
 if(result.error)throw Error("Aktion nicht möglich. Berechtigung und Angaben prüfen.");
 return result.data;
}
async function stopScan(){const s=scanner;scanner=null;if(s)try{await s.stop();s.clear();}catch{}}
async function guarded(fn){
 if(busy)return;busy=true;const g=generation;
 document.querySelectorAll("button").forEach(b=>b.disabled=true);
 try{await fn(g);}catch(e){if(g===generation)notify(e.message||"Anfrage fehlgeschlagen.");}
 finally{busy=false;document.querySelectorAll("button").forEach(b=>b.disabled=false);}
}
function stationForm(){
 main.innerHTML='<h2>Gast registrieren</h2><p>Der Preis wird durch die Verwaltung festgelegt. Bezahlen und persönlich verifizieren beim Personal.</p><form id="visa-create"><label>Erster Besuchstag<input type="date" name="from" min="2027-07-12" max="2027-07-16" value="2027-07-12" required></label><label>Letzter Besuchstag<input type="date" name="to" min="2027-07-12" max="2027-07-16" value="2027-07-12" required></label><button class="btn primary" type="submit">Antrag und QR-Code erstellen</button></form>';
 main.prepend(element("p","Tagespreis: "+euro(quote.daily_price_cents)));
 main.append(button("Station abmelden",()=>switchMode("station")));
 main.querySelector("form").addEventListener("submit",e=>{e.preventDefault();void guarded(async g=>{
  const data=new FormData(e.target), from=String(data.get("from")),to=String(data.get("to"));
  if(!draft)draft={request_id:crypto.randomUUID(),guest_key:randomKey(),valid_from:from,valid_to:to};
  if(draft.valid_from!==from||draft.valid_to!==to)throw Error("Antrag bereits begonnen. Bitte ursprünglichen Zeitraum verwenden oder Station neu starten.");
  const pass=await call("station_create",stationKey,draft);if(g!==generation)return;
  main.replaceChildren(element("h2","Antrag erstellt"));
  textLine(main,"Zu zahlen",euro(pass.price_cents));textLine(main,"Zeitraum",pass.valid_from+" bis "+pass.valid_to);
  textLine(main,"Status",statusLabels[pass.status]||pass.status);
  main.append(element("p","Diesen QR-Code beim Personal vorzeigen. Er bestätigt noch keine Zahlung."));
  const qr=element("div","");qr.id="visa-qr";main.append(qr);
  const scanCode="VISA:"+pass.id;
  if(window.QRCode)new window.QRCode(qr,{text:scanCode,width:196,height:196});codeLine(main,scanCode);
  main.append(element("p","Persönlicher Gastzugang: separat und vertraulich aufbewahren. Nicht dem Personal zeigen. Erst nach Freigabe gültig."));
  codeLine(main,draft.guest_key);
  main.append(button("Gastschlüssel kopieren",()=>navigator.clipboard.writeText(draft.guest_key).catch(()=>notify("Bitte Schlüssel manuell kopieren."))));
  main.append(button("Nächster Gast – Daten löschen",()=>{draft=null;notify("");stationForm();}));
 });});
}
function stationLogin(){
 main.innerHTML='<h2>Station anmelden</h2><form><label>Stationsschlüssel<input type="password" name="key" maxlength="64" autocomplete="off" required></label><button class="btn primary" type="submit">Station öffnen</button></form>';
 main.querySelector("form").addEventListener("submit",e=>{e.preventDefault();void guarded(async g=>{const key=String(new FormData(e.target).get("key")).trim();const q=await call("station_quote",key);if(g!==generation)return;stationKey=key;quote=q;stationForm();notify("Station bereit.");});});
}
function guestForm(){
 main.innerHTML='<h2>Mein ViSA</h2><p>Nur für vor Ort registrierte Gäste.</p><form><label>Persönlicher Gastschlüssel<input name="key" type="password" maxlength="64" autocomplete="off" required></label><button class="btn primary" type="submit">ViSA anzeigen</button></form><div id="visa-guest-result"></div>';
 main.querySelector("form").addEventListener("submit",e=>{e.preventDefault();void guarded(async g=>{const key=String(new FormData(e.target).get("key")).trim();const out=main.querySelector("#visa-guest-result");out.replaceChildren();const r=await call("guest_status",key);if(g!==generation)return;out.append(element("h3",statusLabels[r.status]||r.status));textLine(out,"Zeitraum",r.valid_from+" bis "+r.valid_to);textLine(out,"ViSA-Gebühr",euro(r.price_cents));textLine(out,"Zahlung",r.paid?"Erfasst":"Ausstehend");e.target.reset();});});
}
function parseCode(s){const id=String(s).trim().replace(/^VISA:/i,"");if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))throw Error("Ungültiger Antragscode.");return id;}
async function lookup(raw,g){const id=parseCode(raw);current=null;const result=main.querySelector("#visa-staff-result");result.replaceChildren();const p=await staff("lookup",{id});if(g!==generation)return;current=p;result.append(element("h3","ViSA-Antrag"),element("p",statusLabels[p.status]||p.status));textLine(result,"Preis",euro(p.price_cents));textLine(result,"Zeitraum",p.valid_from+" bis "+p.valid_to);
 if(p.status==="pending"){
  const form=document.createElement("form");form.innerHTML='<label>Bargeld erhalten (Eurocent, exakt)<input name="amount" type="number" min="1" step="1" required></label><label><input type="checkbox" name="paid" required> Echtgeld persönlich entgegengenommen</label><label><input type="checkbox" name="verified" required> Gast persönlich verifiziert</label><button class="btn primary" type="submit">Zahlung bestätigen und ViSA freischalten</button>';
  form.addEventListener("submit",e=>{e.preventDefault();void guarded(async g2=>{const data=new FormData(form);const r=await staff("confirm",{id:p.id,amount_cents:Number(data.get("amount")),cash_received:data.has("paid"),verified:data.has("verified")});if(g2!==generation)return;await lookup(p.id,g2);notify("Zahlung erfasst. "+(statusLabels[r.status]||r.status));});});result.append(form);
 }
}
function staffForm(){
 main.innerHTML='<h2>Personal · Zahlung und Freigabe</h2><p>Mit dem persönlichen Schul-Operator- oder Admin-Konto im Schulportal anmelden. Kein Stationsschlüssel berechtigt zu dieser Aktion.</p><form id="visa-lookup"><label>QR-Antragscode<input name="code" maxlength="41" required></label><button type="submit" class="btn primary">Antrag laden</button></form><div class="visa-actions" id="visa-scan-actions"></div><div id="visa-scan"></div><div id="visa-staff-result"></div><div id="visa-admin"></div>';
 main.querySelector("form").addEventListener("submit",e=>{e.preventDefault();void guarded(g=>lookup(new FormData(e.target).get("code"),g));});
 const scanActions=main.querySelector("#visa-scan-actions");
 scanActions.append(button("QR mit Kamera scannen",()=>{void guarded(async g=>{
  if(!window.Html5Qrcode)throw Error("Kamera nicht verfügbar. Code manuell eingeben.");
  await stopScan();scanner=new window.Html5Qrcode("visa-scan");
  await scanner.start({facingMode:"environment"},{fps:8,qrbox:220},raw=>{if(g!==generation||!scanner)return;void stopScan().then(()=>guarded(g2=>lookup(raw,g2)));},()=>{});
 });}),button("Kamera stoppen",()=>{void stopScan();}));
 main.querySelector("#visa-admin").append(button("Admin-Finanzübersicht",()=>{void guarded(adminReport);}));
}
async function adminReport(g){
 const data=await staff("report");if(g!==generation)return;
 const target=main.querySelector("#visa-admin");target.replaceChildren(element("h2","ViSA-Finanzverwaltung"));
 textLine(target,"Bargeld-Einnahmen",euro(data.gross_cents));textLine(target,"Erstattungen",euro(data.refund_cents));textLine(target,"Netto",euro(data.gross_cents-data.refund_cents));
 const config=document.createElement("form");config.innerHTML='<label>Tagespreis in Eurocent<input name="price" type="number" min="1" max="10000" required></label><label><input name="enabled" type="checkbox"> Vor-Ort-Betrieb ausdrücklich freigeben</label><button class="btn" type="submit">Konfiguration speichern</button>';
 config.elements.price.value=data.daily_price_cents??"";config.elements.enabled.checked=data.enabled;
 config.addEventListener("submit",e=>{e.preventDefault();void guarded(async g2=>{const f=new FormData(config);await staff("configure",{daily_price_cents:Number(f.get("price")),enabled:f.has("enabled")});await adminReport(g2);});});target.append(config);
 const add=document.createElement("form");add.innerHTML='<label>Stationsbezeichnung<input name="label" maxlength="60" required></label><button class="btn" type="submit">Stationsschlüssel erstellen</button>';
 add.addEventListener("submit",e=>{e.preventDefault();void guarded(async g2=>{const r=await staff("station_add",{label:new FormData(add).get("label")});if(g2!==generation)return;await adminReport(g2);const reveal=element("div","");reveal.append(element("p","Einmaliger Stationsschlüssel – vertraulich an die Station übergeben:"),element("code",r.station_key,"visa-code"),button("Schlüssel ausblenden",()=>reveal.remove()));main.querySelector("#visa-admin").prepend(reveal);});});target.append(add);
 for(const s of data.stations){const row=element("div","","visa-row");textLine(row,s.label,s.active?"Aktiv":"Gesperrt");if(s.active)row.append(button("Station sperren",()=>{void guarded(async g2=>{await staff("station_revoke",{station_id:s.id});await adminReport(g2);});}));target.append(row);}
 target.append(element("h3","Letzte 100 Anträge"));
 for(const p of data.recent){const row=element("div","","visa-row");textLine(row,p.id,euro(p.price_cents));textLine(row,"Status",statusLabels[p.status]||p.status);if(p.paid_at&&p.status!=="refunded"){const f=document.createElement("form");f.innerHTML='<label>Erstattungsgrund<input name="reason" minlength="3" maxlength="200" required></label><label><input name="returned" type="checkbox" required> Bargeld tatsächlich zurückgegeben</label><button type="submit" class="btn">Erstattung buchen und ViSA sperren</button>';f.addEventListener("submit",e=>{e.preventDefault();void guarded(async g2=>{const v=new FormData(f);await staff("refund",{id:p.id,reason:v.get("reason"),cash_returned:v.has("returned")});await adminReport(g2);});});row.append(f);}target.append(row);}
}
function switchMode(next){generation++;void stopScan();mode=next;stationKey="";quote=null;draft=null;current=null;notify("");if(next==="station")stationLogin();else if(next==="staff")staffForm();else guestForm();}
document.querySelectorAll("[data-mode]").forEach(b=>b.addEventListener("click",()=>switchMode(b.dataset.mode)));
window.addEventListener("pagehide",()=>{stationKey="";draft=null;void stopScan();main.replaceChildren();});
switchMode("guest");
})();