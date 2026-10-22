/* SaS ONE | real, RLS-backed school modules. Existing Supabase session and V4 wallet remain authoritative. */
(function(){
"use strict";
const navigation=[
 ["idcard","Schülerausweis","Digitale, selbst gepflegte Ausweiskarte"],
 ["gallery","Ausweis-Galerie","Ausweisdesign wählen und speichern"],
 ["visa","ViSA","Einreiseanträge verwalten"],
 ["bulletin","Schwarzes Brett","Offizielle Nachrichten"],
 ["blog","Blog","Projektbeiträge"],
 ["shops","Geschäfte","Geschäfte und ihre Kassen"],
 ["map","Raumplan","Orte und Räume"],
 ["rooms","Raumreservierung","Raumreservierung"],
 ["events","Veranstaltungen","Termine und Anmeldungen"],
 ["lost","Fundbüro","Verloren und gefunden"],
 ["jobs","Berufe","Offene Stellen und Bewerbungen"],
 ["laws","Gesetze","Regeln und Verordnungen"],
 ["parties","Parteien","Parteien und Mitteilungen"],
 ["courts","Gerichte","Öffentliche Bekanntmachungen"]
];
const pages=Object.fromEntries(navigation.map(([key,label])=>[key,label]));
const civicMap={jobs:"job",laws:"law",parties:"party",courts:"court"};
const escapeHtml=(v)=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const escapeAttr=escapeHtml;
const trim=(v)=>String(v??"").trim();
const msg=(s)=>'<p class="sas-note">'+escapeHtml(s)+'</p>';
const date=(v)=>v?new Date(v).toLocaleString("de-DE",{dateStyle:"medium",timeStyle:"short"}):"–";
const fmtDate=(v)=>v?new Date(v).toLocaleDateString("de-DE"):"–";
const badge=(v)=>'<span class="sas-badge" data-status="'+escapeAttr(v)+'">'+escapeHtml(({pending:"In Prüfung",submitted:"Eingereicht",approved:"Genehmigt",rejected:"Abgelehnt",open:"Offen",resolved:"Erledigt",room:"Raum",shop:"Geschäft",service:"Service",other:"Ort"})[v]||v)+'</span>';
const empt=(t)=>'<div class="sas-empty"><span>○</span><p>'+escapeHtml(t)+'</p></div>';
const btn=(text,action,id,kind="soft")=>'<button class="sas-btn '+kind+'" data-feature-action="'+escapeAttr(action)+'"'+(id?' data-id="'+escapeAttr(id)+'"':'')+(kind==='muted'?' disabled':'')+'>'+escapeHtml(text)+'</button>';
const linkPage=(text,page)=>'<button class="sas-btn soft" data-feature-action="navigate" data-id="'+escapeAttr(page)+'">'+escapeHtml(text)+' →</button>';
const box=(title,body)=>'<section class="sas-panel"><h2>'+escapeHtml(title)+'</h2>'+body+'</section>';
const input=(label,name,type="text",extra="")=>'<label class="sas-field"><span>'+escapeHtml(label)+'</span><input name="'+escapeAttr(name)+'" type="'+escapeAttr(type)+'" '+extra+' required></label>';
const textArea=(label,name,maximum=1500)=>'<label class="sas-field"><span>'+escapeHtml(label)+'</span><textarea name="'+escapeAttr(name)+'" maxlength="'+Number(maximum)+'" required></textarea></label>';
const form=(kind,inner,submit)=>'<form class="sas-form" data-feature-form="'+escapeAttr(kind)+'">'+inner+'<button type="submit" class="sas-btn primary">'+escapeHtml(submit)+'</button></form>';
const card=(heading,text,more="")=>'<article class="sas-item"><h3>'+escapeHtml(heading)+'</h3><p>'+escapeHtml(text)+'</p>'+more+'</article>';
const wrap=(page,body,extra="")=>'<div class="sas-space"><div class="sas-heading"><div><span class="sas-kicker">SCHULPORTAL</span><h1>'+escapeHtml(pages[page])+'</h1><p>'+escapeHtml(navigation.find(a=>a[0]===page)?.[2]||"")+'</p></div></div>'+body+extra+'</div>';
let ctx=null, current="",target=null,data=[],related=[],busy=false,stamp=0;
function admin(){return ctx?.profile?.role==="admin";}
function cashier(){return ctx?.profile?.role==="admin"||ctx?.profile?.role==="cashier";}
async function query(q){const r=await q;if(r.error)throw r.error;return r.data||[];}
function setError(e){if(!target)return;const el=target.querySelector(".sas-feedback");if(el){el.textContent=e?.message||String(e);el.classList.add("error");}else alert(e?.message||String(e));}
function feedback(t){const el=target?.querySelector(".sas-feedback");if(el){el.textContent=t;el.classList.remove("error");}}
function headerActions(t){return '<div class="sas-page-actions">'+t+'</div>';}
function sectionOptions(kind){return '<option value="'+escapeAttr(kind)+'">'+escapeHtml(kind)+'</option>';}
function isUuid(x){return /^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(x);}
function futureISO(value){const t=new Date(value);if(!Number.isFinite(t.getTime())||t.getTime()<=Date.now())throw Error("Bitte einen zukünftigen Zeitpunkt wählen.");return t.toISOString();}
function iso(value){const t=new Date(value);if(!Number.isFinite(t.getTime()))throw Error("Datum nicht gültig.");return t.toISOString();}
function topLink(){return headerActions(linkPage("Abstimmungen","votes")+linkPage("Konto und Zahlungen","wallet"));}
function cardTheme(d){const m=/^custom:(#[0-9a-fA-F]{6})$/.exec(d||"");if(!m)return {cls:"sas-id-"+escapeAttr(d||"classic"),style:""};const rgb=[1,3,5].map(i=>parseInt(m[1].slice(i,i+2),16));const bright=(rgb[0]*299+rgb[1]*587+rgb[2]*114)/1000;return {cls:"sas-id-custom",style:' style="--sas-card-bg:'+m[1]+';--sas-card-ink:'+(bright>145?"#14231c":"#ffffff")+';"'};}
function renderId(){
const c=data[0],design=c?.design||"classic",theme=cardTheme(design),name=c?.display_name||ctx.profile.display_name,verified=Boolean(ctx.profile.school_verified_at);
return wrap(current,
 box("Mein digitaler Schülerausweis",'<div class="sas-id '+theme.cls+'"'+theme.style+'><div class="sas-id-top"><strong>Schule als Staat</strong><span>PERSONALAUSWEIS</span></div><div><small>Mitglied · Selbstauskunft</small><h2>'+escapeHtml(name)+'</h2><p>Klasse '+escapeHtml(c?.class_label||"nicht angegeben")+'</p></div><span class="sas-id-bottom">ID · '+escapeHtml(ctx.user.id.slice(0,8).toUpperCase())+' · NICHT ALS IDENTITÄTSNACHWEIS GÜLTIG</span><div class="sas-id-inline-qr" id="sas-permanent-card-qr" aria-label="Persönlicher Schülerausweis-QR-Code"><span class="sas-note">QR-Code wird geladen …</span></div></div>'
 +msg(verified?"Deine Schulzugehörigkeit wurde vor Ort bestätigt. Ein offiziell gültiger Ausweis setzt weiterhin die Freigabe der Schule voraus.":"Noch nicht persönlich geprüft. Für einen offiziell gültigen Schülerausweis sind Identitätsprüfung und Schulfreigabe erforderlich.")
 +'<div class="sas-role-chips"><strong>Deine Berufe:</strong> '+((ctx.schoolRoles?.jobs||[]).length?
   (ctx.schoolRoles.jobs||[]).map(j=>badge(j.label)).join(""):'<span class="sas-note">Noch keine Berufe zugewiesen</span>')+'</div>'
 +form("card",input("Name auf der Karte","display_name","text",'minlength="2" maxlength="80" value="'+escapeAttr(name)+'" '+(verified?"readonly":""))
  +input("Klasse","class_label","text",'maxlength="24" value="'+escapeAttr(c?.class_label||"")+'" '+(verified?"readonly":""))
  +'<label class="sas-field"><span>Ausweisdesign</span><select name="design">'+["classic","blue","forest","mono","custom"].map(v=>'<option value="'+v+'"'+((v==='custom'?design.startsWith('custom:'):v===design)?' selected':'')+'>'+({"classic":"Klassisch","blue":"Blau","forest":"Grün","mono":"Monochrom","custom":"Eigene Farbe"}[v])+'</option>').join("")+'</select></label><label class="sas-field"><span>Eigene Farbe</span><span class="sas-color-control"><input type="color" name="color" value="'+escapeAttr(/^custom:#[0-9a-fA-F]{6}$/.test(design)?design.slice(7):"#4c8c69")+'"><span>Gold- und Silber-Sonderdesigns sind für normale Bürger gesperrt.</span></span></label>',"Ausweis speichern")),
 headerActions(linkPage("Design-Galerie","gallery"))+
 box("Dein persönlicher Ausweis-QR-Code",'<p class="sas-note">Der feste QR-Code ist direkt auf deinem Ausweis oben. Er bleibt gleich und löst allein keine Zahlung aus.</p>')+box("Zusätzliche Sicherheitsprüfungen",'<p class="sas-note">Verifizierung: Zeige deinen Ausweis vor Ort einer berechtigten Person. Anwesenheit: Nur bereits verifizierte Mitglieder können für einen Termin eingecheckt werden.</p><div class="verify-qr-actions">'+(verified?badge("Schulzugehörigkeit geprüft"):btn("Schulidentität prüfen lassen","id-school-qr"))+btn("Anwesenheit zeigen","id-attendance-qr")+btn("Ausweis für Guthaben zeigen","id-credit-qr")+'</div><div id="student-id-qr-code" class="verify-qr-wrap" aria-live="polite"><span class="sas-note">Wähle eine der beiden QR-Funktionen.</span></div>'+msg("Die QR-Codes sind nur kurz gültig. Eine Lehrkraft oder eine berechtigte Aufsicht muss deinen Ausweis persönlich prüfen.")));
}
function renderGallery(){
 const currentDesign=data[0]?.design||"classic";
 return wrap(current,box("Designs für deinen Schülerausweis",'<p class="sas-note">Die Vorlagen werden aus deinem tatsächlichen Konto erstellt, ohne erfundene Personendaten.</p><div class="sas-design-grid">'
 +["classic","blue","forest","mono","custom:#4c8c69"].map(v=>'<article class="sas-design-tile"><div class="sas-id '+cardTheme(v).cls+'"'+cardTheme(v).style+'><div class="sas-id-top"><strong>Schule als Staat</strong><span>SaS ONE</span></div><div><small>MITGLIED</small><h2>'+escapeHtml(data[0]?.display_name||ctx.profile.display_name)+'</h2></div><span class="sas-id-bottom">VORSCHAU · KEIN IDENTITÄTSNACHWEIS</span></div><h3>'+escapeHtml({"classic":"Klassisch","blue":"Blau","forest":"Waldgrün","mono":"Monochrom","custom:#4c8c69":"Eigene Farbe"}[v])+'</h3>'+btn(currentDesign===v?"Aktuell ausgewählt":"Design verwenden","choose-design",v,currentDesign===v?"muted":"primary")+'</article>').join("")+'</div>'));
}
function renderVisa(){
const personal=admin()?data:data.filter(x=>x.applicant_id===ctx.user.id);
return wrap(current,msg("ViSA-Anträge enthalten personenbezogene Daten (einschließlich Anschrift). Bitte nur mit Einwilligung und schulischer Datenschutzfreigabe nutzen."),
'<div class="sas-columns">'+box("ViSA beantragen",form("visa",
 input("Vorname","first_name","text",'maxlength="80"')+input("Nachname","last_name","text",'maxlength="80"')
 +input("Herkunftsland","origin_country","text",'maxlength="80"')
 +input("Unterkunft","accommodation","text",'maxlength="100"')
 +input("Straße und Hausnummer","address_line","text",'maxlength="160"')
 +input("PLZ und Ort","postal_city","text",'maxlength="120"')
 +input("Sprache","preferred_language","text",'maxlength="60"')
 +input("Schule und Klasse","school_class","text",'maxlength="60"')
 +input("Geplantes Einreisedatum","planned_entry","date")
 +input("Kontakt-E-Mail","contact_email","email",'maxlength="200" value="'+escapeAttr(ctx.user.email)+'"')
 +'<label class="sas-checkbox"><input type="checkbox" name="acknowledged_privacy" required><span>Ich habe die Hinweise zur Verarbeitung meiner Angaben gelesen und beantrage die Bearbeitung durch die Schuladministration.</span></label>',
 "Antrag verbindlich einreichen"))
 +box(admin()?"Eingegangene Anträge":"Meine Anträge",personal.length?'<div class="sas-list">'+personal.map(v=>card(v.first_name+' '+v.last_name,fmtDate(v.submitted_at)+' · '+v.origin_country+' · '+v.school_class, badge(v.status)+(admin()?'<p class="sas-note">Unterkunft: '+escapeHtml(v.accommodation)+' · '+escapeHtml(v.address_line)+', '+escapeHtml(v.postal_city)+'</p>'+btn("Genehmigen","visa-approve",v.id)+btn("Ablehnen","visa-reject",v.id):'')+(v.reviewer_note?msg(v.reviewer_note):'')+(v.applicant_id===ctx.user.id&&v.status!=='approved'?btn('Antrag zurückziehen','visa-delete',v.id):''))).join("")+'</div>':empt("Noch keine ViSA-Anträge."))+'</div>');
}
function renderPosts(){
const section=current==="blog"?"blog":"news";
return wrap(current,admin()?headerActions(badge("Redaktion · Administrator")):"",
'<div class="sas-columns">'+box("Aktuelle Veröffentlichungen",data.length?'<div class="sas-list">'+data.map(p=>card(p.title,date(p.created_at),'<div class="sas-text">'+escapeHtml(p.body)+'</div>'+(admin()?btn("Beitrag löschen","post-delete",p.id):''))).join("")+'</div>':empt("Noch keine Beiträge veröffentlicht."))+(admin()?box("Neuen Beitrag veröffentlichen",form("post",input("Überschrift","title","text",'minlength="4" maxlength="140"')+textArea("Beitrag","body",4000),"Veröffentlichen")):"")+'</div>');
}
function placesForm(kind,heading){
return admin()?box(heading,form("place",
'<input type="hidden" name="kind" value="'+escapeAttr(kind)+'">'+input("Name","name","text",'maxlength="100"')
+'<label class="sas-field"><span>Etage / Bereich</span><input name="floor_label" maxlength="40" placeholder="z. B. 1. Stock"></label>'
+'<label class="sas-field"><span>Beschreibung</span><textarea name="detail" maxlength="500"></textarea></label>'
+'<div class="sas-two">'+
'<label class="sas-field"><span>X-Position im Plan (%)</span><input name="x_percent" type="number" min="0" max="100" step=".1" placeholder="optional"></label>'+
'<label class="sas-field"><span>Y-Position im Plan (%)</span><input name="y_percent" type="number" min="0" max="100" step=".1" placeholder="optional"></label></div>'
+(kind==="shop"?'<label class="sas-field"><span>Kassenbetreiber (Benutzer-ID, optional)</span><input name="owner_id" placeholder="UUID eines Kassenkontos"></label>':''),
"Ort hinzufügen")):"";
}
function renderPlaces(){
let kind=current==="shops"?"shop":null;
let entries=kind?data.filter(p=>p.kind===kind):data;
let withCoordinates=entries.filter(p=>p.x_percent!==null&&p.y_percent!==null);
return wrap(current,
 current==="map"?box("Interaktiver Schulplan",
 withCoordinates.length?'<div class="sas-plan"><div class="sas-plan-caption">Positionen wurden von der Administration hinterlegt · Lageplan nicht maßstabsgetreu</div>'+withCoordinates.map(p=>'<button data-feature-action="place-show" data-id="'+escapeAttr(p.id)+'" class="sas-pin" style="left:'+Number(p.x_percent)+'%;top:'+Number(p.y_percent)+'%" title="'+escapeAttr(p.name)+'">'+escapeHtml(p.name.slice(0,18))+'</button>').join("")+'</div>':empt("Noch keine Orte mit echten Positionen eingetragen. Die Schuladministration kann sie unten ergänzen.")) : "",
'<div class="sas-columns">'+box(kind?"Geschäfte und Kassen":"Orte im Schulgebäude",
entries.length?'<div class="sas-list">'+entries.map(p=>card(p.name,p.floor_label+(p.detail?' · '+p.detail:''),badge(p.kind)+(p.owner_id?msg("Kassenbetreiber hinterlegt."):"")+(kind==="shop"?(p.owner_id===ctx.user.id||admin()||ctx.schoolRoles?.operator?linkPage("Inventur und Kasse","shopmanage"):linkPage("QR-Zahlung durchführen","pay")):"")+(admin()?btn("Ort entfernen","place-delete",p.id):''))).join("")+'</div>':empt("Noch keine von der Schule eingetragenen Orte."))+
placesForm(kind||"room",kind?"Geschäft hinzufügen":"Raum oder Ort hinzufügen")+'</div>');
}
function renderRooms(){
const places=related.filter(p=>p.kind==="room"&&p.active);
const visible=data;
return wrap(current,'<div class="sas-columns">'+box("Raum reservieren",
places.length?form("booking",
'<label class="sas-field"><span>Raum</span><select name="place_id">'+places.map(p=>'<option value="'+escapeAttr(p.id)+'">'+escapeHtml(p.name+' · '+p.floor_label)+'</option>').join("")+'</select></label>'
+input("Beginn","starts_at","datetime-local")+input("Ende","ends_at","datetime-local")+input("Zweck","purpose","text",'minlength="3" maxlength="180"'),
"Reservierung beantragen"):empt("Noch keine Räume angelegt. Die Administration kann sie unten einrichten."))+
box(admin()?"Alle Reservierungen":"Meine Reservierungen und genehmigte Belegungen",
visible.length?'<div class="sas-list">'+visible.map(b=>card(related.find(p=>p.id===b.place_id)?.name||"Raum",date(b.starts_at)+" – "+date(b.ends_at)+" · "+b.purpose,badge(b.status)+(admin()&&b.status==="pending"?btn("Genehmigen","booking-approve",b.id)+btn("Ablehnen","booking-reject",b.id):"")+(b.booked_by===ctx.user.id&&b.status==="pending"?btn("Antrag zurückziehen","booking-cancel",b.id):""))).join("")+'</div>':empt("Noch keine Reservierungen."))+
(admin()?placesForm("room","Neuen Raum anlegen"):"")+'</div>');
}
function renderEvents(){
return wrap(current,
'<div class="sas-columns">'+box("Veranstaltungen und Termine",
data.length?'<div class="sas-list">'+data.map(e=>card(e.title,date(e.starts_at)+" – "+date(e.ends_at),'<div class="sas-text">'+escapeHtml(e.description||"")+'</div>'+(related.some(r=>r.event_id===e.id&&r.user_id===ctx.user.id)?btn("Teilnahme zurücknehmen","event-leave",e.id):(new Date(e.starts_at)>new Date()?btn("Teilnehmen","event-join",e.id):badge("Bereits begonnen")))+(admin()?btn("Termin löschen","event-delete",e.id):""))).join("")+'</div>':empt("Noch keine Veranstaltungen eingetragen."))+
(admin()?box("Veranstaltung erstellen",form("event",input("Titel","title","text",'maxlength="150"')+textArea("Beschreibung","description",3000)+input("Beginn","starts_at","datetime-local")+input("Ende","ends_at","datetime-local"),"Termin veröffentlichen")):"")+'</div>');
}
function renderLost(){
return wrap(current,
'<div class="sas-columns">'+box("Fund- und Verlustmeldungen",
data.length?'<div class="sas-list">'+data.map(p=>card(p.title,date(p.created_at)+' · '+(p.kind==='lost'?'Verloren':'Gefunden'),'<div class="sas-text">'+escapeHtml(p.detail)+'</div>'+msg(p.location_hint||"Kein Ort angegeben.")+badge(p.status)+((p.created_by===ctx.user.id||admin())&&p.status==='open'?btn("Meldung löschen","lost-delete",p.id):"")+(admin()&&p.status==='open'?btn("Als erledigt markieren","lost-resolve",p.id):""))).join("")+'</div>':empt("Keine Fund- oder Verlustmeldungen."))+
box("Fund oder Verlust melden",form("lost",
'<label class="sas-field"><span>Art</span><select name="kind"><option value="lost">Verloren</option><option value="found">Gefunden</option></select></label>'
+input("Gegenstand","title","text",'minlength="4" maxlength="120"')+textArea("Beschreibung","detail",1200)
+'<label class="sas-field"><span>Fund- oder Verlustort (optional)</span><input name="location_hint" maxlength="120"></label>',"Meldung veröffentlichen"))+'</div>');
}
function renderCivic(){
let kind=civicMap[current]||"job";
return wrap(current,'<div class="sas-columns">'+box("Veröffentlichungen",
data.length?'<div class="sas-list">'+data.map(p=>card(p.title,date(p.created_at),'<div class="sas-text">'+escapeHtml(p.body)+'</div>'+(kind==="job"? related.some(a=>a.job_id===p.id&&a.applicant_id===ctx.user.id)?badge("Bewerbung eingereicht"):btn("Bewerben","job-open",p.id):"")+(admin()?btn("Entfernen","civic-delete",p.id):""))).join("")+'</div>':empt("Noch keine offiziellen Einträge."))+
(admin()?box("Neuen Eintrag veröffentlichen",form("civic",input("Titel","title","text",'maxlength="140"')+textArea("Text","body",4000),"Veröffentlichen")):"")+'</div>'
+(kind==="job"&&admin()?box("Eingegangene Bewerbungen",related.length?related.map(a=>card(a.applicant_id,date(a.submitted_at),'<div class="sas-text">'+escapeHtml(a.motivation)+'</div>')).join(""):empt("Noch keine Bewerbungen.")):"")
+(kind==="job"?'<div id="sas-job-form-slot"></div>':""));
}
function renderScreen(){
if(!target)return;
let markup="";
switch(current){
case "idcard":markup=renderId();break;
case "gallery":markup=renderGallery();break;
case "visa":markup=renderVisa();break;
case "bulletin":case "blog":markup=renderPosts();break;
case "map":case "shops":markup=renderPlaces();break;
case "rooms":markup=renderRooms();break;
case "events":markup=renderEvents();break;
case "lost":markup=renderLost();break;
default:markup=renderCivic();
}
target.innerHTML=markup+'<div class="sas-feedback" role="status" aria-live="polite"></div>';
}
async function readPage(page,context){
const api=context.api,u=context.user.id,isAdmin=context.profile.role==="admin";
let data=[],related=[];
switch(page){
case "idcard":case "gallery":{let a=await query(api.from('student_cards').select('*').eq('user_id',u).limit(1));data=a;break;}
case "visa":data=await query(isAdmin?api.from('visa_applications').select('*').order('submitted_at',{ascending:false}).limit(70):api.from('visa_applications').select('*').eq('applicant_id',u).order('submitted_at',{ascending:false}).limit(70));break;
case "bulletin":case "blog":data=await query(api.from('portal_posts').select('*').eq('section',page==="blog"?"blog":"news").eq('published',true).order('created_at',{ascending:false}).limit(100));break;
case "shops":case "map":data=await query(api.from('school_places').select('*').order('name').limit(300));break;
case "rooms":[related,data]=await Promise.all([query(api.from('school_places').select('*').eq('kind','room').order('name').limit(200)),query(api.from('room_bookings').select('*').order('starts_at',{ascending:true}).limit(200))]);break;
case "events":[data,related]=await Promise.all([query(api.from('school_events').select('*').order('starts_at',{ascending:true}).limit(150)),query(api.from('event_rsvps').select('*').eq('user_id',u).limit(500))]);break;
case "lost":data=await query(api.from('lost_items').select('*').order('created_at',{ascending:false}).limit(150));break;
default:{data=await query(api.from('civic_posts').select('*').eq('kind',civicMap[page]).order('created_at',{ascending:false}).limit(130));if(page==="jobs")related=await query(api.from('job_applications').select('*').limit(200));}
 }
return [data,related];
}
async function refresh(){
 const at=++stamp,screen=target,page=current,context=ctx;
 screen.innerHTML='<div class="sas-loading" role="status">Daten werden geladen …</div>';
 try{
  const result=await readPage(page,context);
  if(at===stamp&&screen.isConnected&&screen===target){[data,related]=result;renderScreen();if(page==="idcard"){const qr=screen.querySelector("#sas-permanent-card-qr");if(qr){const response=await context.api.rpc("my_student_card_code");if(!response.error&&qr.isConnected&&window.QRCode){qr.replaceChildren();new window.QRCode(qr,{text:response.data,width:220,height:220});}else if(qr.isConnected){qr.textContent=response.error?.message||"QR-Code konnte nicht angezeigt werden.";}}}}
 }catch(e){if(at===stamp&&screen.isConnected&&screen===target){screen.innerHTML=wrap(page,'<section class="sas-panel"><h2>Daten konnten nicht geladen werden</h2>'+msg(e.message||e)+btn("Erneut laden","reload")+'</section>')+'<div class="sas-feedback" role="status"></div>';}}
}
async function submit(kind,f){
const api=ctx.api,u=ctx.user.id;
const values=Object.fromEntries(new FormData(f).entries());
const v=(k)=>trim(values[k]);
switch(kind){
case "card":{
const a={user_id:u,display_name:v('display_name'),class_label:v('class_label'),design:(v('design')==='custom'?'custom:'+v('color'):v('design')),updated_at:new Date().toISOString()};
await query(api.from('student_cards').upsert(a,{onConflict:'user_id'}));break;}
case "visa":{
if(!values.acknowledged_privacy)throw Error("Bitte die Datenschutzhinweise bestätigen.");
const a={applicant_id:u,first_name:v('first_name'),last_name:v('last_name'),origin_country:v('origin_country'),accommodation:v('accommodation'),address_line:v('address_line'),postal_city:v('postal_city'),preferred_language:v('preferred_language'),school_class:v('school_class'),planned_entry:v('planned_entry'),contact_email:v('contact_email'),acknowledged_privacy:true};
await query(api.from('visa_applications').insert(a));break;}
case "post":{
if(!admin())throw Error("Nur Administratoren dürfen Beiträge veröffentlichen.");
await query(api.from('portal_posts').insert({section:current==="blog"?"blog":"news",title:v('title'),body:v('body'),author_id:u}));break;}
case "place":{
if(!admin())throw Error("Nur Administratoren dürfen Orte anlegen.");
const owner=v('owner_id')||null;if(owner&&!isUuid(owner))throw Error("Die Kassenbetreiber-ID ist ungültig.");
const x=v('x_percent'),y=v('y_percent');
const a={name:v('name'),kind:v('kind'),floor_label:v('floor_label'),detail:v('detail'),x_percent:x===''?null:Number(x),y_percent:y===''?null:Number(y),owner_id:owner};
await query(api.from('school_places').insert(a));break;}
case "booking":{
const start=futureISO(v('starts_at')),end=iso(v('ends_at'));
if(new Date(end)<=new Date(start))throw Error("Das Ende muss nach dem Beginn liegen.");
if(new Date(end)-new Date(start)>8*3600000)throw Error("Eine Reservierung darf höchstens acht Stunden dauern.");
await query(api.from('room_bookings').insert({place_id:v('place_id'),booked_by:u,starts_at:start,ends_at:end,purpose:v('purpose')}));break;}
case "event":{
if(new Date(v("ends_at"))<=new Date(v("starts_at")))throw Error("Das Ende muss nach dem Beginn liegen.");
if(!admin())throw Error("Nur Administratoren dürfen Termine erstellen.");
const a={title:v('title'),description:v('description'),starts_at:futureISO(v('starts_at')),ends_at:iso(v('ends_at')),created_by:u};
await query(api.from('school_events').insert(a));break;}
case "lost":await query(api.from('lost_items').insert({created_by:u,kind:v('kind'),title:v('title'),detail:v('detail'),location_hint:v('location_hint')}));break;
case "civic":{
if(!admin())throw Error("Nur Administratoren dürfen diese Mitteilungen veröffentlichen.");
await query(api.from('civic_posts').insert({kind:civicMap[current],title:v('title'),body:v('body'),created_by:u}));break;}
case "job":{
if(!isUuid(v('job_id')))throw Error("Stellen-ID ungültig.");
await query(api.from('job_applications').insert({job_id:v('job_id'),applicant_id:u,motivation:v('motivation')}));break;}
}}
async function handle(action,id){
const api=ctx.api,u=ctx.user.id;
if(action==="navigate"){if(!pages[id]&&!["wallet","pay","register","votes"].includes(id))throw Error("Seite unbekannt.");await ctx.navigate(id);return;}
if(action==="reload"){await refresh();return;}
if(action==="id-school-qr"||action==="id-attendance-qr"||action==="id-credit-qr"){
 const rpcName=action==="id-school-qr"?"create_school_verification_qr":action==="id-credit-qr"?"my_student_card_code":"create_attendance_pass";
 const response=await api.rpc(rpcName);
 if(response.error)throw response.error;
 const area=target.querySelector("#student-id-qr-code");
 if(!area)throw Error("QR-Code-Bereich nicht gefunden.");
 if(!window.QRCode)throw Error("QR-Code-Bibliothek konnte nicht geladen werden.");
 area.replaceChildren();
 new window.QRCode(area,{text:response.data,width:224,height:224,colorDark:"#20364f",colorLight:"#ffffff"});
 const caption=document.createElement("p");caption.className="sas-note";
 caption.textContent=action==="id-school-qr"?"Schulverifizierung: 10 Minuten gültig.":action==="id-credit-qr"?"Persönlicher Ausweiscode. Er identifiziert dein Konto, löst selbst keine Zahlung aus.":"Anwesenheitskontrolle: 2 Minuten gültig.";
 area.append(caption);
 feedback("Der QR-Code wurde erstellt. Zeige ihn einer berechtigten Person in der Schule.");
 return;
}
if(action==="place-show"){const p=data.find(p=>p.id===id);if(p)feedback(p.name+" · "+p.floor_label+" · "+p.detail);return;}
if(action==="job-open"){
 const slot=target.querySelector('#sas-job-form-slot');if(!slot)return;
 slot.innerHTML=box("Bewerbung auf die ausgeschriebene Stelle",form("job",'<input type="hidden" name="job_id" value="'+escapeAttr(id)+'">'+textArea("Warum möchtest du diese Aufgabe übernehmen?","motivation",1000),"Bewerbung einreichen"));
 slot.scrollIntoView({behavior:"smooth",block:"start"});return;
}
if(action==="choose-design"){
 const existing=data[0];const a={user_id:u,display_name:existing?.display_name||ctx.profile.display_name,class_label:existing?.class_label||"",design:id,updated_at:new Date().toISOString()};
 await query(api.from('student_cards').upsert(a,{onConflict:'user_id'}));return;}
if(["visa-approve","visa-reject","booking-approve","booking-reject","lost-resolve","civic-delete","post-delete","place-delete","event-delete"].includes(action)&&!admin())throw Error("Administratorberechtigung erforderlich.");
if(["place-delete","event-delete","civic-delete","lost-delete","post-delete","visa-delete"].includes(action)&&!confirm("Eintrag wirklich löschen?"))return;
switch(action){
case "visa-delete":await query(api.from("visa_applications").delete().eq("id",id));break;
case "visa-approve":case "visa-reject":await query(api.from('visa_applications').update({status:action==="visa-approve"?"approved":"rejected",reviewed_at:new Date().toISOString()}).eq('id',id));break;
case "booking-approve":case "booking-reject":await query(api.from('room_bookings').update({status:action==="booking-approve"?"approved":"rejected"}).eq('id',id));break;
case "booking-cancel":await query(api.from('room_bookings').delete().eq('id',id));break;
case "event-join":await query(api.from('event_rsvps').insert({event_id:id,user_id:u}));break;
case "event-leave":await query(api.from('event_rsvps').delete().eq('event_id',id).eq('user_id',u));break;
case "event-delete":await query(api.from('school_events').delete().eq('id',id));break;
case "lost-delete":await query(api.from('lost_items').delete().eq('id',id));break;
case "lost-resolve":await query(api.from('lost_items').update({status:'resolved'}).eq('id',id));break;
case "place-delete":await query(api.from('school_places').delete().eq('id',id));break;
case "civic-delete":await query(api.from('civic_posts').delete().eq('id',id));break;
case "post-delete":await query(api.from('portal_posts').delete().eq('id',id));break;
default:throw Error("Aktion nicht bekannt.");
}}
async function show(context){
ctx=context;current=context.page;target=context.target;const here=target;
if(!here)throw Error("Feature target missing.");
here.addEventListener("submit",async event=>{
 const f=event.target.closest("form[data-feature-form]");
 if(!f)return;
 event.preventDefault();event.stopPropagation();
 if(busy)return;busy=true;
 const b=f.querySelector('button[type=submit]');if(b)b.disabled=true;
 try{await submit(f.dataset.featureForm,f);await refresh();feedback("Änderung erfolgreich gespeichert.");}
 catch(e){setError(e);}finally{busy=false;if(b)b.disabled=false;}
});
here.addEventListener("click",async event=>{
 const b=event.target.closest('[data-feature-action]');if(!b)return;
 event.preventDefault();event.stopPropagation();
 if(busy)return;
 if(b.dataset.featureAction==="navigate"){try{await handle("navigate",b.dataset.id||"");}catch(e){setError(e);}return;}
 busy=true;b.disabled=true;
 try{await handle(b.dataset.featureAction,b.dataset.id||"");if(!["navigate","place-show","job-open","reload","id-school-qr","id-attendance-qr"].includes(b.dataset.featureAction)){await refresh();feedback("Änderung gespeichert.");}}
 catch(e){setError(e);}finally{busy=false;b.disabled=false;}
});
await refresh();
}
window.SAS_FEATURES={pages,navigation,show,isBusy:()=>busy};
})();