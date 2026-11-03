/* Staatsflaggen-Wahl. Zeigt absichtlich niemals submitted_by oder Urheberdaten. */
(function(){
"use strict";
const escapeText=x=>String(x??"").replace(/[&<>"']/g,ch=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[ch]));
const validImage=x=>typeof x==="string"&&(
  /^assets\/flags\/[a-z0-9_-]+\.(?:webp|png|jpe?g)$/i.test(x)||
  /^https:\/\/raw\.githubusercontent\.com\/1234Taschenlampe\/Schule-als-Staat-\/[a-z0-9_-]+\/assets\/flags\/[a-z0-9_-]+\.(?:webp|png|jpe?g)$/i.test(x)
);
let generation=0;
async function enhance({api,polls=[],target}){
  const token=++generation;
  if(!target||!target.isConnected)return;
  const result=await Promise.all([
    api.from("school_competitions").select("slug,status,poll_id").eq("slug","state_flag").maybeSingle(),
    api.from("school_competition_entries").select("id,title,image_path,meaning,option_id,created_at")
      .eq("competition_slug","state_flag").eq("approved",true).order("created_at",{ascending:true})
  ]);
  if(token!==generation||!target.isConnected)return;
  const [competitionResult,entriesResult]=result;
  if(competitionResult.error||entriesResult.error){
    target.innerHTML='<p class="details">Die Flaggenvorschläge sind derzeit nicht abrufbar.</p>';
    return;
  }
  const competition=competitionResult.data;
  const entries=(entriesResult.data||[]).filter(e=>validImage(e.image_path));
  if(!entries.length){
    target.innerHTML='<p class="details">Die Flaggenentwürfe werden hier veröffentlicht, sobald alle Bilder und Bedeutungen vorliegen.</p><p class="field-help">Die Flaggen werden anonym präsentiert.</p>';
    return;
  }
  const poll=Array.isArray(polls)?polls.find(p=>p.id===competition?.poll_id):null;
  const active=competition?.status==="open" && poll?.status==="open";
  const voted=Boolean(poll?.has_voted);
  const enabled=Boolean(target.dataset.voteEligible==="true");
  const selectable=active&&!voted&&enabled;
  const cards=entries.map((e,i)=>{
    const title="Entwurf "+(i+1);
    const meaning=String(e.meaning||"").trim()||"Zu diesem Entwurf wurde noch keine Beschreibung hinterlegt.";
    const eligible=selectable&&e.option_id;
    return '<article class="sas-flag-card" data-flag-entry="'+escapeText(e.id)+'">'+
      '<button type="button" class="sas-flag-flipper" aria-pressed="false" aria-label="'+title+': Bedeutung anzeigen">'+
      '<span class="sas-flag-inner">'+
        '<span class="sas-flag-face sas-flag-front"><img class="sas-flag-fabric" src="'+escapeText(e.image_path)+'" alt="'+title+' – Flaggenentwurf" loading="lazy" decoding="async"></span>'+
        '<span class="sas-flag-face sas-flag-back"><strong>Was bedeutet die Flagge?</strong><span class="sas-flag-back-text">'+escapeText(meaning)+'</span></span>'+
      '</span><span class="sas-flag-hint">Antippen zum Umdrehen</span></button>'+
      '<label class="sas-flag-select"><input type="radio" name="choice" value="'+escapeText(e.option_id||"")+'" '+(eligible?'required':'disabled')+'><span>'+title+' wählen</span></label>'+
      '</article>';
  }).join("");
  const status=!active?"Abstimmung noch nicht freigeschaltet":voted?"Deine Stimme wurde bereits abgegeben":!enabled?"Stimmrecht noch nicht freigeschaltet":"Wähle einen Entwurf. Deine Stimme zählt erst nach der Bestätigung.";
  target.innerHTML='<p class="sas-flag-overview-note">Jeder Entwurf erscheint ohne Namen der entwerfenden Person. Rückseite durch Antippen öffnen.</p>'+
    '<form id="flag-vote-form" data-poll-id="'+escapeText(competition?.poll_id||"")+'"><fieldset class="poll-fieldset" '+(selectable?'':'disabled')+'><legend class="sr-only">Wähle einen Flaggenentwurf</legend><div class="sas-flag-grid">'+cards+'</div></fieldset>'+
    '<div class="sas-flag-vote-footer"><span class="details">'+escapeText(status)+'</span>'+
    (selectable?'<button type="submit" class="btn primary">Verbindlich abstimmen</button>':'')+
    '</div></form>';
  target.addEventListener("click",function(ev){
    const btn=ev.target.closest(".sas-flag-flipper");
    if(!btn||!target.contains(btn))return;
    const card=btn.closest(".sas-flag-card");
    if(!card)return;
    const flipped=card.classList.toggle("is-flipped");
    btn.setAttribute("aria-pressed",String(flipped));
    btn.setAttribute("aria-label",flipped?"Flaggenvorderseite anzeigen":"Bedeutung anzeigen");
  },{once:false});
}
window.SAS_FLAG_VOTING={enhance};
})();