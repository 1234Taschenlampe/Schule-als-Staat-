/* Classroom shop map: official PDF + real Supabase four-slot bookings. */
(function(){
"use strict";
var PDF="https://www.rng-wangen.de/wp-content/uploads/2024/07/230625_digitaler-uebersichtsplan.pdf";
var root,api,userId,admin,rooms=[],selected="",chosen=0,query="",busy=false;
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
function draw(){var shown=rooms.filter(function(r){return (r.name+" "+r.floor+" "+r.detail).toLowerCase().includes(query);});
 var current=rooms.find(function(x){return x.id===selected;});
 var page=current&&current.plan_page?"#page="+Number(current.plan_page):"";
 root.innerHTML='<section class="sas-shopmap"><header><span class="sas-shopmap-kicker">SCHULE ALS STAAT · SHOPS</span><h1>Interaktiver Schulplan</h1><p>Raum auswählen und einen von vier Shop-Plätzen buchen.</p></header>'+
 '<div class="sas-shopmap-layout"><section class="sas-shopmap-card"><div class="sas-shopmap-head"><h2>Offizieller RNG-Gebäudeplan</h2><a target="_blank" rel="noopener noreferrer" href="'+PDF+'">Original-PDF öffnen ↗</a></div><iframe title="Offizieller Gebäudeplan des RNG" src="'+PDF+page+'" loading="lazy" referrerpolicy="no-referrer"></iframe><p class="sas-shopmap-hint">Quelle: Rupert-Neß-Gymnasium Wangen. Falls das PDF nicht eingebettet angezeigt wird, öffne es über den Link. Die anklickbaren Räume stehen rechts.</p></section>'+
 '<section class="sas-shopmap-card"><div class="sas-shopmap-head"><h2>Freigegebene Klassenzimmer</h2><span>'+rooms.length+' Räume</span></div><label class="sas-shopmap-search">Raumnummer suchen<input id="sas-shopmap-search" type="search" placeholder="Raum / Etage" value="'+esc(query)+'"></label><div class="sas-shopmap-roomlist">'+(shown.length?shown.map(roomButton).join(""):'<p class="sas-shopmap-empty">'+(rooms.length?"Kein Raum gefunden.":"Noch keine Klassenzimmer vom Schulteam freigegeben.")+'</p>')+'</div></section></div>'+
 '<section class="sas-shopmap-card"><h2>Vier Shop-Plätze je Raum</h2>'+roomDetails()+'</section>'+adminForm()+'<p id="shop-map-msg" class="sas-shopmap-msg" role="status" aria-live="polite"></p></section>';
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
async function show(context){root=context.target;api=context.api;userId=context.user.id;admin=context.profile&&context.profile.role==="admin";rooms=[];selected="";chosen=0;query="";busy=false;
 root.addEventListener("input",function(e){if(e.target.id!=="sas-shopmap-search")return;var caret=e.target.selectionStart;query=e.target.value.toLowerCase();draw();var node=root.querySelector("#sas-shopmap-search");if(node){node.focus();if(caret!==null)node.setSelectionRange(caret,caret);}});
 root.addEventListener("click",function(e){var b=e.target.closest("button");if(!b||busy)return;
 if(b.dataset.room){selected=b.dataset.room;chosen=0;draw();return;}
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