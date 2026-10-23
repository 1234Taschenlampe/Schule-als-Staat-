/* Classroom shop map: official PDF + real Supabase four-slot bookings. */
(function(){
"use strict";
var PDF="https://www.rng-wangen.de/wp-content/uploads/2024/07/230625_digitaler-uebersichtsplan.pdf";
var root,api,userId,admin,rooms=[],selected="",chosen=0,query="",busy=false,currentPage=4,currentBuilding="",pdfDocumentPromise=null,paintRun=0;
function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c];});}
function slot(room,n){return (room.slots||[]).find(function(x){return x.number===n;});}
function msg(s,error){var t=root&&root.querySelector("#shop-map-msg");if(t){t.textContent=s;t.className="sas-shopmap-msg"+(error?" err":"");}}
function roomButton(room){var free=4-(room.slots||[]).length,active=selected===room.id;
 return '<button class="sas-shopmap-room'+(active?' active':'')+'" type="button" data-room="'+esc(room.id)+'"><span><strong>'+esc(room.name)+'</strong><b>'+free+'/4 frei</b></span><small>'+esc(room.floor||"Etage offen")+'</small><i>'+[1,2,3,4].map(function(n){return '<em class="'+(slot(room,n)?"taken":"free")+'"></em>';}).join("")+'</i></button>';}
function cell(room,n){var s=slot(room,n);
 if(!s)return '<button type="button" class="sas-shopmap-stall free" data-slot="'+n+'"><small>Platz '+n+'</small><strong>Frei</strong><span>Shop anfragen</span></button>';
 var controls=(s.mine&&s.status==="pending"&&s.id?'<button type="button" data-cancel="'+esc(s.id)+'">Zurückziehen</button>':'')+
  (admin&&s.status==="pending"&&s.id?'<button type="button" data-approve="'+esc(s.id)+'">Genehmigen</button><button type="button" data-reject="'+esc(s.id)+'">Ablehnen</button>':'')+
  (admin&&s.status==="approved"&&s.id?'<button type="button" data-cancel="'+esc(s.id)+'">Freigeben</button>':'');
 return '<div class="sas-shopmap-stall taken"><small>Platz '+n+'</small><strong>'+esc(s.shop||"Reserviert")+'</strong><span>'+(s.status==="pending"?"Anfrage in Prüfung":"Shop genehmigt")+'</span><div class="sas-shopmap-actions">'+controls+'</div></div>';}
function roomDetails(){
 var room=rooms.find(function(x){return x.id===selected;});if(!room)return '<p class="sas-shopmap-empty">Wähle ein Klassenzimmer aus der Liste aus.</p>';
 var form=chosen&&!slot(room,chosen)?'<form id="sas-shopmap-apply" class="sas-shopmap-form"><h3>Platz '+chosen+' in '+esc(room.name)+' reservieren</h3><label>Shop-Name <input name="name" required minlength="3" maxlength="100" placeholder="z. B. Waffelstand"></label><label>Beschreibung <textarea name="description" maxlength="450" rows="3"></textarea></label><div><button type="submit">Anfrage senden</button><button type="button" data-close>Abbrechen</button></div><p>Der Platz bleibt bis zur Entscheidung der Administration reserviert. Ein Shop wird erst nach Genehmigung angelegt.</p></form>':"";
 return '<div class="sas-shopmap-selected-title"><div><h3>Raum '+esc(room.name)+'</h3><p>'+esc(room.floor||"")+(room.detail?" · "+esc(room.detail):"")+'</p></div><b>'+(4-(room.slots||[]).length)+' frei</b></div><div class="sas-shopmap-slots">'+[1,2,3,4].map(function(n){return cell(room,n);}).join("")+'</div>'+form;
}
function adminForm(){return !admin?"":'<details class="sas-shopmap-admin"><summary>Klassenzimmer anhand des offiziellen Plans freigeben</summary><p>Bitte nur Räume eintragen, deren Nummer und Nutzung von der Schule bestätigt wurden.</p><form id="sas-shopmap-roomform" class="sas-shopmap-form"><div class="sas-shopmap-fields"><label>Raumnummer<input name="room" maxlength="20" required placeholder="z. B. A003"></label><label>Gebäude / Stockwerk<input name="floor" maxlength="40" required placeholder="Gebäude A · EG"></label><label>PDF-Seite (optional)<input type="number" min="1" max="40" name="page" placeholder="1"></label></div><label>Beschreibung (optional)<input name="detail" maxlength="500"></label><button type="submit">Raum mit vier Shop-Plätzen freigeben</button></form></details>';}

var PDF_LOCAL="/rng-floorplan.pdf";
var PDFJS_URL="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
var PDFJS_WORKER="https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
var FLOOR_TABS=[
 [1,"Gelände"],[2,"Raumverzeichnis"],[3,"Untergeschoss"],[4,"Erdgeschoss"],
 [5,"1. Obergeschoss"],[6,"2. Obergeschoss"],[7,"3. OG · Kunst"]
];
function pageRooms(page){return rooms.filter(function(room){return Number(room.plan_page)===page;});}
function shownRooms(){
 return rooms.filter(function(r){
  var matched=(r.name+" "+r.floor+" "+r.detail).toLowerCase().includes(query);
  return matched&&(!currentBuilding||r.name.startsWith(currentBuilding))&&(query.length>0||Number(r.plan_page)===currentPage);
 });
}
function mapPins(){
 if(currentPage===1){
  var buildings=[["A",48.96,61.76],["B",43.86,44.91],["C",62.44,34],["D",47.98,11.31],["E",59.1,86.41]];
  return buildings.map(function(b){
   return '<button type="button" data-building="'+b[0]+'" class="sas-shopmap-pin sas-shopmap-building'+(currentBuilding===b[0]?' active':'')+'" style="left:'+b[1]+'%;top:'+b[2]+'%" title="Gebäude '+b[0]+' auswählen" aria-label="Gebäude '+b[0]+' auswählen">'+b[0]+'</button>';
  }).join("");
 }
 return pageRooms(currentPage).filter(function(r){
  return (!currentBuilding||r.name.startsWith(currentBuilding))&&r.x_percent!==null&&r.y_percent!==null&&Number.isFinite(Number(r.x_percent))&&Number.isFinite(Number(r.y_percent));
 }).map(function(r){
  var x=Math.max(1,Math.min(99,Number(r.x_percent)));
  var y=Math.max(1,Math.min(99,Number(r.y_percent)));
  var active=selected===r.id;
  var label=r.name+" · "+(4-(r.slots||[]).length)+" von 4 Shop-Plätzen frei";
  return '<button type="button" data-room="'+esc(r.id)+'" class="sas-shopmap-pin'+(active?' active':'')+'" style="left:'+x+'%;top:'+y+'%" title="'+esc(label)+'" aria-label="'+esc(label)+'">'+esc(r.name)+'</button>';
 }).join("");
}
function floorNavigation(){
 var buildings='<div class="sas-shopmap-buildings" aria-label="Gebäudeteil wählen">'+
  '<span>Gebäude</span>'+["A","B","C","D","E"].map(function(letter){
   var count=rooms.filter(function(r){return r.name.startsWith(letter);}).length;
   return '<button type="button" data-building="'+letter+'" class="'+(currentBuilding===letter?'active':'')+'" aria-pressed="'+(currentBuilding===letter)+'">Haus '+letter+' <small>'+count+' Räume</small></button>';
  }).join("")+(currentBuilding?'<button type="button" data-building-reset>Alle Gebäude</button>':'')+'</div>';
 var floors='<nav class="sas-shopmap-floors" aria-label="Gebäudeplan: Etage auswählen">'+FLOOR_TABS.map(function(p){
  var count=pageRooms(p[0]).filter(function(r){return !currentBuilding||r.name.startsWith(currentBuilding);}).length;
  return '<button type="button" data-page="'+p[0]+'" class="'+(p[0]===currentPage?'active':'')+'"'+(p[0]===currentPage?' aria-current="page"':'')+'>'+esc(p[1])+(count?' <small>'+count+' Räume</small>':'')+'</button>';
 }).join("")+'</nav>';
 return buildings+floors;
}
async function paintPdf(){
 var targetCanvas=root&&root.querySelector("#rng-floorplan-canvas");
 if(!targetCanvas)return;
 var pageNum=currentPage,run=++paintRun,el=root.querySelector("#rng-plan-status");
 try{
  if(!pdfDocumentPromise){
   pdfDocumentPromise=import(PDFJS_URL).then(function(pdfjs){
    pdfjs.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;
    return pdfjs.getDocument({url:PDF_LOCAL,isEvalSupported:false}).promise;
   });
  }
  var pdf=await pdfDocumentPromise;
  if(run!==paintRun||!targetCanvas.isConnected)return;
  var page=await pdf.getPage(pageNum);
  if(run!==paintRun||!targetCanvas.isConnected)return;
  var viewport=page.getViewport({scale:1.8});
  targetCanvas.width=Math.round(viewport.width);
  targetCanvas.height=Math.round(viewport.height);
  var canvasCtx=targetCanvas.getContext("2d",{alpha:false});
  await page.render({canvasContext:canvasCtx,viewport:viewport}).promise;
  if(run!==paintRun)return;
  if(el&&el.isConnected)el.textContent="Originalplan · Seite "+pageNum+" von "+pdf.numPages+" · Raumnummer antippen";
 }catch(e){
  if(run!==paintRun)return;
  pdfDocumentPromise=null;
  if(el&&el.isConnected)el.innerHTML='PDF-Vorschau konnte nicht geladen werden. <a href="'+PDF+'" target="_blank" rel="noopener noreferrer">Offiziellen Plan öffnen ↗</a>';
  var holder=root.querySelector("#rng-plan-holder");
  if(holder&&holder.isConnected)holder.innerHTML='<iframe title="Offizieller RNG-Schulplan" src="'+PDF_LOCAL+'#page='+pageNum+'" loading="lazy"></iframe>';
 }
}
function draw(){
 var shown=shownRooms();
 var current=rooms.find(function(x){return x.id===selected;});
 var total=rooms.length;
 var pageInfo=currentPage===3?"Chemie- und Werkräume: keine regulären Klassenräume für Shops.":
 currentPage===7?"Kunsträume im 3. Obergeschoss: keine regulären Klassenräume für Shops.":
 currentPage===1?"Gebäudeübersicht A, B, C, D und E.":
 currentPage===2?"Raumverzeichnis und Fachraumnamen.":"Tippe eine beschriftete Raumnummer im Plan an.";
 root.innerHTML='<section class="sas-shopmap"><header><span class="sas-shopmap-kicker">SCHULE ALS STAAT · SHOPS</span><h1>Interaktiver RNG-Schulplan</h1><p>Gebäude, Stockwerk und Klassenzimmer auswählen. In jedem buchbaren Klassenzimmer stehen vier Shop-Plätze zur Verfügung.</p></header>'+
 floorNavigation()+
 '<div class="sas-shopmap-layout"><section class="sas-shopmap-card"><div class="sas-shopmap-head"><h2>Offizieller RNG-Gebäudeplan</h2><a target="_blank" rel="noopener noreferrer" href="'+PDF+'">Original-PDF öffnen ↗</a></div>'+
 '<div class="sas-shopmap-pdf" id="rng-plan-holder"><canvas id="rng-floorplan-canvas" aria-label="RNG-Grundriss, Seite '+currentPage+'"></canvas><div class="sas-shopmap-pins" aria-label="Klassenzimmer im Grundriss">'+mapPins()+'</div></div>'+
 '<p class="sas-shopmap-hint" id="rng-plan-status" role="status">Originalplan, Seite '+currentPage+' laden …</p>'+
 '<p class="sas-shopmap-hint">'+esc(pageInfo)+'</p></section>'+
 '<section class="sas-shopmap-card"><div class="sas-shopmap-head"><h2>Klassenräume</h2><span>'+total+' bestätigte Räume</span></div>'+
 '<label class="sas-shopmap-search">Raumnummer suchen<input id="sas-shopmap-search" type="search" placeholder="z. B. C202 oder E101" value="'+esc(query)+'"></label>'+
 '<div class="sas-shopmap-roomlist">'+(shown.length?shown.map(roomButton).join(""):'<p class="sas-shopmap-empty">'+(query?"Keine Raumbezeichnung gefunden.":"Auf dieser Planseite sind keine regulären Klassenräume ausgewiesen.")+'</p>')+'</div></section></div>'+
 '<section class="sas-shopmap-card"><h2>Vier Shop-Plätze je Raum</h2>'+roomDetails()+'</section>'+
 adminForm()+'<p id="shop-map-msg" class="sas-shopmap-msg" role="status" aria-live="polite"></p></section>';
 void paintPdf();
}
async function call(name,p){var r=await api.rpc(name,p||{});if(r.error)throw r.error;return r.data;}
async function refresh(note){var rows=await call("shop_room_catalog");rooms=Array.isArray(rows)?rows:[];if(selected&&!rooms.some(function(x){return x.id===selected;})){selected="";chosen=0;}draw();if(note)msg(note);}
async function execute(task){busy=true;try{await task();}catch(e){msg(e.message||String(e),true);}finally{busy=false;}}
async function apply(form){var r=rooms.find(function(x){return x.id===selected;});if(!r||!chosen||slot(r,chosen))throw Error("Platz ist nicht frei.");
 var d=new FormData(form),name=String(d.get("name")||"").trim(),description=String(d.get("description")||"").trim();
 if(name.length<3||name.length>100||description.length>450)throw Error("Bitte einen gültigen Shopnamen und eine kurze Beschreibung eingeben.");
 await call("request_shop_stall",{p_room_id:r.id,p_slot_no:chosen,p_shop_name:name,p_description:description});
 chosen=0;await refresh("Shop-Platz reserviert. Die Freigabe durch die Administration steht noch aus.");
}
async function addRoom(form){if(!admin)throw Error("Nicht berechtigt.");
 var d=new FormData(form),name=String(d.get("room")||"").trim().toUpperCase(),floor=String(d.get("floor")||"").trim(),detail=String(d.get("detail")||"").trim(),pageValue=String(d.get("page")||"").trim();
 var page=pageValue===""?null:Number(pageValue);
 if(!/^[A-Z][A-Z0-9 /-]{1,19}$/.test(name)||floor.length<2||floor.length>40||(page!==null&&(!Number.isInteger(page)||page<1||page>40)))throw Error("Raumnummer, Stockwerk oder PDF-Seite ungültig.");
 var result=await api.from("school_places").insert({name:name,kind:"room",floor_label:floor,detail:detail,active:true,classroom_shop_enabled:true,plan_page:page}).select("id").single();
 if(result.error)throw result.error;selected=result.data.id;chosen=0;await refresh("Raum mit vier Shop-Plätzen angelegt.");
}
async function show(context){root=context.target;api=context.api;userId=context.user.id;admin=context.profile&&context.profile.role==="admin";rooms=[];selected="";chosen=0;query="";busy=false;currentPage=4;currentBuilding="";pdfDocumentPromise=null;paintRun=0;
 root.addEventListener("input",function(e){
 if(e.target.id!=="sas-shopmap-search")return;
 query=e.target.value.trim().toLowerCase();
 var items=shownRooms(),list=root.querySelector(".sas-shopmap-roomlist");
 if(list)list.innerHTML=items.length?items.map(roomButton).join(""):'<p class="sas-shopmap-empty">Kein passender Klassenraum gefunden.</p>';
});
 root.addEventListener("click",function(e){var b=e.target.closest("button");if(!b||busy)return;
 if(b.hasAttribute("data-building-reset")){currentBuilding="";selected="";chosen=0;query="";draw();return;}
 if(b.dataset.building){
  currentBuilding=currentBuilding===b.dataset.building?"":b.dataset.building;
  if(currentBuilding)currentPage=currentBuilding==="B"?3:currentBuilding==="D"?5:4;
  selected="";chosen=0;query="";draw();return;
 }
 if(b.dataset.page){currentPage=Number(b.dataset.page);selected="";chosen=0;query="";draw();return;}
 if(b.dataset.room){selected=b.dataset.room;var room=rooms.find(function(x){return x.id===selected;});if(room&&room.plan_page){currentPage=Number(room.plan_page);currentBuilding=room.name.charAt(0);}chosen=0;query="";draw();return;}
 if(b.dataset.slot){chosen=Number(b.dataset.slot);draw();root.querySelector('[name="name"]')?.focus();return;}
 if(b.hasAttribute("data-close")){chosen=0;draw();return;}
 var id=b.dataset.cancel||b.dataset.approve||b.dataset.reject;if(!id)return;
 var cancel=b.hasAttribute("data-cancel"),approve=b.hasAttribute("data-approve");
 if(!confirm(cancel?"Shop-Reservierung wirklich zurücknehmen?":approve?"Diesen Shop genehmigen?":"Anfrage ablehnen?"))return;
 void execute(async function(){if(cancel)await call("cancel_shop_stall",{p_request_id:id});else await call("review_shop_stall",{p_request_id:id,p_approve:approve});await refresh(cancel?"Platz freigegeben.":approve?"Shop genehmigt und zur Shopverwaltung hinzugefügt.":"Anfrage abgelehnt.");});
 });
 root.addEventListener("submit",function(e){var form=e.target;if(form.id!=="sas-shopmap-apply"&&form.id!=="sas-shopmap-roomform")return;e.preventDefault();e.stopPropagation();if(busy)return;void execute(function(){return form.id==="sas-shopmap-apply"?apply(form):addRoom(form);});});
 root.innerHTML='<p class="sas-shopmap-loading">Schulplan und Shopbuchungen laden …</p>';
 try{await refresh();}catch(e){root.innerHTML='<div class="sas-shopmap-error"><h2>Schulplan momentan nicht verfügbar</h2><p>'+esc(e.message||e)+'</p><a target="_blank" rel="noopener noreferrer" href="'+PDF+'">Offizielles PDF öffnen ↗</a></div>';}
}
window.SAS_SHOP_PLAN={show:show};
})();