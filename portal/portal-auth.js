/* SaS ONE V3 bridge: reuses the real V4 Supabase session. Do not copy credentials or profile data into demo storage. */
(async function(){
  'use strict';
  const ready=()=>document.documentElement.classList.add('portal-auth-ready');
  const problem=()=>{document.body.innerHTML='<main style="max-width:520px;margin:12vh auto;padding:35px;border-radius:20px;background:white;font:16px/1.5 system-ui"><h1>Portal momentan nicht erreichbar</h1><p>Bitte prüfe die Internetverbindung und öffne die zentrale Plattform erneut.</p><a href="../">Zur Anmeldung und Hauptplattform ↗</a></main>';ready();};
  try {
    const cfg=window.NV_CONFIG;
    if(!cfg?.supabaseUrl||!cfg?.supabaseAnonKey||!window.supabase?.createClient){problem();return;}
    const api=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
    const result=await api.auth.getUser();
    if(result.error||!result.data?.user){
      window.location.replace('../?after=portal');
      return;
    }
    const badge=document.createElement('span');
    badge.style.cssText='display:block;padding:6px 14px;color:#bcd1f8;font-size:12px;word-break:break-word';
    badge.textContent='Angemeldet: '+(result.data.user.email||'Mitglied')+' · V3-Vorschau';
    const sidebar=document.querySelector('.sidebar-bottom');
    if(sidebar)sidebar.prepend(badge);
    ready();
    api.auth.onAuthStateChange((event,session)=>{if(event==='SIGNED_OUT'||!session){window.location.replace('../?after=portal');}});
  } catch(e){problem();}
})();
