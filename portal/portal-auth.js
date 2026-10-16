/* SaS ONE V3 bridge: real Supabase login, admin-only real posts, V3 demos kept separate. */
(async function(){
  'use strict';
  const ready=()=>document.documentElement.classList.add('portal-auth-ready');
  const problem=()=>{
    document.body.innerHTML='<main style="max-width:520px;margin:12vh auto;padding:35px;border-radius:20px;background:white;font:16px/1.5 system-ui"><h1>Portal momentan nicht erreichbar</h1><p>Bitte prüfe die Internetverbindung und öffne die zentrale Plattform erneut.</p><a href="../">Zur Anmeldung und Hauptplattform ↗</a></main>';
    ready();
  };
  const node=(tag,cls,value)=>{
    const el=document.createElement(tag);
    if(cls)el.className=cls;
    if(value!==undefined)el.textContent=String(value);
    return el;
  };
  try {
    const cfg=window.NV_CONFIG;
    if(!cfg?.supabaseUrl||!cfg?.supabaseAnonKey||!window.supabase?.createClient){problem();return;}
    const api=window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey);
    const result=await api.auth.getUser();
    if(result.error||!result.data?.user){
      window.location.replace('../?after=portal');
      return;
    }
    const user=result.data.user;
    const profile=await api.from('profiles').select('role').eq('id',user.id).single();
    const isAdmin=!profile.error&&profile.data?.role==='admin';
    const badge=node('span','','Angemeldet: '+(user.email||'Mitglied')+' · '+(isAdmin?'Administration':'Mitglied'));
    badge.style.cssText='display:block;padding:6px 14px;color:#bcd1f8;font-size:12px;word-break:break-word';
    const sidebar=document.querySelector('.sidebar-bottom');
    if(sidebar)sidebar.prepend(badge);
    ready();
    api.auth.onAuthStateChange((event,session)=>{
      if(event==='SIGNED_OUT'||!session)window.location.replace('../?after=portal');
    });

    let posts=[],lastError='';
    const section=()=>{
      const hash=decodeURIComponent(location.hash.slice(1));
      return hash==='news'||hash==='blog'?hash:null;
    };
    async function load(){
      const res=await api.from('portal_posts').select('id,section,title,body,created_at').eq('published',true).order('created_at',{ascending:false}).limit(40);
      lastError=res.error?res.error.message:'';
      posts=res.data||[];
      const previous=document.getElementById('sas-live-feed');
      if(previous)previous.remove();
      mountPosts();
    }
    function mountPosts(){
      const target=document.getElementById('pageContent');
      const current=section();
      if(!target||!current||document.getElementById('sas-live-feed'))return;
      const panel=node('section','card mb20');
      panel.id='sas-live-feed';
      const heading=node('div','card-header');
      const labels=node('div');
      labels.append(node('h2','',current==='news'?'Schwarzes Brett · echte Beiträge':'Projektblog · echte Beiträge'));
      labels.append(node('p','small muted','Aus Supabase. Nur Administratoren können Beiträge veröffentlichen.'));
      heading.append(labels);
      const reload=node('button','btn btn-outline btn-sm','Aktualisieren');
      reload.type='button';
      reload.addEventListener('click',()=>{reload.disabled=true;load().finally(()=>reload.disabled=false);});
      heading.append(reload);
      panel.append(heading);
      if(lastError)panel.append(node('p','subnote','Die aktuellen Beiträge konnten nicht geladen werden: '+lastError));
      else{
        const currentPosts=posts.filter(p=>p.section===current);
        if(!currentPosts.length)panel.append(node('p','subnote','Noch keine veröffentlichten Beiträge. Weiter unten stehen die ursprünglichen V3-Beispielbeiträge.'));
        for(const post of currentPosts){
          const article=node('article','feed-item');
          const details=node('div','grow');
          const date=node('div','small muted',new Date(post.created_at).toLocaleString('de-DE',{dateStyle:'medium',timeStyle:'short'}));
          const title=node('h3','',post.title);
          const body=node('p','',post.body);
          body.style.whiteSpace='pre-wrap';
          details.append(date,title,body);
          article.append(details);
          if(isAdmin){
            const remove=node('button','btn btn-outline btn-sm','Löschen');
            remove.type='button';
            remove.addEventListener('click',async()=>{
              if(!confirm('Diesen Beitrag unwiderruflich löschen?'))return;
              const res=await api.from('portal_posts').delete().eq('id',post.id);
              if(res.error){alert('Löschen nicht möglich: '+res.error.message);return;}
              await load();
            });
            article.append(remove);
          }
          panel.append(article);
        }
      }
      if(isAdmin){
        const form=node('form','stack');
        form.id='sas-real-post-form';
        form.style.marginTop='22px';
        const hint=node('h3','','Neuen offiziellen Beitrag veröffentlichen');
        const titleLabel=node('label','','Überschrift');
        const titleInput=node('input','input');
        titleInput.type='text';titleInput.name='title';titleInput.required=true;titleInput.minLength=4;titleInput.maxLength=140;
        const textLabel=node('label','','Beitrag');
        const area=node('textarea','input');
        area.name='body';area.required=true;area.minLength=4;area.maxLength=4000;area.rows=5;
        const submit=node('button','btn btn-primary','Veröffentlichen');
        submit.type='submit';
        form.append(hint,titleLabel,titleInput,textLabel,area,submit);
        form.addEventListener('submit',async event=>{
          event.preventDefault();event.stopPropagation();
          submit.disabled=true;
          const res=await api.from('portal_posts').insert({
            section:current,title:titleInput.value.trim(),body:area.value.trim(),author_id:user.id
          });
          submit.disabled=false;
          if(res.error){alert('Veröffentlichung fehlgeschlagen: '+res.error.message);return;}
          form.reset();await load();
        });
        panel.append(form);
      }
      target.prepend(panel);
    }
    const page=document.getElementById('pageContent');
    if(page)new MutationObserver(mountPosts).observe(page,{childList:true});
    await load();
  }catch(e){problem();}
})();
