/* SaS ONE – school professions and staff roles; verified by server-side functions. */
(function(){
"use strict";
const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let state=null,roleList=[],people=[],query="";
async function rpc(name,args={}){const r=await state.api.rpc(name,args);if(r.error)throw r.error;return r.data;}
function notice(text,err=false){
 const n=state?.target.querySelector("#role-status");
 if(n){n.className="sas-feedback"+(err?" error":"");n.textContent=text;}
}
function render(){
 const ctx=state,admin=ctx.profile?.role==="admin";
 const wrap='<div class="sas-space"><div class="sas-heading"><div><span class="sas-kicker">VERWALTUNG / SCHULSTAAT</span><h1>Berufe & Rollen</h1><p>Admin hat den höchsten Rang. Operatoren können Schulberufe verwalten – keine höheren Berechtigungen vergeben.</p></div></div>';
 const roles=roleList.filter(r=>admin||r.tier<80);
 const card=people.length?people.map(p=>{
  const locked=!admin&&(p.system_role==="admin"||(p.jobs||[]).includes("operator"));
  const chips=(p.jobs||[]).map(slug=>'<span class="sas-badge">'+esc(roleList.find(r=>r.slug===slug)?.label||slug)+'</span>').join("");
  const actions=locked?'<p class="sas-note">Dieses Konto kann nur ein Administrator verwalten.</p>':roles.map(r=>{
   const assigned=(p.jobs||[]).includes(r.slug);
   return '<button type="button" class="sas-btn '+(assigned?"soft":"primary")+'" data-school-role="'+esc(r.slug)+'" data-user="'+esc(p.id)+'" data-enable="'+(assigned?"false":"true")+'">'+(assigned?"− Entfernen: ":"+ Zuweisen: ")+esc(r.label)+'</button>';
  }).join("");
  return '<article class="sas-item staff-person"><h3>'+esc(p.name)+'</h3><p>'+(p.email?esc(p.email)+' · ':'')+(p.system_role==="admin"?"Administrator":(p.jobs||[]).includes("operator")?"Operator":"Mitglied")+(p.verified?" · Schulidentität geprüft":" · Nicht schulisch geprüft")+'</p><div class="staff-chips">'+(chips||'<span class="sas-note">Noch kein Schulberuf</span>')+'</div><div class="staff-assignment">'+actions+'</div></article>';
 }).join(""):(query?'<div class="sas-empty">Keine passenden Konten gefunden.</div>':'<div class="sas-empty">Suche Schüler anhand ihres Namens. Administratoren können auch nach E-Mail-Adressen suchen.</div>');
 const create=admin?'<section class="sas-panel"><h2>Neuen Schulberuf erstellen</h2><p class="sas-note">Normale Berufe geben noch keine geschützten Sonderrechte. Admin- und Operatorrechte bleiben gesondert geschützt.</p><form class="sas-form" id="school-job-create"><label class="sas-field"><span>Kürzel für den Beruf (klein, ohne Leerzeichen)</span><input name="slug" pattern="[a-z][a-z0-9_]{2,31}" placeholder="z. B. fototeam" required maxlength="32"></label><label class="sas-field"><span>Bezeichnung</span><input name="label" minlength="3" maxlength="65" required placeholder="z. B. Fotograf"></label><label class="sas-field"><span>Beschreibung</span><textarea name="description" maxlength="400"></textarea></label><button type="submit" class="sas-btn primary">Beruf hinzufügen</button></form></section>':'';
 ctx.target.innerHTML=wrap+'<div class="sas-columns"><section class="sas-panel"><h2>Schüler finden und Rollen zuweisen</h2><form class="sas-form" id="school-role-search"><label class="sas-field"><span>Name (Admin: auch E-Mail)</span><input name="query" minlength="4" maxlength="80" value="'+esc(query)+'" placeholder="Mindestens vier Zeichen, keine Platzhalter" required autocomplete="off"></label><button class="sas-btn primary">Konten suchen</button></form><div class="sas-list role-directory">'+card+'</div></section><div><section class="sas-panel"><h2>Hierarchie und Schulberufe</h2><div class="sas-list">'+roleList.map(r=>'<div class="sas-item"><h3>'+esc(r.label)+'</h3><p>'+esc(r.description)+(r.tier===80?" · nur Admin zuweisbar":"")+'</p></div>').join("")+'</div></section>'+create+'</div></div><p class="sas-feedback" role="status" aria-live="polite" id="role-status"></p></div>';
}
async function show(ctx){
 state=ctx;
 ctx.target.textContent="Schulberufe werden geladen …";
 if(ctx.profile?.role!=="admin"&&!ctx.schoolRoles?.operator){ctx.target.textContent="Für diesen Bereich fehlen dir die Rechte.";return;}
 roleList=await rpc("school_role_catalog");
 people=[];query="";
 render();
 const host=ctx.target;
 if(host.dataset.schoolRoleBound)return;
 host.dataset.schoolRoleBound="true";
 host.addEventListener("submit",async e=>{
   const form=e.target.closest("#school-role-search,#school-job-create");
   if(!form)return;e.preventDefault();e.stopPropagation();
   const submit=form.querySelector('button[type="submit"]');if(submit)submit.disabled=true;
   try{
     const input=new FormData(form);
     if(form.id==="school-role-search"){
       query=String(input.get("query")||"").trim();
       people=await rpc("school_role_find_students",{p_query:query});
       render();notice(people.length+" passende Konten gefunden.");
     }else{
       const slug=String(input.get("slug")||"").trim();
       const label=String(input.get("label")||"").trim();
       const description=String(input.get("description")||"").trim();
       await rpc("create_school_job_role",{p_slug:slug,p_label:label,p_description:description});
       roleList=await rpc("school_role_catalog");
       render();notice("Neuer Schulberuf wurde erstellt.");
     }
   }catch(e){notice(e.message||String(e),true);if(submit)submit.disabled=false;}
 });
 host.addEventListener("click",async e=>{
   const btn=e.target.closest("button[data-school-role]");
   if(!btn)return;e.preventDefault();e.stopPropagation();
   const user=btn.dataset.user,slug=btn.dataset.schoolRole,enable=btn.dataset.enable==="true";
   if(!user||!slug)return;
   btn.disabled=true;
   try{
     await rpc("assign_school_role",{p_user_id:user,p_role_slug:slug,p_enabled:enable});
     people=await rpc("school_role_find_students",{p_query:query});
     render();notice(enable?"Schulberuf zugewiesen.":"Schulberuf entfernt.");
   }catch(err){btn.disabled=false;notice(err.message||String(err),true);}
 });
}
window.SAS_SCHOOL_ROLES={show};
})();