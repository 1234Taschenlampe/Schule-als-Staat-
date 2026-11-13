/* Schule als Staat: verified user-facing application status, updates and safe global search. */
(function(){
"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const label={pending:"In Prüfung",approved:"Genehmigt",rejected:"Abgelehnt",submitted:"Eingereicht",cancelled:"Zurückgezogen",open:"Offen"};
const status=v=>{const key=String(v||"submitted").toLowerCase();return '<span class="sas-hub-status" data-status="'+esc(key)+'">'+esc(label[key]||key)+'</span>';};
const time=v=>v?new Date(v).toLocaleString("de-DE",{dateStyle:"medium",timeStyle:"short"}):"";
const button=(page,title)=>'<button type="button" class="sas-hub-link" data-nav="'+esc(page)+'">'+esc(title)+' <span aria-hidden="true">→</span></button>';
const card=(title,description,s,page)=>'<article class="sas-hub-item"><div><strong>'+esc(title)+'</strong><p>'+esc(description)+'</p></div><div class="sas-hub-item-side">'+status(s)+button(page,"Öffnen")+'</div></article>';
async function records(request){const response=await request;if(response.error)throw response.error;return Array.isArray(response.data)?response.data:[];}
async function collect(ctx){
 const {api,user}=ctx,id=user.id;
 const tasks=[
  ["rooms",()=>records(api.from("room_bookings").select("id,place_id,starts_at,ends_at,purpose,status,submitted_at").eq("booked_by",id).order("submitted_at",{ascending:false}).limit(60))],
  ["jobs",()=>records(api.from("job_applications").select("id,job_id,submitted_at").eq("applicant_id",id).order("submitted_at",{ascending:false}).limit(60))],
  ["shops",async()=>{const r=await api.rpc("shop_room_catalog");if(r.error)throw r.error;return Array.isArray(r.data)?r.data:[];}]
 ];
 const all=await Promise.allSettled(tasks.map(([,fn])=>fn()));
 const found=Object.fromEntries(tasks.map(([key],i)=>[key,all[i].status==="fulfilled"?all[i].value:[]]));
 const unavailable=tasks.filter((_,i)=>all[i].status==="rejected").map(([key])=>key);
 const items=[];
 found.rooms.forEach(r=>items.push({kind:"Raumreservierung",title:"Raumanfrage",detail:(r.purpose||"Raum reservieren")+" · "+time(r.starts_at),date:r.submitted_at,status:r.status,page:"rooms"}));
 found.jobs.forEach(r=>items.push({kind:"Beruf",title:"Bewerbung",detail:"Bewerbung eingereicht · "+time(r.submitted_at),date:r.submitted_at,status:"submitted",page:"jobs"}));
 found.shops.forEach(r=>(r.slots||[]).filter(s=>s.mine).forEach(s=>items.push({kind:"Shop",title:"Shop-Anfrage · "+r.name+" / Platz "+s.number,detail:s.shop||"Shopplatz",date:null,status:s.status,page:"map"})));
 items.sort((a,b)=>String(b.date||"").localeCompare(String(a.date||"")));
 return {items,unavailable};
}
function heading(name,sub){return '<div class="sas-hub-header"><span class="sas-kicker">SCHULE ALS STAAT</span><h1>'+esc(name)+'</h1><p>'+esc(sub)+'</p></div>';}
function issues(unavailable){return unavailable.length?'<p class="sas-hub-warning" role="status">Einige Antragsdaten sind vorübergehend nicht abrufbar. Die angezeigte Übersicht ist möglicherweise unvollständig.</p>':"";}
async function showApplications(ctx){
 const target=ctx.target;target.innerHTML=heading("Meine Anträge","Shopplätze, Raumreservierungen und Bewerbungen auf einen Blick.")+'<p role="status">Anträge werden geladen …</p>';
 const result=await collect(ctx);if(!target.isConnected)return;
 const filters=['Alle','In Prüfung','Genehmigt','Abgelehnt','Eingereicht'];
 target.innerHTML=heading("Meine Anträge","Der jeweilige Status stammt aus deinem angemeldeten Benutzerkonto.")+
  issues(result.unavailable)+
  '<div class="sas-hub-filters" role="group" aria-label="Antragsstatus filtern">'+filters.map((f,i)=>'<button type="button" data-hub-filter="'+i+'" aria-pressed="'+(i===0)+'">'+esc(f)+'</button>').join("")+'</div>'+
  '<div id="sas-hub-application-list" class="sas-hub-list"></div>'+
  '<div class="sas-hub-shortcuts">'+button("map","Shop-Platz suchen")+button("rooms","Raum reservieren")+button("jobs","Stellenangebote")+'</div>';
 const host=target.querySelector("#sas-hub-application-list");
 function draw(filter){
  const list=result.items.filter(x=>filter===0||(filter===1&&x.status==="pending")||(filter===2&&x.status==="approved")||(filter===3&&x.status==="rejected")||(filter===4&&x.status==="submitted"));
  host.innerHTML=list.length?list.map(x=>card(x.title,x.detail,x.status,x.page)).join(""):'<p class="sas-hub-empty">'+(result.unavailable.length?"Keine passenden, abrufbaren Einträge.":"Keine passenden Anträge vorhanden.")+'</p>';
 }
 target.addEventListener("click",e=>{const b=e.target.closest("[data-hub-filter]");if(!b)return;const filter=Number(b.dataset.hubFilter);target.querySelectorAll("[data-hub-filter]").forEach(x=>x.setAttribute("aria-pressed",String(x===b)));draw(filter);});
 draw(0);
}
async function showUpdates(ctx){
 const target=ctx.target;target.innerHTML=heading("Mitteilungen","Aktuelle Antragsstände und anstehende Termine.")+'<p role="status">Hinweise werden geladen …</p>';
 const [applications,events]=await Promise.all([collect(ctx),records(ctx.api.from("school_events").select("title,starts_at,ends_at").gte("ends_at",new Date().toISOString()).order("starts_at",{ascending:true}).limit(4)).catch(()=>null)]);
 if(!target.isConnected)return;
 const decisions=applications.items.filter(x=>["approved","rejected","pending"].includes(x.status)).slice(0,10);
 const dateEvents=(events||[]).map(e=>'<article class="sas-hub-item"><div><strong>'+esc(e.title)+'</strong><p>'+esc(time(e.starts_at))+'</p></div>'+button("events","Veranstaltung")+'</article>');
 const pollCount=(ctx.profile?.role==="admin")&&Array.isArray(ctx.polls)?ctx.polls.filter(p=>p.status==="open"&&!p.has_voted).length:0;
 const poll=pollCount?'<article class="sas-hub-item"><div><strong>'+pollCount+' offene Abstimmung'+(pollCount===1?'':'en')+'</strong><p>Du hast bei mindestens einer offenen Abstimmung noch nicht abgestimmt.</p></div>'+button("votes","Abstimmen")+'</article>':"";
 target.innerHTML=heading("Mitteilungen","Stand beim Öffnen der Seite. Es werden keine Push-Nachrichten verschickt.")+
  issues(applications.unavailable)+(events===null?'<p class="sas-hub-warning">Veranstaltungen konnten nicht geladen werden.</p>':"")+
  '<section class="sas-hub-list"><h2>Deine Vorgänge</h2>'+ (decisions.length?decisions.map(x=>card(x.title,x.detail,x.status,x.page)).join(""):'<p class="sas-hub-empty">Keine offenen oder entschiedenen Anträge vorhanden.</p>')+'</section>'+
  '<section class="sas-hub-list"><h2>Demnächst</h2>'+poll+(dateEvents.length?dateEvents.join(""):'<p class="sas-hub-empty">Keine bevorstehenden Veranstaltungen eingetragen.</p>')+'</section>';
}
async function enrichHome(ctx){
 const host=ctx.target;if(!host)return;
 const role=ctx.profile?.role==="admin"?"Administration":ctx.schoolRoles?.operator?"Operator":ctx.schoolRoles?.jobs?.length?"Schulberuf / Shop":"Schulbürger";
 const options=role==="Administration"?[["admin","Verwaltung"],["map","Schulplan"]]:
   role==="Operator"?[["roles","Berufe & Rollen"],["jobs","Bewerbungen"],["map","Schulplan"]]:
   role==="Schulberuf / Shop"?[["shopmanage","Shopverwaltung"],["applications","Meine Anträge"],["workhours","Arbeitszeit"]]:
   [["applications","Meine Anträge"],["map","Shopplätze"],["workhours","Meine Arbeitszeit"]];
 const polls=(ctx.profile?.role==="admin")&&Array.isArray(ctx.polls)?ctx.polls.filter(p=>p.status==="open"&&!p.has_voted).length:0;
 host.innerHTML='<div class="sas-hub-home-title"><h2>Dein Bereich</h2><span>'+esc(role)+'</span></div><div class="sas-hub-shortcuts">'+options.map(([page,title])=>button(page,title)).join("")+button("updates","Mitteilungen")+'</div>'+
  '<p class="sas-hub-note" role="status">'+(polls?polls+' offene Abstimmung'+(polls===1?'':'en')+'. ':'')+'Aktuelle Anträge und Termine findest du unter „Mitteilungen“.</p>';
}
const normalize=q=>String(q||"").trim().replace(/[%_\\]/g,"").slice(0,60);
async function search(ctx,q){
 const term=normalize(q);if(term.length<2)return [];
 const pattern="%"+term+"%";
 const tasks=[
  async()=>records(ctx.api.from("school_places").select("name,kind,floor_label").eq("active",true).ilike("name",pattern).order("name").limit(10)),
  async()=>records(ctx.api.from("school_events").select("title,starts_at").ilike("title",pattern).gte("ends_at",new Date().toISOString()).limit(6)),
  async()=>records(ctx.api.from("civic_posts").select("title").eq("kind","job").ilike("title",pattern).limit(6)),
  async()=>records(ctx.api.from("portal_posts").select("title,section").eq("published",true).ilike("title",pattern).limit(6))
 ];
 const roomCode=/^[A-E]-?\d{1,3}$/i.test(term);
 const r=await Promise.allSettled(tasks.map((fn,i)=>roomCode&&i>0?Promise.resolve([]):fn()));
 const take=i=>r[i].status==="fulfilled"?r[i].value:[];
 let list=take(0).map(p=>({title:p.name,detail:p.floor_label||"",page:p.kind==="shop"?"shops":"map",focus:p.kind==="room"?p.name:null,category:p.kind==="shop"?"Geschäft":"Raum"}));
 list.push(...take(1).map(e=>({title:e.title,detail:time(e.starts_at),page:"events",category:"Veranstaltung"})));
 list.push(...take(2).map(e=>({title:e.title,detail:"Offene Stelle",page:"jobs",category:"Beruf"})));
 list.push(...take(3).map(e=>({title:e.title,detail:"Veröffentlichung",page:e.section==="blog"?"blog":"bulletin",category:"Beitrag"})));
 if(window.SAS_SHOP_PLAN?.knownRooms){
  const seen=new Set(list.filter(x=>x.category==="Raum").map(x=>x.title.toLowerCase()));
  for(const p of window.SAS_SHOP_PLAN.knownRooms(term)){
   if(seen.has(p.name.toLowerCase()))continue;
   list.push({title:p.name,detail:p.floor||"Offizieller Schulplan",page:"map",focus:p.name,category:"Raum"});
   seen.add(p.name.toLowerCase());
  }
 }
 return list.slice(0,24);
}
window.SAS_PORTAL_EXTRAS={showApplications,showUpdates,enrichHome,search,collect};
})();