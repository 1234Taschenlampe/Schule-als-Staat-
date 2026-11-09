
(function () {
  "use strict";
  var cfg=window.NV_CONFIG||{}, root=document.getElementById("app"), toasts=document.getElementById("toast-root");
  var ready=Boolean(cfg.supabaseUrl&&cfg.supabaseAnonKey&&window.supabase&&window.supabase.createClient);
  // Send only approved read-only RPCs through same-origin Overlord.
  // Auth, personal tables, payment writes and all other operations remain on
  // Supabase with their existing authorization and RLS protections.
  var safeRpc=new Set([]); // Restore direct authenticated Supabase RPC until gateway integration is fixed.
  function sasGatewayFetch(input,options){
    var originalUrl=typeof input==="string"?input:input?.url||"";
    var url;
    try{url=new URL(originalUrl);}catch{return fetch(input,options);}
    if(url.origin===cfg.supabaseUrl &&
       url.pathname.startsWith("/rest/v1/rpc/") &&
       safeRpc.has(url.pathname.split("/").pop()) &&
       String(options?.method||"POST").toUpperCase()==="POST" &&
       (!options?.body||options.body==="{}")){
      return fetch(location.origin+"/api/v1/rpc/"+url.pathname.split("/").pop(),options);
    }
    return fetch(input,options);
  }
  var api=ready?window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey,{
    global:{fetch:sasGatewayFetch}
  }):null;
  var state={user:null,profile:null,wallet:null,ledger:[],cash:[],requests:[],users:[],polls:[],pollResults:[],schoolRoles:{operator:false,jobs:[]},page:"home",active:null,invoice:null,scanner:null,scanning:false,busy:false,editing:false,legalStatus:null,deletionStatus:null,deletionRequests:[],showDeletionForm:false,deletionStage:1,deletionReadToEnd:false,recovering:/(?:^|[&#?])type=recovery(?:&|$)/.test(location.hash)};
  var deepLink=new URLSearchParams(location.search).get("pay");
  var openPortalAfterLogin=false; // No old V3 demo portal; all live features are integrated.
  if(deepLink)state.page="pay";
  var units=String(cfg.currencyLabel||"Einheiten");
  var navs=[["home","Übersicht"],["wallet","Mein Konto"],["pay","Bezahlen"],["register","Kasse"],["history","Verlauf"],["votes","Abstimmungen"],["settings","Einstellungen"]];
  if(window.SAS_FEATURES)navs.splice(navs.length-1,0,...window.SAS_FEATURES.navigation.map(function(n){return [n[0],n[1]];}));
  if(window.SAS_SCHOOL_ROLES)navs.splice(navs.length-1,0,["roles","Berufe & Rollen"]);
  navs.splice(navs.length-1,0,["myjob","Mein Beruf"],["applications","Meine Anträge"],["updates","Mitteilungen"]);
  if(window.SAS_ADMIN_CREDIT)navs.splice(navs.length-1,0,["admincredit","Geld ausgeben"]);
  if(window.SAS_SHOPS)navs.splice(navs.length-1,0,["shopmanage","Shopverwaltung"]);
  if(window.SAS_CARD_SHOP)navs.splice(navs.length-1,0,["cardshop","3D-Ausweis-Shop"]);
  if(window.SAS_ATTENDANCE)navs.splice(navs.length-1,0,["attendance","Anwesenheitskontrolle"]);
  if(window.SAS_WORK_HOURS)navs.splice(navs.length-1,0,["workhours","Arbeitszeit"]);
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
  // Technical Supabase Auth aliases are not deliverable e-mail addresses.
  function accountDisplay(email){
    var value=String(email||"").trim();
    var citizen=/^([a-z0-9]{10})@accounts\.schule-als-staat\.invalid$/i.exec(value);
    return citizen?{label:"Bürgerkennung",value:"SAS-"+citizen[1].toUpperCase()}:{label:"Konto",value:"Verwaltung"};
  }
  function cashFmt(v){return new Intl.NumberFormat("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(v||0)/100)+" "+esc(units);}
  function time(v){return new Intl.DateTimeFormat("de-DE",{dateStyle:"medium",timeStyle:"short"}).format(new Date(v));}
  function adminOrCashier(){return state.profile&&["admin","cashier"].includes(state.profile.role);}
  function roleLabel(){if(state.profile&&state.profile.role==="admin")return "Administration";if(state.schoolRoles?.operator)return "Operator";return {cashier:"Kassenpersonal",member:"Mitglied"}[state.profile&&state.profile.role]||"Mitglied";}
  function showToast(message,isError){
    toasts.querySelectorAll(".toast").forEach(function(t){t.remove();});
    var el=document.createElement("div");
    el.className="toast"+(isError?" err":"");
    el.textContent=String(message);
    toasts.appendChild(el);
    setTimeout(function(){if(el.isConnected)el.remove();},5500);
  }
  function friendlyAuthError(e){
    var code=String(e&&e.code||"").toLowerCase();
    var original=String(e&&e.message||e||"");
    var message=original.toLowerCase();
    if(code==="invalid_credentials"||/invalid login credentials/.test(message))return "Kennung oder Passwort ist falsch. Bitte überprüfe deine Zugangsdaten.";
    if(code==="email_not_confirmed"||/email not confirmed/.test(message))return "Dieses Konto ist noch nicht zur Anmeldung freigeschaltet. Bitte wende dich an die Schulverwaltung.";
    if(code==="over_email_send_rate_limit"||/email rate limit exceeded/.test(message))return "Die Anmeldung ist vorübergehend nicht verfügbar. Bitte informiere die Schulverwaltung.";
    if(code==="over_request_rate_limit"||/for security purposes.*after \d+ seconds|rate limit exceeded/.test(message))return "Zu viele Versuche hintereinander. Bitte warte kurz, bevor du es erneut versuchst.";
    if(code==="user_already_exists"||/user already registered/.test(message))return "Konto bereits vergeben. Bitte melde dich an.";
    return original;
  }
  function fail(e){showToast(friendlyAuthError(e),true);}
  function signupAccountExists(result){
    // Supabase Auth owns email uniqueness. Never expose auth.users to anonymous clients.
    var err=result&&result.error;
    var code=String(err&&err.code||"").toLowerCase();
    var message=String(err&&err.message||"").toLowerCase();
    if(["user_already_exists","email_exists","user_already_registered"].includes(code))return true;
    if(/user already registered|already registered|email already (exists|in use)|email address already in use|bereits registriert/.test(message))return true;
    var auth=result&&result.data;
    return !!(!err&&auth&&!auth.session&&auth.user&&Array.isArray(auth.user.identities)&&auth.user.identities.length===0);
  }

  function header(section,title,text){return '<div class="page-heading"><div class="eyebrow">'+section+'</div><h1>'+title+'</h1><p class="lead">'+text+'</p></div>';}
  function btn(title,key,alt){return '<button type="button" class="btn '+(alt||"primary")+'" data-action="'+key+'">'+title+'</button>';}
  function info(text,warning){return '<div class="info '+(warning?"warning":"")+'">'+text+'</div>';}
  function amount(x){
    var f=Number(String(x||"").trim().replace(",", ".")),c=Math.round(f*100);
    if(!Number.isFinite(f)||!Number.isSafeInteger(c)||c<1||c>1000000)throw Error("Betrag muss zwischen 0,01 und 10.000,00 liegen.");
    return c;
  }
  async function rpc(name,params){if(!api)throw Error("Backend nicht verbunden");var r=await api.rpc(name,params);if(r.error)throw r.error;return r.data;}
  async function claimDesignatedAdmin(){
    // The database function only reports whether this authenticated user is already an admin.
    // Registration never assigns admin rights based solely on a claimed email address.
    return rpc("claim_initial_admin",{});
  }
  async function fetchData(){
    if(!state.user)return;
    var id=state.user.id;
    var rows=await Promise.all([
      api.from("profiles").select("id,role,vote_eligible,school_verified_at").eq("id",id).single(),
      api.from("wallets").select("balance_cents").eq("user_id",id).single(),
      api.from("wallet_ledger").select("*").order("created_at",{ascending:false}).limit(60),
      api.from("cash_sales").select("*").order("created_at",{ascending:false}).limit(50),
      api.from("payment_requests").select("*").order("created_at",{ascending:false}).limit(50)
    ]);
    rows.forEach(function(row){if(row.error)throw row.error;});
    state.profile=rows[0].data;state.legalStatus=await rpc('school_legal_status',{});state.deletionStatus=await rpc('my_school_deletion_status',{});if(state.profile)state.profile.display_name=accountDisplay(state.user.email).value;state.wallet=rows[1].data;state.ledger=rows[2].data||[];state.cash=rows[3].data||[];state.requests=rows[4].data||[];
    if(state.active)state.active=state.requests.find(function(x){return x.id===state.active.id;})||state.active;
    state.schoolRoles=await rpc("my_school_roles",{})||{operator:false,jobs:[]};
    state.users=state.profile.role==="admin"?await rpc("admin_list_user_ids",{}):[];
    state.deletionRequests=state.profile.role==="admin"?await rpc("admin_list_school_deletion_requests",{}):[];
    state.polls=(state.profile.role==="admin"||state.schoolRoles?.operator)?await rpc("poll_catalog",{}):[];
    state.pollResults=(state.profile.role==="admin"||state.schoolRoles?.operator)?await rpc("admin_poll_results",{}):[];
  }
  var refreshPending=false;
  async function refresh(silent){
    if(!state.user||state.busy||state.scanning||refreshPending)return;
    refreshPending=true;
    var requestedPage=state.page;
    try{
      await fetchData();
      if(state.page===requestedPage&&(!silent||(!state.editing&&!document.querySelector("dialog[open]")&&["home","wallet","history","votes"].includes(state.page)))){
        if(silent&&window.scrollY>40)return;
        var scroll=window.scrollY;render();
        if(silent&&scroll>0)requestAnimationFrame(function(){window.scrollTo({top:scroll,behavior:"instant"});});
      }
    }catch(e){if(!silent)fail(e);}
    finally{refreshPending=false;}
  }
  var groups=[
    ["Mein Bereich",["idcard","gallery","cardshop","applications","updates","workhours","myjob","wallet","pay","history"]],
    ["Schulleben",["bulletin","blog","events","lost"]],
    ["Organisation",["map","rooms","shops","shopmanage","jobs"]],
    ["Staat & Mitbestimmung",["votes","laws","parties","courts"]],
    ["Verwaltung",["overlord","register","admincredit","attendance","roles","admin","settings"]]
  ];
  var descriptions={cardshop:"Gedruckten Schülerausweis ansehen und vormerken",applications:"Status deiner Shop-, Raum- und Berufsanträge",updates:"Aktuelle Antragsstände und Veranstaltungen",overlord:"API-Schutz und Serverstatus (Admin)",admincredit:"Schulwährung per Ausweis-QR gutschreiben",workhours:"Arbeitszeit 12.–16. Juli 2027 per QR-Code erfassen",roles:"Schulberufe und Operatorrechte vergeben",attendance:"Anwesenheit per Schülerausweis scannen",home:"Ausweis, Kontostand und Mitteilungen",idcard:"Persönlicher Schülerausweis mit QR-Code",gallery:"Ausweisdesign auswählen",wallet:"Guthaben und Kontobewegungen",pay:"QR-Code scannen und Betrag prüfen",history:"Digitale Buchungen und Bargeld",bulletin:"Aktuelle Bekanntmachungen",blog:"Beiträge aus dem Projekt",events:"Termine und Anmeldungen",lost:"Verlorenes suchen, Gefundenes melden",map:"Schulplan: vier Shops pro Klassenzimmer",rooms:"Raumreservierungen anfragen",shops:"Geschäfte und Kassen",jobs:"Aufgaben finden und sich bewerben",votes:"Aktuelle und abgeschlossene Abstimmungen",laws:"Regeln und Verordnungen nachlesen",parties:"Mitteilungen der Parteien",courts:"Öffentliche Gerichtsbekanntmachungen",register:"Verkäufe und QR-Zahlungen erfassen",admin:"Guthaben, Rollen und Stimmrecht verwalten",settings:"Profil, Passwort und Geräte"};
  var iconPaths={applications:'M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5',updates:'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9 M10 20h4',overlord:'M4 4h16v16H4z M8 16l3-4 3 2 3-5',guestvisa:"M4 4h16v16H4z M8 8h8 M8 12h8 M8 16h5",admincredit:"M12 2v20 M17 6H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H6",myjob:'M3 7h18v14H3z M8 7V3h8v4 M3 12h18',shopmanage:'M3 7h18 M5 7V4h14v3 M5 7v14h14V7 M9 12h6 M9 16h6',workhours:'M12 3v9l4 2 M21 12a9 9 0 1 1-9-9',roles:'M4 6h16 M4 12h16 M4 18h16 M6 8h3 M6 14h3',attendance:'M3 8V4h5 M16 4h5v4 M21 16v5h-5 M8 21H3v-5 M9 12l2 2 4-4',home:'M3 10l9-7 9 7v11H3z M9 21v-8h6v8',idcard:'M3 5h18v14H3z M7 9h3v4H7z M14 9h4 M14 13h4 M7 16h11',gallery:'M4 4h16v16H4z M8 8h3v3H8z M4 16l5-4 4 3 3-2 4 3',visa:'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h3',wallet:'M3 6h17v14H3z M3 6V4h14 M15 11h6v5h-6z',pay:'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M8 10h3v3H8z M14 10h2 M14 14h3 M8 16h3',history:'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',bulletin:'M4 5h16v14H4z M8 9h8 M8 13h5 M8 19v3 M16 19v3',blog:'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',events:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2',lost:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M15 15l6 6 M7 10h6 M10 7v6',map:'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16',rooms:'M5 3h14v18H5z M9 3v18 M14 12h1',shops:'M3 9l2-6h14l2 6 M3 9v3h18V9 M5 12v9h14v-9 M9 21v-6h6v6',jobs:'M3 7h18v14H3z M8 7V3h8v4 M3 12h18 M10 12v3h4v-3',votes:'M5 4h14v17H5z M8 8l2 2 5-5 M8 14h8 M8 17h5',laws:'M4 4h7v16H4z M13 4h7v16h-7z M7 8h1 M16 8h1',parties:'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-3a6 6 0 0 1 12 0v3 M16 4a4 4 0 0 1 0 8 M17 15a5 5 0 0 1 5 5',courts:'M12 3v18 M5 21h14 M4 6h16 M5 6l-3 8h6z M19 6l-3 8h6z',register:'M5 3h14v18H5z M8 6h8v4H8z M8 14h2 M14 14h2 M8 17h2 M14 17h2',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',admin:'M12 3l8 3v6c0 5-8 9-8 9S4 17 4 12V6z M9 12l2 2 4-4',apps:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',lock:'M5 11h14v10H5z M8 11V7a4 4 0 0 1 8 0v4',search:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M15 15l6 6'};
  navs.push(["apps","Bereiche"],["admin","Administration"]);
  function icon(id){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(iconPaths[id]||iconPaths.apps)+'"/></svg>';}
  // Launch preview applies to ordinary members only; existing roles keep their permissions.
  var previewOpenPages=new Set(["home","apps","idcard","gallery","cardshop","settings"]);
  var previewTeaserPages=new Set(["wallet","pay","history","map","rooms","shops","lost",
    "workhours","myjob","applications","updates","bulletin","blog","events","jobs",
    "laws","parties","courts"]);
  function isPreviewMember(){
    return !!(state.user&&state.profile?.role==="member"&&!state.schoolRoles?.operator&&
      !state.schoolRoles?.can_check_attendance&&!(state.schoolRoles?.jobs?.length));
  }
  function roleAllowed(id){
    var administrator=state.profile&&state.profile.role==="admin";
    var operator=Boolean(state.schoolRoles?.operator);
    var pupilPages=["home","apps","idcard","gallery","cardshop","wallet","pay","history","map","rooms","shops","lost","settings","workhours","myjob","applications","updates"];
    // ViSA is paused for all roles, including admins. Keep the implementation for later reuse.
    if(id==="visa"||id==="guestvisa")return false;
    if(id==="votes"&&!administrator&&!operator)return false;
    if(id==="overlord"||id==="admincredit"||id==="admin")return administrator;
    if(id==="register")return adminOrCashier();
    if(id==="roles")return administrator||operator;
    if(id==="attendance")return administrator||operator||Boolean(state.schoolRoles?.can_check_attendance);
    if(id==="shopmanage")return administrator||operator||Boolean(state.schoolRoles?.jobs?.length);
    if(administrator||operator)return true;
    return pupilPages.includes(id);
  }
  // 26 November 2026 00:00 CET: proposed cutoff for the Nikolausmarkt poll preview.
  // The official school-state launch does not automatically unlock other modules.
  function previewVotingClosed(){return Date.now()>=Date.parse("2026-11-25T23:00:00Z");}
  function previewLocked(id){return isPreviewMember()&&(previewTeaserPages.has(id)&&!previewOpenPages.has(id));}
  function visible(id){return roleAllowed(id)||previewLocked(id);}
  function allowed(id){return roleAllowed(id)&&!previewLocked(id);}
  function label(id){return (navs.find(function(n){return n[0]===id;})||[id,id])[1];}
  function navButton(id,mobile){
    var locked=previewLocked(id);
    return '<button type="button" class="'+(mobile?'bottom-button':'nav-button')+
      (state.page===id?' active':'')+(locked?' sas-preview-locked':'')+
      '" data-nav="'+id+'"'+(state.page===id?' aria-current="page"':'')+
      (locked?' disabled aria-disabled="true" title="Noch nicht freigeschaltet"':'')+'>'+
      icon(id)+'<span>'+esc(mobile?({home:"Start",apps:"Bereiche",idcard:"Ausweis",votes:"Abstimmen",settings:"Profil"}[id]||label(id)):label(id))+
      '</span>'+(locked?'<span class="sas-preview-lock" aria-hidden="true">'+icon("lock")+'</span>':'')+'</button>';
  }
  function nav(isMobile){
    if(isMobile)return (isPreviewMember()?["home","apps","idcard","settings"]:["home","apps","pay","settings"]).map(function(id){return navButton(id,true);}).join("");
    return navButton("home")+groups.map(function(g){return '<div class="nav-group"><div class="nav-kicker">'+g[0]+'</div>'+g[1].filter(visible).map(function(id){return navButton(id);}).join("")+'</div>';}).join("");
  }
  function moduleGrid(){
    return groups.map(function(g){
      return '<section class="module-group" data-module-group><div class="section-heading"><h2>'+g[0]+'</h2></div><div class="module-grid">'+
        g[1].filter(visible).map(function(id){
          var locked=previewLocked(id);
          return '<button type="button" class="module-tile'+(locked?' sas-preview-locked':'')+
            '" data-nav="'+id+'" data-module-search="'+esc((label(id)+' '+descriptions[id]).toLowerCase())+'"'+
            (locked?' disabled aria-disabled="true" title="Wird später freigeschaltet"':'')+
            '><span class="module-icon">'+icon(id)+'</span><span class="module-copy"><strong>'+esc(label(id))+
            '</strong><span>'+esc(locked?'Noch nicht freigeschaltet':descriptions[id])+
            '</span></span><span class="module-arrow" aria-hidden="true">'+(locked?icon("lock"):'→')+'</span></button>';
        }).join("")+'</div></section>';
    }).join("");
  }
  function appDirectory(){return header("SCHULE ALS STAAT","Alle Bereiche",isPreviewMember()?(previewVotingClosed()?"Die Umfragen zum Nikolausmarkt sind beendet. Dein Ausweis bleibt verfügbar; weitere Funktionen sind noch gesperrt.":"Du kannst bereits abstimmen und deinen Schülerausweis nutzen. Alle anderen Funktionen sind als gesperrte Vorschau sichtbar."):"Alle verfügbaren Bereiche im Überblick.")+moduleGrid();}
  function searchDialog(){return '<dialog id="portal-search" aria-labelledby="portal-search-title"><div class="dialog-head"><h2 id="portal-search-title">Bereich öffnen</h2><button type="button" class="icon-btn" data-action="close-search" aria-label="Suche schließen">×</button></div><label class="search-field">'+icon("search")+'<input id="module-query" type="search" placeholder="Ausweis, Raum, Veranstaltung …" autocomplete="off" aria-label="Bereiche durchsuchen"></label><div class="dialog-results"><div class="sas-global-results" id="sas-global-results" role="status" hidden></div>'+moduleGrid()+'<p class="empty search-empty" hidden>Kein passender Bereich. Versuche einen anderen Suchbegriff.</p></div></dialog>';}
  function mount(content){
    var first=(state.profile&&state.profile.display_name||"S").slice(0,2).toUpperCase();
    root.innerHTML='<a class="skip-link" href="#main-content">Zum Inhalt</a><div class="app-shell"><aside class="sidebar"><a class="brand" href="#home" data-nav="home" aria-label="Schule als Staat – Übersicht"><div class="brand-mark">S/S</div><div><div class="brand-name">Schule als Staat</div><div class="brand-sub">Projektportal</div></div></a><nav class="nav-links" aria-label="Hauptnavigation">'+nav(false)+'</nav><div class="sidebar-foot"><button class="sidebar-profile" data-nav="settings"><span class="avatar">'+esc(first)+'</span><span><strong>'+esc(state.profile.display_name)+'</strong><small>'+roleLabel()+'</small></span></button><a class="project-social" href="https://www.instagram.com/schule.als.staat_rng/" target="_blank" rel="noopener noreferrer">Projekt auf Instagram ↗</a></div></aside><div class="main-area"><header class="topbar"><div class="topbar-left">Schule als Staat <span aria-hidden="true">/</span> <b>'+esc(label(state.page))+'</b></div><div class="topbar-right"><button class="search-trigger" data-action="open-search" aria-label="Räume, Shops, Termine und Bereiche durchsuchen">'+icon("search")+'<span>Alles suchen</span><kbd>⌘ K</kbd></button><button class="profile-trigger" data-nav="settings" aria-label="Profil öffnen"><span class="avatar">'+esc(first)+'</span></button></div></header><main class="content" id="main-content" tabindex="-1">'+content+'</main><footer class="page-footer">Schule als Staat <span>Projektwoche 2027</span></footer></div><nav class="bottom-nav" aria-label="Mobile Hauptnavigation">'+nav(true)+'</nav></div>'+searchDialog();
    if(state.page==="register")renderQRCode();
  }
  function setup(){
    root.innerHTML='<div class="welcome"><section class="welcome-side" style="margin:auto;max-width:600px"><div class="login-box">'+
      header("VERBINDUNG","Portal vorübergehend nicht erreichbar","Die Anmeldung kann derzeit keine Verbindung zum Dienst herstellen. Bitte versuche es erneut oder informiere die Projektverwaltung.")+
      '<a class="btn primary full" href="/">Erneut versuchen</a></div></section></div>';
  }
  function login(){
    root.innerHTML='<div class="welcome"><section class="welcome-left"><div class="brand" style="padding:0"><div class="brand-mark">S/S</div><div><div class="brand-name" >Schule als Staat</div><div class="brand-sub" >RNG Wangen</div></div></div><div><div class="eyebrow" >PROJEKTWOCHE 2027</div><div class="welcome-hero">Das Schulportal.</div><p class="welcome-sub">Schülerausweis, Abstimmungen und organisatorische Informationen zur Projektwoche.</p></div><div class="small" >12.–16. Juli 2027 · RNG Wangen</div><a href="https://www.instagram.com/schule.als.staat_rng/" class="project-social" target="_blank" rel="noopener noreferrer" aria-label="Schule als Staat auf Instagram öffnen">Instagram · @schule.als.staat_rng ↗</a></section><section class="welcome-side"><div class="login-box">'+header("ZUGANG","Anmelden","")+'<form id="password-login-form"><div class="form-group"><label for="account-email">Bürgerkennung oder Verwaltungs-E-Mail</label><input class="field" type="text" autocomplete="username" name="email" id="account-email" placeholder="SAS-XXXXXXXXXX" maxlength="160" required></div><div class="form-group"><label for="account-password">Passwort</label><span class="sas-password-input"><input class="field" type="password" autocomplete="current-password" name="password" id="account-password" minlength="6" required><button type="button" class="sas-password-toggle" data-password-toggle="account-password" aria-controls="account-password" aria-label="Passwort anzeigen" title="Passwort anzeigen" aria-pressed="false"><svg class="sas-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="sas-eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18M10.58 5.15A11.8 11.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.03 3.8M6.7 6.7C3.6 8.6 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.37-.9"/><path d="M10 10a3 3 0 0 0 4 4"/></svg></button></span></div><button type="submit" class="btn primary full">Mit Passwort anmelden</button></form><p class="field-help">Ein Schülerkonto wird ausschließlich anhand der offiziellen Schulliste ausgegeben. Deine Bürgerkennung und dein Startpasswort erhältst du persönlich. Beim ersten Login musst du das Startpasswort ändern.</p><details class="alternate-auth"><summary>Passwort vergessen? (Verwaltung)</summary><p class="field-help">Für Bürgerkennungen ohne echte E-Mail-Adresse erfolgt die Rücksetzung nur über die Schulverwaltung. Nur vorhandene Verwaltungskonten mit echter E-Mail können hier einen Rücksetzlink anfordern.</p><form id="password-reset-request-form"><div class="form-group"><label for="password-reset-email">E-Mail-Adresse</label><input class="field" type="email" autocomplete="email" name="email" id="password-reset-email" placeholder="name@schule.de" required></div><button type="submit" class="btn dark full">Passwort-Link anfordern</button></form></details><p class="login-footer">Nur für gelistete Bürger und berechtigte Verwaltung. Gib deine Zugangsdaten niemals weiter. Schulwährung kann gegen Euro erworben werden; Guthaben hat damit einen realen finanziellen Bezug.</p></div></section></div>';
  }
  function legalReceiptFields(){
    return '<fieldset class="sas-legal-fieldset" aria-describedby="school-legal-help"><legend>Pflichtbestätigungen vor der Nutzung</legend>'+
      '<label class="sas-legal-check"><input type="checkbox" name="notice_read" required> <span>Ich habe die <a href="/datenschutz.html" target="_blank" rel="noopener noreferrer">Datenschutzhinweise (Version 03.11.2026)</a> gelesen und zur Kenntnis genommen.</span></label>'+
      '<label class="sas-legal-check"><input type="checkbox" name="rules_accepted" required> <span>Ich habe die <a href="/nutzungsregeln.html" target="_blank" rel="noopener noreferrer">Nutzungsregeln (Version 03.11.2026)</a> gelesen und akzeptiere sie.</span></label>'+
      '<p class="field-help" id="school-legal-help">Die Bestätigungen werden mit Konto-ID, Dokumentversionen und Zeitpunkt gespeichert. Das ist keine pauschale Einwilligung in Datenverarbeitung. Freiwillige Datenverarbeitungen werden gesondert geregelt.</p></fieldset>';
  }
  function schoolLegalView(){
    root.innerHTML='<div class="welcome"><section class="welcome-side" style="margin:auto;max-width:650px"><div class="login-box">'+
      header("WICHTIGE HINWEISE","Datenschutz & Nutzungsregeln.","Bitte lies beide Dokumente. Danach kannst du die Schule-als-Staat-Webseite wie gewohnt verwenden.")+
      '<form id="school-legal-form">'+legalReceiptFields()+
      '<button class="btn primary full" type="submit">Bestätigen und fortfahren</button></form>'+
      '<p class="field-help">Du kannst die Dokumente öffnen, ohne die Anmeldung zu verlassen.</p>'+
      '<button type="button" class="btn full" data-action="open-deletion">Datenlöschung beantragen</button><button type="button" class="btn full" data-action="logout">Abmelden</button></div></section></div>';
  }

  function deletionConsequences(){
    return '<div class="sas-deletion-summary" aria-label="Die wichtigsten Folgen der Löschung">'+
      '<h2>Das Wichtigste auf einen Blick</h2>'+
      '<ul><li><strong>Dein Zugang:</strong> Das Bürgerkonto wird nach Prüfung gelöscht; du kannst dich anschließend nicht mehr damit anmelden.</li>'+
      '<li><strong>Abstimmungen:</strong> Schon mit Eingang deines Antrags kannst du keine weitere Stimme abgeben.</li>'+
      '<li><strong>Projektguthaben:</strong> Der Zugriff auf dein Projektguthaben endet mit der Kontolöschung. Da Schulwährung auch gegen Euro erworben werden kann, muss vorher geklärt werden, ob noch Erstattungs- oder Rücktauschansprüche bestehen. Ein Löschantrag lässt solche Ansprüche nicht automatisch entfallen.</li>'+
      '<li><strong>Weitere Funktionen:</strong> Schülerausweis, QR-Codes, Beruf, Räume, Shops und andere persönliche Projektfunktionen stehen nach der Kontolöschung nicht mehr zur Verfügung.</li>'+
      '<li><strong>Nicht sofort:</strong> Der Klick stellt zuerst einen Antrag. Die Löschung erfolgt nach Prüfung; gesetzlich aufzubewahrende Informationen können ausgenommen sein.</li></ul></div>'+
      '<h3 id="deletion-detail-title">Was genau bedeutet das?</h3>'+
      '<p class="field-help">Die folgenden Erläuterungen kannst du durchscrollen. Danach kannst du den Antrag im zweiten Schritt abschicken.</p>'+
      '<div class="sas-deletion-explanation" id="data-deletion-explanation" tabindex="0" role="region" aria-labelledby="deletion-detail-title">'+
        '<h4>1. Bürgerkonto und Anmeldung</h4><p>Dein Bürgerkonto verknüpft deine persönliche Kennung mit den schulischen Berechtigungen. Sobald die zuständige Stelle deinen Antrag geprüft und die Löschung abgeschlossen hat, kannst du diese Kennung nicht mehr für die Anmeldung verwenden. Ein neues Konto wird nicht automatisch angelegt. Dein Passwort wird nicht an andere Nutzer übertragen. Die Schule muss prüfen, ob einzelne für die Projektorganisation notwendige Nachweise vorübergehend aufbewahrt werden müssen.</p>'+
        '<h4>2. Schülerausweis und QR-Code</h4><p>Dein digitaler Schülerausweis zeigt deinen Namen, deine Klasse und gegebenenfalls ein von dir gewähltes Kartendesign. Der QR-Code ist an das Konto gebunden. Nach einer vollständigen Kontolöschung ist der Ausweis nicht mehr nutzbar. Vorher bereits ausgedruckte oder auf anderen Geräten gespeicherte Kopien werden nicht allein durch einen Datenbankvorgang physisch vernichtet.</p>'+
        '<h4>3. Abstimmungen und Entscheidungen</h4><p>Schon wenn du den Antrag einreichst, wird deine weitere Teilnahme an Abstimmungen gesperrt. Bereits abgegebene Stimmen oder vorhandene Gesamtresultate werden nicht sofort gelöscht oder verändert, weil sonst die Integrität einer laufenden Abstimmung beeinträchtigt werden könnte. Wie persönliche Zuordnungen rechtmäßig gelöscht oder anonymisiert werden, muss bei der Bearbeitung geklärt werden. Derzeit sind abgegebene Stimmen technisch noch nicht vollständig anonym.</p>'+
        '<h4>4. Guthaben und Buchungen</h4><p>Die Schulwährung ist eine projektinterne Kontoeinheit, die gegen echte Euro erworben werden kann. Damit kann das Guthaben einen realen finanziellen Einsatz repräsentieren, auch wenn es kein Euro-Bankguthaben ist. Nach einer abgeschlossenen Kontolöschung kann das Guthaben im Portal nicht mehr verwendet werden. Vor der Löschung müssen mögliche Erstattungs-, Rücktausch- und sonstige Ansprüche nach den geltenden Bedingungen und gesetzlichen Vorgaben geprüft werden; der Löschantrag ist kein Verzicht darauf. Einzelne Buchungsnachweise können für die Prüfung und die Erfüllung von Aufbewahrungspflichten vorübergehend erforderlich bleiben.</p>'+
        '<h4>5. Rollen, Arbeitszeiten, Buchungen und weitere Daten</h4><p>Persönliche Projektrollen, Berufe, Arbeitszeiten, Raumreservierungen, Shopvorgänge und sonstige kontoabhängige Funktionen können bei der Löschung wegfallen. Bereits veröffentlichte Beiträge oder Dateien müssen einzeln geprüft werden. Für fremde Inhalte und gesetzlich erforderliche Schulnachweise gelten möglicherweise andere Regeln. Die Nutzung des Portals für dich wird bei abgeschlossenem Löschvorgang beendet.</p>'+
        '<h4>6. Was passiert mit verschlüsselten Namen?</h4><p>Die offiziellen Schülernamen sind in einem geschützten Datenbankbereich verschlüsselt gespeichert. Auch dieser Eintrag gehört zu den personenbezogenen Projektdaten, die beim Abschluss des Löschverfahrens zu prüfen sind. Eine Verschlüsselung allein bedeutet nicht, dass die Daten bereits anonym sind. Veraltete Sicherungskopien können vorübergehend noch Daten enthalten; ihre gesonderten Speicherfristen werden im Löschkonzept behandelt.</p>'+
        '<h4>7. Wie läuft die Anfrage ab?</h4><p>Im nächsten Schritt kannst du einen Grund auswählen oder ausdrücklich „Will ich nicht angeben“ anklicken. Du musst keinen sachlichen Grund für die Antragstellung nennen. Mit dem Absenden wird deine Anfrage in der geschützten Verwaltungsübersicht registriert und dein Stimmrecht unmittelbar gesperrt. Die zuständige Stelle prüft, welche Daten zu löschen sind und welche ausnahmsweise noch gespeichert bleiben müssen.</p>'+
        '<h4>8. Deine Rechte bleiben bestehen</h4><p>Du darfst jederzeit Auskunft, Berichtigung oder Löschung nach Maßgabe der DSGVO verlangen. Durch einen Antrag verzichtest du nicht auf weitere Rechte. Diese Webseite darf dir die Löschung nicht ohne rechtlichen Grund verweigern. Weitere Informationen findest du in den Datenschutzhinweisen. Die datenschutzrechtlich verantwortliche Stelle für diese Projektwebseite wird derzeit noch verbindlich geklärt.</p>'+
      '</div>'+
      '<p class="field-help" id="data-deletion-progress" role="status" aria-live="polite">Bitte bis zum Ende der Erläuterungen scrollen. Anschließend wird der nächste Schritt freigeschaltet.</p>';
  }
  function dataDeletionReasonsForm(){
    return '<form id="data-deletion-request-form">'+
      '<h2>Warum möchtest du die Löschung beantragen?</h2>'+
      '<p class="field-help">Wähle eine Antwort aus. Eine Begründung ist nicht erforderlich: Die letzte Auswahl ermöglicht einen Antrag ohne Angabe eines Grundes.</p>'+
      '<fieldset class="sas-deletion-reasons"><legend>Deine Auswahl</legend>'+
      '<label><input type="radio" name="reason" value="datenschutz" required> Ich mache mir Sorgen um den Datenschutz.</label>'+
      '<label><input type="radio" name="reason" value="nicht_mehr_nutzen"> Ich möchte das Schulportal nicht mehr verwenden.</label>'+
      '<label><input type="radio" name="reason" value="sonstiges"> Ich habe einen anderen Grund.</label>'+
      '<label><input type="radio" name="reason" value="keine_angabe"> Will ich nicht angeben.</label>'+
      '</fieldset>'+
      '<p class="field-help">Nach dem Absenden wird dein Antrag zur Prüfung gespeichert und deine weitere Abstimmungsteilnahme gesperrt. Das Löschen des Kontos und des Guthabens erfolgt nicht sofort.</p>'+
      '<button class="btn dark full" type="submit">Löschantrag verbindlich absenden</button></form>';
  }
  function dataDeletionRequestView(){
    var secondStep=state.deletionStage===2;
    root.innerHTML='<div class="welcome"><section class="welcome-side" style="margin:auto;max-width:680px"><div class="login-box">'+
      header("DATENSCHUTZ",secondStep?"Schritt 2: Löschantrag.":"Schritt 1: Folgen verstehen.",secondStep?
        "Du kannst deinen Antrag ohne Begründung stellen.":"Hier erfährst du, welche Funktionen nach einer Löschung entfallen und was bereits bei Antragstellung passiert.")+
      (secondStep?
         dataDeletionReasonsForm()+'<button class="btn full" type="button" data-action="deletion-back">Zurück zu den Folgen</button>':
         deletionConsequences()+
         '<button class="btn primary full" type="button" data-action="deletion-proceed" disabled>Ich bin mir zu 100 % sicher und möchte die Löschung beantragen</button>')+
      '<p class="field-help">Fragen zu deinen Rechten: <a href="/datenschutz.html#rechte" target="_blank" rel="noopener noreferrer">Datenschutzhinweise</a>. Die Verantwortlichkeit wird derzeit geprüft.</p>'+
      '<button class="btn full" type="button" data-action="close-deletion">Abbrechen und zurück</button></div></section></div>';
    if(!secondStep){
      var area=root.querySelector("#data-deletion-explanation");
      var proceed=root.querySelector('[data-action="deletion-proceed"]');
      var status=root.querySelector("#data-deletion-progress");
      if(area&&proceed){
        function updateProgress(){
          var reachedEnd=area.scrollTop+area.clientHeight>=area.scrollHeight-12;
          if(reachedEnd)state.deletionReadToEnd=true;
          proceed.disabled=!state.deletionReadToEnd;
          if(status&&state.deletionReadToEnd)status.textContent="Ende der Erläuterungen erreicht. Du kannst jetzt zum Antrag weitergehen.";
        }
        area.addEventListener("scroll",updateProgress,{passive:true});
        updateProgress();
      }
    }
  }
  function dataDeletionPendingView(){
    root.innerHTML='<div class="welcome"><section class="welcome-side" style="margin:auto;max-width:630px"><div class="login-box">'+
      header("DATENSCHUTZ","Dein Löschantrag ist eingegangen.","Die zuständige Stelle prüft und bearbeitet ihn.")+
      '<p>Deine Abstimmungsteilnahme ist ab sofort gesperrt. Guthaben und personenbezogene Daten werden nach Prüfung und entsprechend den geltenden Fristen behandelt, nicht sofort bei Antragstellung gelöscht.</p>'+
      '<p><a href="/datenschutz.html" target="_blank" rel="noopener noreferrer">Deine Rechte und Kontakt</a></p>'+
      '<button class="btn full" data-action="logout">Abmelden</button></div></section></div>';
  }

  function rosterFirstLoginView(){
    root.innerHTML='<div class="welcome"><section class="welcome-side" style="margin:auto"><div class="login-box">'+
      header("ERSTE ANMELDUNG","Startpasswort ändern.","Ändere bei deiner ersten Anmeldung das zugeteilte Startpasswort.")+
      '<form id="roster-first-password-form"><div class="form-group"><label for="roster-password">Neues Passwort (mindestens 12 Zeichen)</label><span class="sas-password-input"><input class="field" type="password" autocomplete="new-password" id="roster-password" name="password" minlength="12" required><button type="button" class="sas-password-toggle" data-password-toggle="roster-password" aria-controls="roster-password" aria-label="Passwort anzeigen" title="Passwort anzeigen" aria-pressed="false"><svg class="sas-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="sas-eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18M10.58 5.15A11.8 11.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.03 3.8M6.7 6.7C3.6 8.6 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.37-.9"/><path d="M10 10a3 3 0 0 0 4 4"/></svg></button></span></div>'+
      '<div class="form-group"><label for="roster-password-repeat">Passwort wiederholen</label><span class="sas-password-input"><input class="field" type="password" autocomplete="new-password" id="roster-password-repeat" name="repeat" minlength="12" required><button type="button" class="sas-password-toggle" data-password-toggle="roster-password-repeat" aria-controls="roster-password-repeat" aria-label="Passwort anzeigen" title="Passwort anzeigen" aria-pressed="false"><svg class="sas-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="sas-eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18M10.58 5.15A11.8 11.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.03 3.8M6.7 6.7C3.6 8.6 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.37-.9"/><path d="M10 10a3 3 0 0 0 4 4"/></svg></button></span></div>'+
      legalReceiptFields()+'<button class="btn primary full" type="submit">Neues Passwort festlegen</button></form><p class="field-help">Verwende ein einzigartiges Passwort, das du nicht für andere Dienste nutzt.</p><button class="btn full" type="button" data-action="open-deletion">Datenlöschung beantragen</button></div></section></div>';
  }
  function empty(label){return '<div class="empty">'+label+'</div>';}
  function ledgerRow(x){
    var plus=x.kind==="credit"||x.payee_id===state.user.id;
    var label=x.kind==="credit"?"Guthaben ausgegeben":plus?"Zahlung erhalten":"Digital bezahlt";
    return '<div class="list-item"><div class="circle-icon">'+(plus?"+":"−")+'</div><div class="item-main"><div class="item-title">'+label+'</div><div class="item-meta">'+time(x.created_at)+(x.note?" · "+esc(x.note):"")+'</div></div><div class="item-amount '+(plus?"pos":"neg")+'">'+(plus?"+":"−")+cashFmt(x.amount_cents)+'</div></div>';
  }
  function latest(max){
    var l=state.ledger.slice(0,max||60);
    return l.length?'<div class="list">'+l.map(ledgerRow).join("")+'</div>':empty("Noch keine digitalen Buchungen.");
  }
  function dashboard(){
    if(isPreviewMember()){
      var pollsEnded=previewVotingClosed();
      var active=pollsEnded?0:(state.polls||[]).filter(function(p){return p.status==="open"&&!p.has_voted;}).length;
      return '<div class="dashboard-intro">'+header("VORSCHAU","Dein Zugang ist eingerichtet","Dein Schülerausweis ist verfügbar. Weitere Bereiche sind bis zur Freigabe gesperrt.")+'</div>'+
        '<div class="overview-grid sas-preview-cards">'+
        '<section class="card overview-card"><div class="card-header"><span class="module-icon">'+icon("idcard")+'</span><span class="pill blue">Freigeschaltet</span></div><h2>Dein Schülerausweis</h2><p class="details">Öffne deine persönliche Projektkarte.</p><button class="btn" data-nav="idcard">Ausweis öffnen</button></section></div>'+
        '<div class="section-heading"><div><h2>Weitere Bereiche</h2><p>Diese Bereiche sind derzeit noch gesperrt.</p></div></div>'+moduleGrid();
    }
    var dateLabel=new Intl.DateTimeFormat("de-DE",{weekday:"long",day:"numeric",month:"long"}).format(new Date());
    return '<div class="dashboard-intro"><div>'+header(dateLabel,"Guten Tag, "+esc(state.profile.display_name)+".","Ausweis, Guthaben und aktuelle Vorgänge.")+'</div></div>'+
      '<div class="overview-grid"><section class="card overview-card"><div class="card-header"><span class="module-icon">'+icon("idcard")+'</span><span class="pill">Persönlich</span></div><h2>Dein Schülerausweis</h2><p class="details">Ausweisdaten und ausgewähltes Kartendesign.</p><button class="btn" data-nav="idcard">Ausweis öffnen <span aria-hidden="true">→</span></button></section><section class="card overview-card balance-card"><div class="card-header"><span class="module-icon">'+icon("wallet")+'</span><span class="pill">Schulwährung</span></div><div class="stat-label">Dein Guthaben</div><div class="stat-value">'+cashFmt(state.wallet.balance_cents)+'</div><p class="stat-caption">Schulwährung · mit Euro erwerbbar</p><button class="btn primary" data-nav="pay">'+icon("pay")+' Bezahlen</button></section></div>'+
      '<section id="sas-personal-hub" aria-label="Persönliche Schnellzugriffe"><p class="sas-hub-note">Schnellzugriffe laden …</p></section><div class="section-heading"><div><h2>Weitere Bereiche</h2><p>Funktionen und Informationen zur Projektwoche.</p></div><button class="btn subtle" data-nav="apps">Alle Bereiche →</button></div><div class="home-modules">'+["bulletin","events","map","rooms","lost","blog"].map(function(id){return '<button class="module-tile" data-nav="'+id+'"><span class="module-icon">'+icon(id)+'</span><span class="module-copy"><strong>'+esc(label(id))+'</strong><span>'+esc(descriptions[id])+'</span></span><span class="module-arrow" aria-hidden="true">→</span></button>';}).join("")+'</div><div class="section-heading"><h2>Letzte Kontobewegungen</h2><button class="btn subtle" data-nav="wallet">Zum Konto →</button></div><section class="card">'+latest(4)+'</section>';
  }
  function wallet(){
    return header("DEIN KONTO","Mein Guthaben","Kontostand und Buchungsverlauf.")+'<div class="grid two"><section class="card ink"><div class="stat-label">Verfügbares Guthaben</div><div class="stat-value">'+cashFmt(state.wallet.balance_cents)+'</div><div class="stat-caption">Schulwährung · mit Euro erwerbbar</div></section><section class="card"><h2>Digital bezahlen</h2><p class="details" style="margin:17px 0">Du scannst den QR-Code einer Kasse, kontrollierst den Betrag und bestätigst selbst. Schulwährung kann mit echten Euro gekauft werden; eine digitale Abbuchung kann deshalb einen finanziellen Einsatz betreffen. Bargeld wird getrennt verbucht.</p>'+btn("Zum QR-Scanner","to-pay")+'</section></div><h2 class="section-title">Kontobewegungen</h2><section class="card">'+latest()+'</section>';
  }
  function invoiceCard(){
    var r=state.invoice;if(!r)return "";
    return '<section class="card" style="margin-top:20px"><div class="card-header"><h2>Zahlung prüfen</h2><span class="pill blue">Freigabe erforderlich</span></div><div class="confirm-line"><span>Empfänger</span><b>'+esc("Schulkasse")+'</b></div><div class="confirm-line"><span>Beschreibung</span><b>'+esc(r.note||"Kassenzahlung")+'</b></div><div class="divider"></div><p class="small muted">Betrag</p><div class="fancy-number">'+cashFmt(r.amount_cents)+'</div><p class="details" style="margin-top:14px">Dieser Betrag wird von deinem digitalen Guthaben abgebucht. Die Schulwährung kann mit echten Euro erworben worden sein. Prüfe Betrag und Empfänger.</p><div class="button-row">'+btn("Zahlung verbindlich bestätigen","confirm")+' '+btn("Abbrechen","cancel","")+'</div></section>';
  }
  function pay(){
    return header("QR-ZAHLUNG","Digital bezahlen","Scanne den QR-Code einer Kasse. Du bestätigst den Betrag immer selbst.")+
      '<div class="grid two"><section class="card"><div class="card-header"><h2>QR-Code scannen</h2><span class="pill">Kamera</span></div><div class="reader" id="qr-reader">'+empty("Die Kamera startet erst nach deiner Freigabe.")+'</div><div class="scan-actions">'+btn("Kamera starten","scan-start")+' '+btn("Stoppen","scan-stop","")+' <label class="btn" for="scan-file">QR-Bild wählen</label><input id="scan-file" type="file" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0"></div><p class="field-help">HTTPS erforderlich. Bei gesperrter Kamera kannst du den Link oder ein QR-Bild verwenden.</p></section><section class="card"><div class="card-header"><h2>Ohne Kamera</h2><span class="pill">Alternative</span></div><form id="manual-form"><div class="form-group"><label for="code">Link oder QR-Code</label><input class="field" id="code" name="code" required placeholder="Zahlungslink oder NV-PAY:…"><p class="field-help">Zahlungslinks lassen sich direkt auf dem Smartphone öffnen.</p></div><button type="submit" class="btn dark full">Zahlung öffnen</button></form>'+info("Keine Videos werden gespeichert. Die Kamera wird beim Verlassen der Ansicht beendet.")+'</section></div>'+invoiceCard();
  }
  function activeCard(){
    if(!state.active)return "";
    var r=state.active,paid=r.status==="paid";
    var link=paymentURL(r.id);
    return '<section class="card" style="margin-top:20px"><div class="card-header"><h2>Aktuelle Zahlungsanforderung</h2><span class="pill '+(paid?"green":"blue")+'">'+(paid?"Bezahlt":"Offen")+'</span></div><div class="grid two"><div class="code-panel"><div id="qr-output"></div><div class="code-ref">'+esc(link)+'</div></div><div><p class="small muted">Angeforderter Betrag</p><div class="fancy-number">'+cashFmt(r.amount_cents)+'</div><p class="details" style="margin-top:14px">Zweck: '+esc(r.note||"Kassenzahlung")+'<br>Gültig bis '+time(r.expires_at)+'</p>'+info(paid?"Betrag digital gutgeschrieben.":"Kunde scannt und bestätigt auf seinem eigenen Gerät.")+'<div class="button-row">'+btn("Link kopieren","copy","") +'</div></div></div></section>';
  }
  function register(){
    return header("KASSENPLATZ","Zahlungen annehmen","Digitale und Bargeldumsätze sind vollständig getrennt.")+
      '<div class="grid two"><section class="card"><div class="card-header"><h2>Digitale QR-Zahlung</h2><span class="pill blue">Kundenfreigabe</span></div><form id="request-form"><div class="form-group"><label for="req-amount">Betrag in '+esc(units)+'</label><input class="field" name="amount" id="req-amount" type="number" inputmode="decimal" min=".01" max="10000" step=".01" required placeholder="0,00"></div><div class="form-group"><label for="req-note">Beschreibung</label><input class="field" name="note" id="req-note" maxlength="140" placeholder="z. B. Mittagessen"></div><button type="submit" class="btn primary full">Zahlungs-QR erstellen</button></form><p class="field-help">Zahlung erst nach Bestätigung durch den Kunden.</p></section><section class="card"><div class="card-header"><h2>Bargeld erfassen</h2><span class="pill">Separat</span></div><form id="cash-form"><div class="form-group"><label for="cash-amount">Erhaltener Bargeldbetrag in '+esc(units)+'</label><input class="field" name="amount" id="cash-amount" type="number" inputmode="decimal" min=".01" max="10000" step=".01" required placeholder="0,00"></div><div class="form-group"><label for="cash-note">Beschreibung</label><input class="field" name="note" id="cash-note" maxlength="140" placeholder="z. B. Getränk"></div><button type="submit" class="btn dark full">Bargeldumsatz buchen</button></form><p class="field-help">Digitaler Kontostand bleibt unverändert. Kassenbestand physisch abstimmen.</p></section></div>'+activeCard();
  }
  function renderQRCode(){
    var node=document.getElementById("qr-output");
    if(!node||!state.active)return;
    node.replaceChildren();
    if(window.QRCode){
      try{new window.QRCode(node,{text:paymentURL(state.active.id),width:196,height:196,colorDark:"#223751",colorLight:"#ffffff"});}
      catch(e){node.textContent="QR-Code nicht verfügbar; Link verwenden.";}
    }else node.textContent="QR-Bibliothek nicht geladen; Link verwenden.";
  }
  function historyPage(){
    var ledger=latest();
    var cashRows=state.cash.map(function(r){return '<tr><td>'+time(r.created_at)+'</td><td>'+esc(r.note||"Bargeld")+'</td><td>'+cashFmt(r.amount_cents)+'</td></tr>';}).join("");
    var reqRows=state.requests.map(function(r){return '<div class="list-item"><div class="item-main"><div class="item-title">'+cashFmt(r.amount_cents)+' · '+esc(r.note||"Kassenzahlung")+'</div><div class="item-meta">'+time(r.created_at)+'</div></div><span class="pill '+(r.status==="paid"?"green":"")+'">'+(r.status==="paid"?"Bezahlt":new Date(r.expires_at)<new Date()?"Abgelaufen":"Offen")+'</span></div>';}).join("");
    return header("BUCHUNGEN","Verlauf","Digitale Transaktionen und Bargeldumsätze sind separat dokumentiert.")+
      '<section class="card"><div class="card-header"><h2>Digitales Konto</h2></div>'+ledger+'</section>'+
      (adminOrCashier()?'<h2 class="section-title">Bargeldumsätze</h2><section class="card">'+(cashRows?'<div class="table-wrap"><table class="simple-table"><thead><tr><th>Zeit</th><th>Beschreibung</th><th>Betrag</th></tr></thead><tbody>'+cashRows+'</tbody></table></div>':empty("Keine Bargeldumsätze."))+'</section><h2 class="section-title">QR-Anforderungen</h2><section class="card">'+(reqRows?'<div class="list">'+reqRows+'</div>':empty("Keine QR-Anforderungen."))+'</section>':"");
  }
  function votesPage(){
    var polls=state.polls||[];
    var enabled=Boolean(state.profile.vote_eligible);
    var admin=state.profile.role==="admin"||Boolean(state.schoolRoles?.operator);
    var notice=enabled?"":info("Dein Konto ist derzeit nicht stimmberechtigt. Wende dich bei Fragen an die Projektverwaltung.",true);
    var blocks=polls.map(function(p){
      var open=p.status==="open", voted=p.has_voted;
      var options=(p.options||[]).map(function(o,i){
        return '<label class="poll-option"><input type="radio" name="choice" value="'+esc(o.id)+'" '+(open&&!voted&&enabled?"required":"disabled")+'><span class="poll-option-text">'+esc(o.label)+'</span></label>';
      }).join("");
      var controls=!open?'<span class="pill">Abgeschlossen</span>':
        voted?'<span class="pill green">Stimme bereits abgegeben</span>':
        !enabled?'<span class="pill">Freigabe erforderlich</span>':
        '<button type="submit" class="btn primary">Stimme abgeben</button>';
      var form='<form id="vote-form" data-poll-id="'+esc(p.id)+'"><fieldset class="poll-fieldset" '+(open&&!voted&&enabled?'':'disabled')+'><legend class="sr-only">Wähle eine Option</legend>'+options+'</fieldset><div class="poll-footer">'+controls+'</div></form>';
      return '<section class="card poll-card"><div class="card-header"><h2>'+esc(p.title)+'</h2><span class="pill '+(open?"blue":"")+'">'+(open?"Läuft":"Beendet")+'</span></div>'+(p.description?'<p class="details">'+esc(p.description)+'</p>':"")+form+'</section>';
    }).join("");
    var adminResults="";
    if(admin){
      var cards=(state.pollResults||[]).map(function(p){
        var total=Number(p.total||0);
        var data=(p.options||[]).map(function(o){
          var c=Number(o.count||0),pct=total?Math.round(100*c/total):0;
          return '<div class="result-row"><div class="result-heading"><span>'+esc(o.label)+'</span><strong>'+c+' · '+pct+' %</strong></div><div class="result-track"><div class="result-bar" style="width:'+pct+'%"></div></div></div>';
        }).join("");
        return '<section class="card"><div class="card-header"><h2>'+esc(p.title)+'</h2><span class="pill '+(p.status==="open"?"blue":"")+'">'+(p.status==="open"?"Offen":"Beendet")+'</span></div><p class="details">'+total+' abgegebene Stimme'+(total===1?"":"n")+'</p>'+data+'<div class="poll-footer">'+(p.status==="open"?'<button type="button" class="btn" data-action="close-poll" data-poll-id="'+esc(p.id)+'">Abstimmung schließen</button>':"")+'</div></section>';
      }).join("");
      adminResults='<h2 class="section-title">Auswertung · Verwaltung</h2><p class="details">Aggregierte Stimmen auf Abruf. Bitte „Aktualisieren“ verwenden; einzelne Stimmzettel werden nicht angezeigt.</p><div class="grid two">'+(cards||empty("Noch keine Abstimmungen vorhanden."))+'</div>'+
        '<h2 class="section-title">Neue Abstimmung erstellen</h2><section class="card"><form id="poll-create"><div class="form-group"><label for="poll-title">Frage oder Abstimmungstitel</label><input class="field" id="poll-title" name="title" maxlength="160" required placeholder="Wie soll unser Schulstaat heißen?"></div><div class="form-group"><label for="poll-description">Beschreibung (optional)</label><input class="field" id="poll-description" name="description" maxlength="500" placeholder="Weitere Informationen zur Abstimmung"></div><div class="form-group"><label for="poll-options">Antwortmöglichkeiten · eine pro Zeile (2–10)</label><textarea class="field poll-textarea" id="poll-options" name="options" rows="5" required placeholder="Vorschlag A&#10;Vorschlag B&#10;Vorschlag C"></textarea><p class="field-help">Die Antwortmöglichkeiten stehen nach Veröffentlichung fest. Bitte vorab prüfen.</p></div><button type="submit" class="btn primary">Abstimmung veröffentlichen</button></form></section>';
    }
    return header("MITBESTIMMUNG","Abstimmungen","Hier findest du aktuelle Abstimmungen. Über Staatsname und Flagge wird gesondert entschieden.")+
      notice+'<h2 class="section-title">Geplante Abstimmungen</h2><div class="grid two"><section class="card poll-card"><div class="card-header"><h2>Staatsname</h2><span class="pill">Vorbereitung</span></div><p class="details">Hier stimmen wir über die eingereichten Namensvorschläge ab. Die Kandidaten werden noch ergänzt.</p><p class="field-help">Noch keine Abstimmung möglich.</p></section><section class="card poll-card"><div class="card-header"><h2>Staatsflagge</h2><span class="pill">Vorbereitung</span></div><p class="details">Hier siehst du alle anonymen Flaggenentwürfe.</p><div id="sas-flag-voting-slot"><p class="details">Die Flaggenentwürfe werden geladen …</p></div></section></div><h2 class="section-title">Weitere Abstimmungen</h2><div class="grid two">'+(blocks||'<section class="card">'+empty("Noch keine weiteren Abstimmungen veröffentlicht.")+'</section>')+'</div>'+adminResults;
  }
  function overlordPage(){
    return header("SYSTEM","Overlord.","Geschützter Systemstatus und API-Gateway. Keine personenbezogenen Daten.")+
      '<section class="card"><h2>Gateway-Status</h2><p id="sas-overlord-result" class="details" role="status">Systemstatus wird geprüft …</p>'+
      '<p class="details">Die Diagnose wird beim Öffnen dieser Seite geladen.</p></section>'+
      '<section class="card"><h2>Reichweite der Kennzahlen</h2><p class="details">Die Zahlen gelten nur pro Cloudflare-Worker-Instanz. Es gibt keine globalen Zähler oder ein globales Rate-Limit. Direkte Supabase-API-Anfragen werden hier nicht erfasst. Die Daten werden nicht persistent gespeichert.</p></section>';
  }
  async function overlordRefresh(){
    if(!state.user||state.profile?.role!=="admin")return;
    var target=document.getElementById("sas-overlord-result");
    if(!target)return;
    try{
      var session=await api.auth.getSession();
      var jwt=session.data?.session?.access_token;
      if(!jwt)throw Error("Keine gültige Sitzung");
      var response=await fetch("/api/v1/overlord/metrics",{headers:{authorization:"Bearer "+jwt},cache:"no-store"});
      if(!response.ok)throw Error("Status nicht verfügbar (HTTP "+response.status+")");
      var data=await response.json();
      if(state.page!=="overlord"||target!==document.getElementById("sas-overlord-result"))return;
      var counters=data.counters||{};
      target.textContent="Instanz-Laufzeit: "+(data.uptimeSeconds||0)+" s · "+
        "Zugriffe: "+(counters.requests||0)+" · Weitergeleitet: "+(counters.forwarded||0)+
        " · Abgewiesen: "+(counters.rejected||0)+" · Gedrosselt: "+(counters.throttled||0)+
        " · Fehler: "+(counters.errors||0)+" · Gleichzeitig: "+(data.active||0);
    }catch(e){target.textContent="Diagnose nicht verfügbar: "+(e?.message||"Unbekannter Fehler");}
  }
  function settingsPage(){
    var account=accountDisplay(state.user.email);
    var memberOptions=(state.users||[]).map(function(u){return '<option value="'+esc(u.id)+'">'+esc(u.login_id||"Verwaltung")+' ('+esc(u.role)+')</option>';}).join("");
    var adminPanel=state.profile.role!=="admin"?"":'<h2 class="section-title">Administration</h2><div class="grid two"><section class="card"><div class="card-header"><h2>Guthaben ausgeben</h2><span class="pill blue">Nur Admin</span></div><form id="credit-form"><div class="form-group"><label for="credit-user">Mitglied</label><select id="credit-user" name="user_id" class="field" required>'+memberOptions+'</select></div><div class="form-group"><label for="credit-amount">Betrag in '+esc(units)+'</label><input id="credit-amount" name="amount" class="field" type="number" min=".01" max="10000" step=".01" required></div><div class="form-group"><label for="credit-note">Grund</label><input class="field" id="credit-note" name="note" maxlength="140" placeholder="z. B. Startguthaben"></div><button class="btn primary full" type="submit">Guthaben zuweisen</button></form><p class="field-help">Jede Ausgabe wird im digitalen Buchungsverlauf dokumentiert.</p></section><section class="card"><div class="card-header"><h2>Kassenberechtigung</h2><span class="pill">Rollen</span></div><form id="permission-form"><div class="form-group"><label for="permission-user">Mitglied</label><select class="field" id="permission-user" name="user_id" required>'+memberOptions+'</select></div><div class="form-group"><label for="permission-role">Berechtigung</label><select class="field" id="permission-role" name="enabled"><option value="true">Kassenpersonal</option><option value="false">Normales Mitglied</option></select></div><button class="btn dark full" type="submit">Berechtigung speichern</button></form><p class="field-help">Administratorrollen können hier nicht vergeben oder entfernt werden.</p></section></div>';
    var approvePanel=state.profile.role==="admin"?'<h2 class="section-title">Stimmberechtigungen</h2><section class="card"><h2>Teilnahme freischalten</h2><p class="details" style="margin-top:12px">Hier verwaltest du die Stimmberechtigung bestehender Bürgerkonten. Änderungen werden serverseitig geprüft.</p><form id="vote-permission-form"><div class="form-group"><label for="vote-user">Nutzer</label><select class="field" id="vote-user" name="user_id" required>'+(state.users||[]).map(function(u){return '<option value="'+esc(u.id)+'">'+esc(u.login_id||"Verwaltung")+(u.vote_eligible?" · freigegeben":" · gesperrt")+'</option>';}).join("")+'</select></div><div class="form-group"><label for="vote-permission">Stimmrecht</label><select class="field" id="vote-permission" name="enabled"><option value="true">Freigeben</option><option value="false">Sperren</option></select></div><button type="submit" class="btn dark">Berechtigung speichern</button></form><p class="field-help">Eine nachträgliche Sperre löscht keine bereits abgegebenen Stimmen.</p></section>':"";
    var deletionPanel=state.profile.role!=="admin"?"":'<section class="card" style="margin-top:20px"><h2>Offene Datenlöschanträge</h2><p class="field-help">Nur Kennungen, keine Klarnamen. Nach Prüfung Daten in allen Projekttabellen und Backups löschen oder rechtlich notwendige Nachweise dokumentieren. Das Markieren als geprüft löscht noch nichts.</p>'+
      ((state.deletionRequests||[]).length?(state.deletionRequests||[]).map(function(q){return '<div class="settings-row"><div><strong>'+esc(q.login_id)+'</strong><p>Beantragt am '+esc(time(q.requested_at))+' · '+esc(q.status)+' · Grund: '+esc(({keine_angabe:"Keine Angabe",datenschutz:"Datenschutzbedenken",nicht_mehr_nutzen:"Nicht mehr nutzen",sonstiges:"Anderer Grund"})[q.reason_code]||"Keine Angabe")+'</p></div>'+(q.status==="beantragt"?'<form data-action="review-data-deletion"><input type="hidden" name="user_id" value="'+esc(q.user_id)+'"><button class="btn dark" type="submit">Prüfung beginnen</button></form>':'')+'</div>';}).join(""):'<p class="field-help">Keine offenen Anträge.</p>')+'</section>';
    if(state.page==="admin")return header("VERWALTUNG","Administration.","Guthaben, Rollen und Stimmrecht für unseren Schulstaat verwalten.")+adminPanel+approvePanel+deletionPanel;
    return header(state.page==="admin"?"VERWALTUNG":"MEIN BEREICH",state.page==="admin"?"Administration":"Einstellungen",state.page==="admin"?"Berechtigungen und Guthaben für unseren Schulstaat verwalten.":"Dein Profil, dein Passwort und deine Geräte.")+
      '<section class="card"><div class="card-header"><h2>Einführung in das Portal</h2><span class="pill blue">Interaktiv</span></div><p class="details">Der Rundgang erklärt die wichtigsten Bereiche. Er führt keine Zahlungen oder Anträge aus.</p><button class="btn" type="button" data-action="restart-tutorial">Einführung starten oder wiederholen</button></section>'+ 
      '<div class="grid two"><section class="card"><h2>Benutzerkonto</h2><div class="divider"></div><div class="settings-row"><div><strong>Kontokennung</strong><p>'+esc(state.profile.display_name)+'</p></div></div><div class="settings-row"><div><strong>'+account.label+'</strong><p>'+esc(account.value)+'</p></div></div><div class="settings-row"><div><strong>Rolle</strong><p>'+roleLabel()+'</p></div></div><div class="divider"></div>'+btn("Abmelden","logout","")+'</section><section class="card"><h2>Kameraberechtigung</h2><div class="divider"></div><p class="details">HTTPS-Status: '+(window.isSecureContext?"Sicherer Kontext":"Unsicherer Kontext")+'. Kamera wird nur auf deinen Wunsch aktiviert und niemals aufgezeichnet.</p>'+btn("Kamerazugriff testen","camera-test")+'<div class="divider"></div><p class="details">Kontoeinheit: '+esc(units)+'. Keine Euro-Bankgutschrift; die Schulwährung kann jedoch mit echten Euro erworben werden.</p></section></div>'+'<section class="card" style="margin-top:20px"><h2>Passwort ändern</h2><p class="field-help">Wähle ein individuelles, mindestens 12 Zeichen langes Passwort. Deine aktuelle Anmeldung muss gültig sein.</p><form id="password-change-form"><div class="form-group"><label for="change-pw">Neues Passwort</label><span class="sas-password-input"><input class="field" type="password" autocomplete="new-password" id="change-pw" name="password" minlength="12" required><button type="button" class="sas-password-toggle" data-password-toggle="change-pw" aria-controls="change-pw" aria-label="Passwort anzeigen" title="Passwort anzeigen" aria-pressed="false"><svg class="sas-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="sas-eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18M10.58 5.15A11.8 11.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.03 3.8M6.7 6.7C3.6 8.6 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.37-.9"/><path d="M10 10a3 3 0 0 0 4 4"/></svg></button></span></div><div class="form-group"><label for="change-pw-repeat">Passwort wiederholen</label><span class="sas-password-input"><input class="field" type="password" autocomplete="new-password" id="change-pw-repeat" name="repeat" minlength="12" required><button type="button" class="sas-password-toggle" data-password-toggle="change-pw-repeat" aria-controls="change-pw-repeat" aria-label="Passwort anzeigen" title="Passwort anzeigen" aria-pressed="false"><svg class="sas-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="sas-eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18M10.58 5.15A11.8 11.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.03 3.8M6.7 6.7C3.6 8.6 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.37-.9"/><path d="M10 10a3 3 0 0 0 4 4"/></svg></button></span></div><button type="submit" class="btn dark">Passwort aktualisieren</button></form></section>'+'<section class="card" style="margin-top:20px"><h2>Datenschutz und Datenlöschung</h2><p class="field-help">Du kannst kostenlos und ohne Begründung die Löschung deiner Projektdaten beantragen.</p><p><a href="/datenschutz.html" target="_blank" rel="noopener noreferrer">Datenschutz</a> · <a href="/nutzungsregeln.html" target="_blank" rel="noopener noreferrer">Nutzungsregeln</a></p><button class="btn dark" type="button" data-action="open-deletion">Datenlöschung beantragen</button></section>'+(state.page==="admin"?adminPanel+approvePanel+deletionPanel:"");
  }
  function passwordRecoveryView(){
    return '<section class="welcome-side" style="max-width:560px;margin:48px auto"><div class="login-box">'+header("KONTO SICHERN","Neues Passwort festlegen.","Du hast einen Wiederherstellungslink geöffnet. Wähle jetzt ein eigenes Passwort.")+'<form id="password-recovery-form"><div class="form-group"><label for="recovery-pw">Neues Passwort (mindestens 12 Zeichen)</label><span class="sas-password-input"><input class="field" type="password" autocomplete="new-password" id="recovery-pw" name="password" minlength="12" required><button type="button" class="sas-password-toggle" data-password-toggle="recovery-pw" aria-controls="recovery-pw" aria-label="Passwort anzeigen" title="Passwort anzeigen" aria-pressed="false"><svg class="sas-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="sas-eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18M10.58 5.15A11.8 11.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.03 3.8M6.7 6.7C3.6 8.6 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.37-.9"/><path d="M10 10a3 3 0 0 0 4 4"/></svg></button></span></div><div class="form-group"><label for="recovery-pw-repeat">Passwort wiederholen</label><span class="sas-password-input"><input class="field" type="password" autocomplete="new-password" id="recovery-pw-repeat" name="repeat" minlength="12" required><button type="button" class="sas-password-toggle" data-password-toggle="recovery-pw-repeat" aria-controls="recovery-pw-repeat" aria-label="Passwort anzeigen" title="Passwort anzeigen" aria-pressed="false"><svg class="sas-eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/></svg><svg class="sas-eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 3 18 18M10.58 5.15A11.8 11.8 0 0 1 12 5c6.5 0 10 7 10 7a15 15 0 0 1-3.03 3.8M6.7 6.7C3.6 8.6 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.37-.9"/><path d="M10 10a3 3 0 0 0 4 4"/></svg></button></span></div><button type="submit" class="btn primary full">Neues Passwort speichern</button></form></div></section>';
  }
  function render(){
    state.editing=false;
    if(!api)return setup();
    if(state.user&&state.deletionStatus?.requested){dataDeletionPendingView();return;}
    if(state.user&&state.showDeletionForm){dataDeletionRequestView();return;}
    if(state.user?.app_metadata?.sas_initial_password===true){rosterFirstLoginView();return;}
    if(state.recovering&&state.user){root.innerHTML=passwordRecoveryView();return;}
    if(state.user&&state.legalStatus?.needs_acknowledgement){schoolLegalView();return;}
    if(!state.user){document.title="Anmelden · Schule als Staat";return login();}
    if(!state.profile||!state.wallet){root.textContent="Profil oder Guthaben konnte nicht geladen werden. Bitte Zugang und Datenbankkonfiguration prüfen.";return;}
    var views={home:dashboard,wallet:wallet,pay:pay,register:register,history:history,votes:votesPage,settings:settingsPage,apps:appDirectory,admin:settingsPage,overlord:overlordPage};
    if(!allowed(state.page)){state.page="home";}
    document.title=label(state.page)+" · Schule als Staat";
    if(state.page==="home"&&isPreviewMember()){mount(dashboard());return;}
    if(state.page==="home"&&window.SAS_PORTAL_EXTRAS){
       mount(dashboard());
       void window.SAS_PORTAL_EXTRAS.enrichHome({api:api,user:state.user,profile:state.profile,schoolRoles:state.schoolRoles,polls:state.polls,target:document.getElementById("sas-personal-hub")}).catch(function(){});
       return;
     }
     if((state.page==="applications"||state.page==="updates")&&window.SAS_PORTAL_EXTRAS){
       mount('<div id="sas-portal-hub"></div>');
       var task=state.page==="applications"?window.SAS_PORTAL_EXTRAS.showApplications:window.SAS_PORTAL_EXTRAS.showUpdates;
       void task({api:api,user:state.user,profile:state.profile,polls:state.polls,target:document.getElementById("sas-portal-hub")}).catch(fail);
       return;
     }
     if(state.page==="overlord"){mount(overlordPage());void overlordRefresh();return;}
    if(state.page==="votes"&&window.SAS_FLAG_VOTING){
      mount(votesPage());
      var flagSlot=document.getElementById("sas-flag-voting-slot");
      if(flagSlot){
        flagSlot.dataset.voteEligible=String(Boolean(state.profile.vote_eligible));
        void window.SAS_FLAG_VOTING.enhance({api:api,polls:state.polls,target:flagSlot}).catch(fail);
      }
      return;
    }
    if(state.page==="map"&&window.SAS_SHOP_PLAN){mount('<div id="sas-school-shop-plan"></div>');window.SAS_SHOP_PLAN.show({api:api,user:state.user,profile:state.profile,focusRoom:window.SAS_MAP_FOCUS_CODE||"",target:document.getElementById("sas-school-shop-plan")}).catch(fail);window.SAS_MAP_FOCUS_CODE="";return;}
    if(state.page==="roles"&&window.SAS_SCHOOL_ROLES){
      if(!allowed("roles")){state.page="home";mount(dashboard());return;}
      mount('<div id="school-roles-root"></div>');
      window.SAS_SCHOOL_ROLES.show({api:api,profile:state.profile,schoolRoles:state.schoolRoles,target:document.getElementById("school-roles-root")}).catch(fail);
      return;
    }
    if(state.page==="workhours"&&window.SAS_WORK_HOURS){
      mount('<div id="school-workhours-root"></div>');
      window.SAS_WORK_HOURS.show({api:api,profile:state.profile,schoolRoles:state.schoolRoles,target:document.getElementById("school-workhours-root")}).catch(fail);
      return;
    }
    if(state.page==="myjob"){
      mount('<section class="card"><div class="card-header"><h2>Mein Beruf</h2></div><p>Wähle deine Berufsbezeichnung. Daraus entstehen keine Sonderrechte. Admin, Operator, Polizei und Parlament sind reserviert.</p><form id="sas-myjob-form"><label for="sas-job-title">Berufsbezeichnung</label><input class="field" id="sas-job-title" name="title" minlength="3" maxlength="65" required placeholder="z. B. Bäcker"><button class="btn primary" type="submit">Beruf speichern</button></form><p id="sas-myjob-status" aria-live="polite"></p></section>');
      rpc("my_school_job_title",{}).then(function(v){var f=document.getElementById("sas-job-title");if(f&&v)f.value=v;}).catch(fail);
      return;
    }
    if(state.page==="admincredit"&&window.SAS_ADMIN_CREDIT){
      if(!allowed("admincredit")){state.page="home";mount(dashboard());return;}
      mount('<div id="sas-admin-credit"></div>');
      window.SAS_ADMIN_CREDIT.show({api:api,profile:state.profile,target:document.getElementById("sas-admin-credit")}).catch(fail);
      return;
    }
    if(state.page==="cardshop"&&window.SAS_CARD_SHOP){
      mount('<div id="sas-cardshop-root"></div>');
      window.SAS_CARD_SHOP.show({api:api,user:state.user,profile:state.profile,target:document.getElementById("sas-cardshop-root")}).catch(fail);
      return;
    }
    if(state.page==="shopmanage"&&window.SAS_SHOPS){
      mount('<div id="sas-shop-root"></div>');
      window.SAS_SHOPS.show({api:api,user:state.user,profile:state.profile,schoolRoles:state.schoolRoles,target:document.getElementById("sas-shop-root")}).catch(fail);
      return;
    }
    if(state.page==="attendance"&&window.SAS_ATTENDANCE){
      if(!allowed("attendance")){state.page="home";mount(dashboard());return;}
      mount('<div id="school-attendance-root"></div>');
      window.SAS_ATTENDANCE.show({api:api,profile:state.profile,schoolRoles:state.schoolRoles,target:document.getElementById("school-attendance-root")}).catch(fail);
      return;
    }
    if(window.SAS_FEATURES&&window.SAS_FEATURES.pages[state.page]){
      mount('<div id="sas-live-module" role="region" aria-label="'+esc(window.SAS_FEATURES.pages[state.page])+'"></div>');
      window.SAS_FEATURES.show({api:api,user:state.user,profile:state.profile,schoolRoles:state.schoolRoles,page:state.page,prefillRoomId:state.page==="rooms"?window.SAS_PREFILL_ROOM||null:null,target:document.getElementById("sas-live-module"),navigate:navigate}).catch(fail);if(state.page==="rooms")window.SAS_PREFILL_ROOM=null;
      return;
    }
    if(!allowed(state.page))state.page="home";
    mount((views[state.page]||dashboard)());
  }
  function paymentURL(id){
    var u=new URL(location.href);u.search="";u.hash="";u.searchParams.set("pay",id);return u.href;
  }
  function codeToId(input){
    var value=String(input||"").trim();
    if(/^https?:\/\//i.test(value)){
      var u=new URL(value);
      if(u.origin!==location.origin||u.pathname!==location.pathname)throw Error("Zahlungslink stammt nicht von dieser Website.");
      value=u.searchParams.get("pay")||"";
    }else value=value.replace(/^NV-PAY:/i,"");
    if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(value))throw Error("Ungültiger QR-Code oder Zahlungslink.");
    return value;
  }
  async function openInvoice(input){
    var id=codeToId(input);
    state.invoice=await rpc("lookup_payment_request",{p_request_id:id});
    state.page="pay";render();
    var node=document.querySelector(".fancy-number");if(node)node.scrollIntoView({block:"center",behavior:"smooth"});
  }
  async function stopScanner(){
    var sc=state.scanner;state.scanner=null;state.scanning=false;
    if(sc){try{if(sc.isScanning)await sc.stop();}catch(e){}try{sc.clear();}catch(e){}}
  }
  async function scanStart(){
    if(!window.isSecureContext||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw Error("Kamerazugriff braucht eine direkte HTTPS-Website.");
    if(!window.Html5Qrcode)throw Error("Scannerbibliothek nicht geladen. QR-Bild oder Link verwenden.");
    await stopScanner();
    var node=document.getElementById("qr-reader");if(!node)return;
    node.innerHTML="";
    var reader=new window.Html5Qrcode("qr-reader");
    state.scanner=reader;
    try{
      await reader.start({facingMode:"environment"},{fps:10,qrbox:{width:200,height:200}},async function(result){
        if(!state.scanning)return;
        await stopScanner();
        try{await openInvoice(result);}catch(e){fail(e);render();}
      },function(){});
      state.scanning=true;showToast("Kamera läuft. Zahlungs-QR ausrichten.");
    }catch(e){
      await stopScanner();
      var msg=String(e&&e.message||e);
      if(/NotAllowed|Permission|denied/i.test(msg))throw Error("Kamera verweigert. In den Browser-Einstellungen für diese Website erlauben oder QR-Link verwenden.");
      throw Error("Kamera konnte nicht starten: "+msg);
    }
  }
  async function scanFile(file){
    if(!window.Html5Qrcode)throw Error("QR-Bibliothek nicht geladen. Link manuell eingeben.");
    await stopScanner();
    var node=document.getElementById("qr-reader");if(!node)return;
    node.innerHTML="";
    var qr=new window.Html5Qrcode("qr-reader");
    try{var value=await qr.scanFile(file,true);await openInvoice(value);}
    finally{try{qr.clear();}catch(e){}}
  }
  async function cameraTest(){
    if(!window.isSecureContext||!navigator.mediaDevices||!navigator.mediaDevices.getUserMedia)throw Error("Kamera erfordert HTTPS und direkten Browseraufruf.");
    var stream;
    try{
      stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:{ideal:"environment"}},audio:false});
      showToast("Kamera erfolgreich getestet. Stream beendet.");
    }catch(e){
      if(e.name==="NotAllowedError")throw Error("Kameraberechtigung verweigert. Bitte Browser-Websiteberechtigungen prüfen.");
      throw e;
    }finally{if(stream)stream.getTracks().forEach(function(t){t.stop();});}
  }
  // Per-tab navigation context for native browser pull-to-refresh.
  // No credentials or personal data are persisted.
  function rememberPage(id){
    if(!state.user || !allowed(id))return;
    try{window.sessionStorage.setItem("sas-current-section:"+state.user.id,id);}catch(_){}
  }
  function restorePage(){
    if(!state.user || deepLink)return;
    try{
      var saved=window.sessionStorage.getItem("sas-current-section:"+state.user.id);
      if(saved && allowed(saved))state.page=saved;
    }catch(_){}
  }
  async function navigate(id){if(state.busy||(window.SAS_FEATURES&&window.SAS_FEATURES.isBusy())){showToast("Bitte warte, bis die Änderung gespeichert ist.");return;}if(!allowed(id))return;await stopScanner();if(window.SAS_ATTENDANCE)await window.SAS_ATTENDANCE.stop();if(window.SAS_WORK_HOURS)await window.SAS_WORK_HOURS.stop();state.page=id;rememberPage(id);state.editing=false;render();if(["home","wallet","history","votes"].includes(id))void refresh(true);window.scrollTo(0,0);var main=document.getElementById("main-content");if(main)main.focus({preventScroll:true});}
  window.SAS_TUTORIAL_NAV=function(page){if(allowed(page))void navigate(page);};
  async function action(id,pollId){
    if(state.busy)return;
    try{
      if(id==="open-search"){document.getElementById("portal-search").showModal();return;}
      if(id==="close-search"){document.getElementById("portal-search").close();return;}
      if(id.indexOf("to-")===0)return await navigate(id.slice(3));
      if(id==="camera-test")return await cameraTest();
      if(id==="restart-tutorial"&&window.SAS_TUTORIAL)return await window.SAS_TUTORIAL.reopen(api,state.user.id,{previewOnly:isPreviewMember(),pollsOpen:!previewVotingClosed(),pollsVisible:state.profile?.role==="admin"||Boolean(state.schoolRoles?.operator)});
      if(id==="close-poll"){
        if(!state.profile||(state.profile.role!=="admin"&&!state.schoolRoles?.operator))throw Error("Keine Verwaltungsberechtigung");
        if(!window.confirm("Diese Abstimmung wirklich schließen? Danach sind keine Stimmen mehr möglich."))return;
        state.busy=true;
        await rpc("admin_close_poll",{p_poll_id:pollId});
        await fetchData();render();showToast("Abstimmung geschlossen.");return;
      }
      if(id==="scan-start")return await scanStart();
      if(id==="scan-stop"){await stopScanner();render();return;}
      if(id==="cancel"){state.invoice=null;render();return;}
      if(id==="open-deletion"){state.showDeletionForm=true;state.deletionStage=1;state.deletionReadToEnd=false;render();return;}
      if(id==="deletion-proceed"){if(!state.showDeletionForm||!state.deletionReadToEnd)return;state.deletionStage=2;render();return;}
      if(id==="deletion-back"){state.deletionStage=1;render();return;}
      if(id==="close-deletion"){state.showDeletionForm=false;state.deletionStage=1;state.deletionReadToEnd=false;render();return;}
      if(id==="logout"){if(window.SAS_TUTORIAL)window.SAS_TUTORIAL.logout();await stopScanner();if(window.SAS_ATTENDANCE)await window.SAS_ATTENDANCE.stop();var o=await api.auth.signOut();if(o.error)throw o.error;return;}
      if(id==="copy"&&state.active){await navigator.clipboard.writeText(paymentURL(state.active.id));showToast("Zahlungslink kopiert.");return;}
      if(id==="confirm"&&state.invoice){
        state.busy=true;
        await rpc("settle_payment_request",{p_request_id:state.invoice.id});
        state.invoice=null;
        var url=new URL(location.href);url.searchParams.delete("pay");history.replaceState({},"",url.pathname+url.search+url.hash);
        await fetchData();state.page="wallet";render();
        showToast("Zahlung erfolgreich verbucht.");
      }
    }catch(e){fail(e);}finally{state.busy=false;}
  }
  async function handleForm(form){
    if(state.busy)return;
    state.busy=true;
    var data=new FormData(form), submit=form.querySelector('[type="submit"]');
    if(submit)submit.disabled=true;
    try{
      if(form.dataset?.action==="review-data-deletion"){
        await rpc("admin_review_school_deletion_request",{p_user_id:String(data.get("user_id")||"")});
        await fetchData();render();showToast("Löschantrag in Prüfung.");return;
      }
      if(form.id==="data-deletion-request-form"){
        if(!state.showDeletionForm||state.deletionStage!==2||!state.deletionReadToEnd)
          throw Error("Bitte zuerst die Folgen der Datenlöschung ansehen.");
        var requestedReason=String(data.get("reason")||"");
        if(!["datenschutz","nicht_mehr_nutzen","sonstiges","keine_angabe"].includes(requestedReason))
          throw Error("Bitte eine Antwort auswählen. Du kannst „Will ich nicht angeben“ wählen.");
        state.deletionStatus=await rpc("request_my_school_data_deletion",{p_reason:requestedReason});
        state.showDeletionForm=false;render();showToast("Löschantrag eingereicht.");return;
      }
      if(form.id==="school-legal-form"){
        if(data.get("notice_read")!=="on"||data.get("rules_accepted")!=="on")throw Error("Bitte beide Pflichtbestätigungen auswählen.");
        await rpc("acknowledge_school_legal",{p_notice_read:true,p_rules_accepted:true});
        state.legalStatus=await rpc("school_legal_status",{});
        render();showToast("Bestätigung gespeichert.");return;
      }
      if(form.id==="roster-first-password-form"){
        var pw=String(data.get("password")||"");
        if(pw.length<12||pw.length>128||!/[A-Za-z]/.test(pw)||!/[^A-Za-z]/.test(pw))
          throw Error("Mindestens 12 Zeichen mit Buchstaben und Zahlen oder Sonderzeichen verwenden.");
        if(pw!==String(data.get("repeat")||""))throw Error("Die neuen Passwörter stimmen nicht überein.");
        if(data.get("notice_read")!=="on"||data.get("rules_accepted")!=="on")throw Error("Bitte beide Pflichtbestätigungen auswählen.");
        await rpc("acknowledge_school_legal",{p_notice_read:true,p_rules_accepted:true});
        var changed=await api.auth.updateUser({password:pw});
        if(changed.error)throw changed.error;
        var refreshed=await api.auth.refreshSession();
        if(refreshed.error)throw refreshed.error;
        state.user=refreshed.data.user;
        if(state.user?.app_metadata?.sas_initial_password===true)
          throw Error("Passwort geändert, aber die Erstaktivierung wurde serverseitig noch nicht bestätigt.");
        await fetchData();state.page="home";render();showToast("Persönliches Passwort gespeichert.");
        return;
      }
      if(form.id==="sas-myjob-form"){
        var chosen=String(data.get("title")||"").trim();
        await rpc("set_my_school_job_title",{p_title:chosen});
        var jobStatus=document.getElementById("sas-myjob-status");if(jobStatus)jobStatus.textContent="Beruf gespeichert – ohne zusätzliche Berechtigungen.";
        showToast("Berufsbezeichnung gespeichert.");
        return;
      }
      if(form.id==="password-reset-request-form"){
        var resetEmail=String(data.get("email")||"").trim();
         if(/@accounts\.schule-als-staat\.invalid$/i.test(resetEmail))
          throw Error("Bürgerkennungen besitzen kein E-Mail-Postfach. Bitte einen neuen Zugangscode über die Schulverwaltung anfordern.");
        var reset=await api.auth.resetPasswordForEmail(resetEmail,{redirectTo:location.origin+location.pathname});
        if(reset.error)throw reset.error;
        showToast("Wenn diese Adresse registriert ist und der E-Mail-Versand verfügbar ist, erhältst du einen Passwort-Link.");
      }
      if(form.id==="password-recovery-form"||form.id==="password-change-form"){
        var replacement=String(data.get("password")||"");
        if(replacement.length<12)throw Error("Bitte ein Passwort mit mindestens 12 Zeichen verwenden.");
        if(replacement!==String(data.get("repeat")||""))throw Error("Die Passwörter stimmen nicht überein.");
        var changed=await api.auth.updateUser({password:replacement});
        if(changed.error)throw changed.error;
        state.recovering=false;
        if(location.hash)history.replaceState(null,"",location.pathname+location.search);
        if(state.user){await claimDesignatedAdmin();await fetchData();}
        showToast("Dein neues Passwort wurde gespeichert.");
        render();
      }
      if(form.id==="signup-form")throw Error("Eigenständige Registrierung ist deaktiviert. Bürgerkonten vergibt die Schulverwaltung.");
      if(form.id==="password-login-form"){
        var response=await api.auth.signInWithPassword({
          email:(function(){
            var raw=String(data.get("email")||"").trim();
            if(/^SAS-[A-Z0-9]{10}$/i.test(raw))return raw.slice(4).toLowerCase()+"@accounts.schule-als-staat.invalid";
            if(raw.indexOf("@")<0)throw Error("Bitte die vollständige Bürgerkennung SAS-XXXXXXXXXX eingeben.");
            return raw;
          })(),
          password:String(data.get("password")||"")
        });
        if(response.error)throw response.error;
      }
      if(form.id==="login-form"){
        var result=await api.auth.signInWithOtp({email:String(data.get("email")||"").trim(),options:{emailRedirectTo:location.origin+location.pathname+location.search,shouldCreateUser:false}});
        if(result.error)throw result.error;
        showToast("Bitte E-Mail prüfen und den Anmeldelink öffnen.");
      }
      if(form.id==="manual-form")await openInvoice(data.get("code"));
      if(form.id==="vote-form"||form.id==="flag-vote-form"){
        if(!state.profile.vote_eligible)throw Error("Zur Abstimmung muss dein Konto von der Schule freigeschaltet sein.");
        var pollId=form.dataset.pollId;
        var selected=data.get("choice");
        if(!selected)throw Error("Wähle zuerst eine Antwort aus.");
        await rpc("submit_vote",{p_poll_id:pollId,p_option_id:String(selected)});
        await fetchData();render();showToast("Deine Stimme wurde gezählt.");
      }
      if(form.id==="poll-create"){
        if(state.profile.role!=="admin"&&!state.schoolRoles?.operator)throw Error("Keine Verwaltungsberechtigung.");
        var choices=String(data.get("options")||"").split(/\r?\n/).map(function(x){return x.trim();}).filter(Boolean);
        await rpc("admin_create_poll",{p_title:String(data.get("title")||"").trim(),p_description:String(data.get("description")||"").trim(),p_options:choices});
        await fetchData();render();showToast("Abstimmung veröffentlicht.");
      }
      if(form.id==="vote-permission-form"){
        if(state.profile.role!=="admin")throw Error("Keine Administratorberechtigung.");
        await rpc("admin_set_vote_eligibility",{p_user_id:String(data.get("user_id")),p_enabled:data.get("enabled")==="true"});
        await fetchData();render();showToast("Wahlberechtigung aktualisiert.");
      }
      if(form.id==="credit-form"){
        if(state.profile.role!=="admin")throw Error("Keine Administratorrechte.");
        await rpc("issue_credits",{p_user_id:String(data.get("user_id")),p_amount_cents:amount(data.get("amount")),p_note:String(data.get("note")||"").slice(0,140)});
        await fetchData();render();showToast("Guthaben sicher zugeteilt.");
      }
      if(form.id==="permission-form"){
        if(state.profile.role!=="admin")throw Error("Keine Administratorrechte.");
        await rpc("admin_set_cashier",{p_user_id:String(data.get("user_id")),p_enabled:data.get("enabled")==="true"});
        await fetchData();render();showToast("Kassenberechtigung geändert.");
      }
      if(form.id==="request-form"){
        if(!adminOrCashier())throw Error("Keine Kassenberechtigung");
        var id=await rpc("create_payment_request",{p_amount_cents:amount(data.get("amount")),p_note:String(data.get("note")||"").slice(0,140)});
        await fetchData();state.active=state.requests.find(function(r){return r.id===id;})||null;render();
        showToast("Zahlungs-QR erstellt.");
      }
      if(form.id==="cash-form"){
        if(!adminOrCashier())throw Error("Keine Kassenberechtigung");
        await rpc("record_cash_sale",{p_amount_cents:amount(data.get("amount")),p_note:String(data.get("note")||"").slice(0,140)});
        await fetchData();render();showToast("Bargeldumsatz gebucht.");
      }
    }catch(e){fail(e);}finally{state.busy=false;if(submit&&submit.isConnected)submit.disabled=false;}
  }
  root.addEventListener("click",function(e){
    var visibilityButton=e.target.closest("[data-password-toggle]");
    if(visibilityButton&&visibilityButton.dataset&&visibilityButton.dataset.passwordToggle){
      e.preventDefault();
      var passwordInput=document.getElementById(visibilityButton.dataset.passwordToggle);
      if(!passwordInput||!visibilityButton.parentElement.contains(passwordInput))return;
      var reveal=passwordInput.type==="password";
      passwordInput.type=reveal?"text":"password";
      visibilityButton.setAttribute("aria-pressed",String(reveal));
      visibilityButton.setAttribute("aria-label",reveal?"Passwort verbergen":"Passwort anzeigen");
      visibilityButton.title=reveal?"Passwort verbergen":"Passwort anzeigen";
      return;
    }
    var target=e.target.closest("[data-nav],[data-action]");
    if(!target)return;
    e.preventDefault();
    if(target.dataset.nav){if(target.dataset.roomSearch)window.SAS_MAP_FOCUS_CODE=target.dataset.roomSearch;void navigate(target.dataset.nav);}
    else void action(target.dataset.action,target.dataset.pollId);
  });
  root.addEventListener("submit",function(e){e.preventDefault();void handleForm(e.target);});
  root.addEventListener("change",function(e){
    state.editing=true;
    if(e.target.id==="scan-file"&&e.target.files&&e.target.files[0])void scanFile(e.target.files[0]).catch(fail);
  });
  var portalSearchSeq=0,portalSearchTimer=null;
   root.addEventListener("input",function(e){
    if(e.target.id!=="module-query"){state.editing=true;return;}
    var q=e.target.value.trim().toLocaleLowerCase("de");
    var dialog=document.getElementById("portal-search"),count=0;
    dialog.querySelectorAll("[data-module-search]").forEach(function(el){el.hidden=!el.dataset.moduleSearch.includes(q);if(!el.hidden)count++;});
    dialog.querySelectorAll("[data-module-group]").forEach(function(el){el.hidden=!Array.from(el.querySelectorAll("[data-module-search]")).some(function(t){return !t.hidden;});});
    dialog.querySelector(".search-empty").hidden=count>0;
     var results=dialog.querySelector("#sas-global-results");
      if(isPreviewMember()){if(results){results.hidden=true;results.innerHTML="";}return;}
     if(!results||!window.SAS_PORTAL_EXTRAS||!state.user)return;
     var ticket=++portalSearchSeq;clearTimeout(portalSearchTimer);
     if(q.length<2){results.hidden=true;results.innerHTML="";return;}
     results.hidden=false;results.innerHTML='<h3>Räume, Shops, Veranstaltungen und Beiträge</h3><p class="sas-hub-note">Suche läuft …</p>';
     portalSearchTimer=setTimeout(async function(){
       try{
         var items=await window.SAS_PORTAL_EXTRAS.search({api:api},q);
         if(ticket!==portalSearchSeq||!results.isConnected||!dialog.open)return;
         results.innerHTML='<h3>Direkte Treffer</h3>'+(items.length?items.map(function(x){
           return '<button type="button" class="sas-global-result" data-nav="'+esc(x.page)+'"'+(x.focus?' data-room-search="'+esc(x.focus)+'"':'')+
           '><strong>'+esc(x.title)+'</strong><small>'+esc(x.category+' · '+(x.detail||"Öffnen"))+'</small></button>';
         }).join(""):'<p class="sas-hub-note">Keine passenden Einträge gefunden.</p>');
       }catch(e){if(ticket===portalSearchSeq&&results.isConnected)results.innerHTML='<p class="sas-hub-note">Die direkte Suche ist vorübergehend nicht verfügbar.</p>';}
     },250);
  });
  window.addEventListener("hashchange",function(){
    var hash=location.hash;
    // The former guest ViSA hash routes no longer open a public page.
    if(!state.user)render();
  });
  document.addEventListener("keydown",function(e){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"&&state.user){e.preventDefault();var d=document.getElementById("portal-search");if(d){if(d.open)d.close();else d.showModal();}}});
  // No continuously scheduled database reads: Workers Free has a daily
  // request cap. A tab refreshes when it becomes visible after inactivity,
  // while navigation, writes and the explicit Refresh buttons remain active.
  var lastResumeRefresh=Date.now();
  document.addEventListener("visibilitychange",function(){
    if(document.hidden){void stopScanner();return;}
    if(Date.now()-lastResumeRefresh<120000)return;
    var focused=document.activeElement;
    if(focused&&/^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName))return;
    if(state.user&&["home","wallet","history","votes"].includes(state.page)&&!state.editing&&!state.busy&&!state.scanning&&!document.querySelector("dialog[open]")){
      lastResumeRefresh=Date.now();
      void refresh(true);
    }
  });
  window.addEventListener("pagehide",function(){void stopScanner();});
  async function start(){
    if(!api)return render();
    var session=await api.auth.getSession();
    if(session.error)throw session.error;
    state.user=session.data.session&&session.data.session.user||null;
    if(state.user){await claimDesignatedAdmin();await fetchData();restorePage();}

    render();
    if(state.user&&!state.legalStatus?.needs_acknowledgement&&!state.deletionStatus?.requested&&window.SAS_TUTORIAL)void window.SAS_TUTORIAL.start(api,state.user.id,{previewOnly:isPreviewMember(),pollsOpen:!previewVotingClosed(),pollsVisible:state.profile?.role==="admin"||Boolean(state.schoolRoles?.operator)});
    if(deepLink&&state.user&&!state.legalStatus?.needs_acknowledgement&&!state.deletionStatus?.requested&&!isPreviewMember()){try{await openInvoice(deepLink);}catch(e){fail(e);}}
    api.auth.onAuthStateChange(function(event,session){
      var next=session&&session.user||null;
      if(event==="PASSWORD_RECOVERY"){
        state.recovering=true;
        state.user=next;
        render();
        return;
      }
      if(next&&state.user&&next.id===state.user.id)return;
      state.user=next;state.profile=null;state.legalStatus=null;state.deletionStatus=null;state.deletionRequests=[];state.showDeletionForm=false;state.deletionStage=1;state.deletionReadToEnd=false;state.wallet=null;state.ledger=[];state.cash=[];state.requests=[];state.users=[];state.polls=[];state.pollResults=[];state.schoolRoles={operator:false,jobs:[]};state.active=null;state.invoice=null;
      if(window.SAS_TUTORIAL)window.SAS_TUTORIAL.logout();
      void stopScanner().then(async function(){
        try{if(state.user){await claimDesignatedAdmin();await fetchData();}render();if(state.user&&!state.legalStatus?.needs_acknowledgement&&!state.deletionStatus?.requested&&window.SAS_TUTORIAL)void window.SAS_TUTORIAL.start(api,state.user.id,{previewOnly:isPreviewMember(),pollsOpen:!previewVotingClosed(),pollsVisible:state.profile?.role==="admin"||Boolean(state.schoolRoles?.operator)});if(deepLink&&state.user&&!isPreviewMember())await openInvoice(deepLink);}
        catch(e){fail(e);render();}
      });
    });
  }
  void start().catch(function(e){
    // Never print opaque API response objects, JWTs, internal SQL or stack traces
    // into the public interface. Provide a recoverable, usable failure state.
    console.error("School portal startup failed",e);
    root.innerHTML='<div class="welcome" style="min-height:100dvh"><section class="welcome-side" style="grid-column:1/-1"><div class="login-box">'+
      '<div class="eyebrow">VERBINDUNG</div><h1>Das Schulportal konnte nicht geladen werden.</h1>'+
      '<p class="lead">Die Daten konnten gerade nicht abgerufen werden. Bitte überprüfe die Verbindung und versuche es erneut.</p>'+
      '<button type="button" class="btn primary full" id="sas-start-retry">Erneut versuchen</button>'+
      '<p class="field-help">Dein Konto und dein Guthaben sind davon nicht betroffen.</p></div></section></div>';
    var retry=document.getElementById("sas-start-retry");
    if(retry)retry.addEventListener("click",function(){window.location.reload();});
  });
})();
