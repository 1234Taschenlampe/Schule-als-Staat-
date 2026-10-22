
(function () {
  "use strict";
  var cfg=window.NV_CONFIG||{}, root=document.getElementById("app"), toasts=document.getElementById("toast-root");
  var ready=Boolean(cfg.supabaseUrl&&cfg.supabaseAnonKey&&window.supabase&&window.supabase.createClient);
  var api=ready?window.supabase.createClient(cfg.supabaseUrl,cfg.supabaseAnonKey):null;
  var state={user:null,profile:null,wallet:null,ledger:[],cash:[],requests:[],users:[],polls:[],pollResults:[],schoolRoles:{operator:false,jobs:[]},page:"home",active:null,invoice:null,scanner:null,scanning:false,busy:false,editing:false,recovering:/(?:^|[&#?])type=recovery(?:&|$)/.test(location.hash)};
  var deepLink=new URLSearchParams(location.search).get("pay");
  var openPortalAfterLogin=false; // No old V3 demo portal; all live features are integrated.
  if(deepLink)state.page="pay";
  var units=String(cfg.currencyLabel||"Einheiten");
  var navs=[["home","Übersicht"],["wallet","Mein Konto"],["pay","Bezahlen"],["register","Kasse"],["history","Verlauf"],["votes","Abstimmungen"],["settings","Einstellungen"]];
  if(window.SAS_FEATURES)navs.splice(navs.length-1,0,...window.SAS_FEATURES.navigation.map(function(n){return [n[0],n[1]];}));
  if(window.SAS_VERIFICATION)navs.splice(navs.length-1,0,["schoolverify","Schulverifizierung"],["verifyadmin","QR-Prüfung"]);
  if(window.SAS_SCHOOL_ROLES)navs.splice(navs.length-1,0,["roles","Berufe & Rollen"]);
  navs.splice(navs.length-1,0,["myjob","Mein Beruf"]);
  if(window.SAS_ADMIN_CREDIT)navs.splice(navs.length-1,0,["admincredit","Geld ausgeben"]);
  if(window.SAS_SHOPS)navs.splice(navs.length-1,0,["shopmanage","Shopverwaltung"]);
  if(window.SAS_ATTENDANCE)navs.splice(navs.length-1,0,["attendance","Anwesenheitskontrolle"]);
  if(window.SAS_WORK_HOURS)navs.splice(navs.length-1,0,["workhours","Arbeitszeit"]);
  function esc(v){return String(v==null?"":v).replace(/[&<>"']/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c];});}
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
    if(code==="invalid_credentials"||/invalid login credentials/.test(message))return "E-Mail-Adresse oder Passwort stimmen nicht überein. Prüfe, mit welcher Adresse du dein Konto erstellt hast.";
    if(code==="email_not_confirmed"||/email not confirmed/.test(message))return "Dieses Konto ist noch nicht zur Anmeldung freigeschaltet. Bitte wende dich an die Schulverwaltung.";
    if(code==="over_email_send_rate_limit"||/email rate limit exceeded/.test(message))return "Die Registrierung ist derzeit durch ein Versandlimit blockiert. Bitte die Schulverwaltung informieren.";
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
      api.from("profiles").select("id,display_name,role,vote_eligible,school_verified_at").eq("id",id).single(),
      api.from("wallets").select("balance_cents").eq("user_id",id).single(),
      api.from("wallet_ledger").select("*").order("created_at",{ascending:false}).limit(60),
      api.from("cash_sales").select("*").order("created_at",{ascending:false}).limit(50),
      api.from("payment_requests").select("*").order("created_at",{ascending:false}).limit(50)
    ]);
    rows.forEach(function(row){if(row.error)throw row.error;});
    state.profile=rows[0].data;state.wallet=rows[1].data;state.ledger=rows[2].data||[];state.cash=rows[3].data||[];state.requests=rows[4].data||[];
    if(state.active)state.active=state.requests.find(function(x){return x.id===state.active.id;})||state.active;
    state.schoolRoles=await rpc("my_school_roles",{})||{operator:false,jobs:[]};
    state.users=state.profile.role==="admin"?await rpc("admin_list_users",{}):[];
    state.polls=await rpc("poll_catalog",{});
    state.pollResults=(state.profile.role==="admin"||state.schoolRoles?.operator)?await rpc("admin_poll_results",{}):[];
  }
  async function refresh(silent){
    if(!state.user||state.busy||state.scanning)return;
    var requestedPage=state.page;try{await fetchData();if(state.page===requestedPage&&(!silent||(!state.editing&&!document.querySelector("dialog[open]")&&["home","wallet","history","votes"].includes(state.page)))){var scroll=window.scrollY;render();if(silent)window.scrollTo(0,scroll);}}
    catch(e){if(!silent)fail(e);}
  }
  var groups=[
    ["Mein Bereich",["idcard","gallery","schoolverify","workhours","myjob","visa","wallet","pay","history"]],
    ["Schulleben",["bulletin","blog","events","lost"]],
    ["Organisation",["map","rooms","shops","shopmanage","jobs"]],
    ["Staat & Mitbestimmung",["votes","laws","parties","courts"]],
    ["Verwaltung",["register","admincredit","verifyadmin","attendance","roles","admin","settings"]]
  ];
  var descriptions={admincredit:"Schulwährung per Ausweis-QR gutschreiben",workhours:"Arbeitszeit 12.–16. Juli 2027 per QR-Code erfassen",roles:"Schulberufe und Operatorrechte vergeben",attendance:"Anwesenheit per Schülerausweis scannen",schoolverify:"QR-Code für die Prüfung vor Ort erstellen",verifyadmin:"Schüler vor Ort sicher bestätigen",home:"Dein persönlicher Überblick",idcard:"Deine persönliche Projektkarte",gallery:"Das passende Ausweisdesign wählen",visa:"Einreise beantragen und Status verfolgen",wallet:"Guthaben und Kontobewegungen",pay:"QR-Code scannen und Betrag prüfen",history:"Digitale Buchungen und Bargeld",bulletin:"Neuigkeiten aus unserem Schulstaat",blog:"Geschichten und Einblicke ins Projekt",events:"Termine entdecken und teilnehmen",lost:"Verlorenes suchen, Gefundenes melden",map:"Räume und Orte im Schulgebäude",rooms:"Räume für dein Vorhaben reservieren",shops:"Geschäfte und Kassen entdecken",jobs:"Aufgaben finden und sich bewerben",votes:"Gemeinsame Entscheidungen treffen",laws:"Regeln und Verordnungen nachlesen",parties:"Mitteilungen der Parteien",courts:"Öffentliche Gerichtsbekanntmachungen",register:"Verkäufe und QR-Zahlungen erfassen",admin:"Guthaben, Rollen und Stimmrecht verwalten",settings:"Profil, Passwort und Geräte"};
  var iconPaths={admincredit:"M12 2v20 M17 6H9a4 4 0 0 0 0 8h6a4 4 0 0 1 0 8H6",myjob:'M3 7h18v14H3z M8 7V3h8v4 M3 12h18',shopmanage:'M3 7h18 M5 7V4h14v3 M5 7v14h14V7 M9 12h6 M9 16h6',workhours:'M12 3v9l4 2 M21 12a9 9 0 1 1-9-9',roles:'M4 6h16 M4 12h16 M4 18h16 M6 8h3 M6 14h3',attendance:'M3 8V4h5 M16 4h5v4 M21 16v5h-5 M8 21H3v-5 M9 12l2 2 4-4',schoolverify:'M4 4h6v6H4z M14 4h6v6h-6z M4 14h6v6H4z M15 15h2 M20 16v4 M15 20h5',verifyadmin:'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M8 10h3v3H8z M14 10h2 M14 14h3 M8 16h3',home:'M3 10l9-7 9 7v11H3z M9 21v-8h6v8',idcard:'M3 5h18v14H3z M7 9h3v4H7z M14 9h4 M14 13h4 M7 16h11',gallery:'M4 4h16v16H4z M8 8h3v3H8z M4 16l5-4 4 3 3-2 4 3',visa:'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h3',wallet:'M3 6h17v14H3z M3 6V4h14 M15 11h6v5h-6z',pay:'M4 8V4h4 M16 4h4v4 M20 16v4h-4 M8 20H4v-4 M8 10h3v3H8z M14 10h2 M14 14h3 M8 16h3',history:'M3 11a9 9 0 1 1 2 7 M3 4v7h7 M12 7v5l3 2',bulletin:'M4 5h16v14H4z M8 9h8 M8 13h5 M8 19v3 M16 19v3',blog:'M5 3h14v18H5z M8 7h8 M8 11h8 M8 15h5',events:'M4 5h16v16H4z M8 3v4 M16 3v4 M4 10h16 M8 14h2 M14 14h2',lost:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M15 15l6 6 M7 10h6 M10 7v6',map:'M3 5l6-2 6 2 6-2v16l-6 2-6-2-6 2z M9 3v16 M15 5v16',rooms:'M5 3h14v18H5z M9 3v18 M14 12h1',shops:'M3 9l2-6h14l2 6 M3 9v3h18V9 M5 12v9h14v-9 M9 21v-6h6v6',jobs:'M3 7h18v14H3z M8 7V3h8v4 M3 12h18 M10 12v3h4v-3',votes:'M5 4h14v17H5z M8 8l2 2 5-5 M8 14h8 M8 17h5',laws:'M4 4h7v16H4z M13 4h7v16h-7z M7 8h1 M16 8h1',parties:'M8 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M2 21v-3a6 6 0 0 1 12 0v3 M16 4a4 4 0 0 1 0 8 M17 15a5 5 0 0 1 5 5',courts:'M12 3v18 M5 21h14 M4 6h16 M5 6l-3 8h6z M19 6l-3 8h6z',register:'M5 3h14v18H5z M8 6h8v4H8z M8 14h2 M14 14h2 M8 17h2 M14 17h2',settings:'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2',admin:'M12 3l8 3v6c0 5-8 9-8 9S4 17 4 12V6z M9 12l2 2 4-4',apps:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',search:'M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14 M15 15l6 6'};
  navs.push(["apps","Portal"],["admin","Administration"]);
  function icon(id){return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'+(iconPaths[id]||iconPaths.apps)+'"/></svg>';}
  function allowed(id){
    var administrator=state.profile&&state.profile.role==="admin";
    var operator=Boolean(state.schoolRoles?.operator);
    // Navigation is a convenience boundary; all privileged writes are checked by Supabase RPC/RLS.
    // Regular pupils see the everyday school-state features, not administration modules.
    var pupilPages=["home","apps","idcard","gallery","schoolverify","wallet","pay","history","shops","votes","lost","settings","workhours","myjob"];
    if(id==="admincredit"||id==="admin")return administrator;
    if(id==="register")return adminOrCashier();
    if(id==="verifyadmin"||id==="roles")return administrator||operator;
    if(id==="attendance")return administrator||operator||Boolean(state.schoolRoles?.can_check_attendance);
    if(id==="shopmanage")return administrator||operator||Boolean(state.schoolRoles?.jobs?.length);
    if(administrator||operator)return true;
    return pupilPages.includes(id);
  }
  function label(id){return (navs.find(function(n){return n[0]===id;})||[id,id])[1];}
  function navButton(id,mobile){return '<button type="button" class="'+(mobile?'bottom-button':'nav-button')+(state.page===id?' active':'')+'" data-nav="'+id+'"'+(state.page===id?' aria-current="page"':'')+'>'+icon(id)+'<span>'+esc(mobile?({home:"Start",apps:"Portal",pay:"Bezahlen",votes:"Abstimmen",settings:"Profil"}[id]||label(id)):label(id))+'</span></button>';}
  function nav(isMobile){
    if(isMobile)return ["home","apps","pay","votes","settings"].map(function(id){return navButton(id,true);}).join("");
    return navButton("home")+groups.map(function(g){return '<div class="nav-group"><div class="nav-kicker">'+g[0]+'</div>'+g[1].filter(allowed).map(function(id){return navButton(id);}).join("")+'</div>';}).join("");
  }
  function moduleGrid(){return groups.map(function(g){return '<section class="module-group" data-module-group><div class="section-heading"><h2>'+g[0]+'</h2></div><div class="module-grid">'+g[1].filter(allowed).map(function(id){return '<button type="button" class="module-tile" data-nav="'+id+'" data-module-search="'+esc((label(id)+' '+descriptions[id]).toLowerCase())+'"><span class="module-icon">'+icon(id)+'</span><span class="module-copy"><strong>'+esc(label(id))+'</strong><span>'+esc(descriptions[id])+'</span></span><span class="module-arrow" aria-hidden="true">→</span></button>';}).join("")+'</div></section>';}).join("");}
  function appDirectory(){return header("DEIN SCHULSTAAT","Alles an einem Ort.","Wähle den Bereich, den du gerade brauchst.")+moduleGrid();}
  function searchDialog(){return '<dialog id="portal-search" aria-labelledby="portal-search-title"><div class="dialog-head"><h2 id="portal-search-title">Bereich öffnen</h2><button type="button" class="icon-btn" data-action="close-search" aria-label="Suche schließen">×</button></div><label class="search-field">'+icon("search")+'<input id="module-query" type="search" placeholder="Ausweis, Raum, Veranstaltung …" autocomplete="off" aria-label="Bereiche durchsuchen"></label><div class="dialog-results">'+moduleGrid()+'<p class="empty search-empty" hidden>Kein passender Bereich. Versuche einen anderen Suchbegriff.</p></div></dialog>';}
  function mount(content){
    var first=(state.profile&&state.profile.display_name||"S").slice(0,2).toUpperCase();
    root.innerHTML='<a class="skip-link" href="#main-content">Zum Inhalt</a><div class="app-shell"><aside class="sidebar"><a class="brand" href="#home" data-nav="home" aria-label="Schule als Staat – Übersicht"><div class="brand-mark">S/S</div><div><div class="brand-name">Schule als Staat</div><div class="brand-sub">Dein digitaler Schulstaat</div></div></a><nav class="nav-links" aria-label="Hauptnavigation">'+nav(false)+'</nav><div class="sidebar-foot"><button class="sidebar-profile" data-nav="settings"><span class="avatar">'+esc(first)+'</span><span><strong>'+esc(state.profile.display_name)+'</strong><small>'+roleLabel()+'</small></span></button><a class="project-social" href="https://www.instagram.com/schule.als.staat_rng/" target="_blank" rel="noopener noreferrer">Projekt auf Instagram ↗</a></div></aside><div class="main-area"><header class="topbar"><div class="topbar-left">Schule als Staat <span aria-hidden="true">/</span> <b>'+esc(label(state.page))+'</b></div><div class="topbar-right"><button class="search-trigger" data-action="open-search" aria-label="Alle Bereiche durchsuchen">'+icon("search")+'<span>Bereich suchen</span><kbd>⌘ K</kbd></button><button class="profile-trigger" data-nav="settings" aria-label="Profil öffnen"><span class="avatar">'+esc(first)+'</span></button></div></header><main class="content" id="main-content" tabindex="-1">'+content+'</main><footer class="page-footer">Schule als Staat <span>Gemeinsam gestalten.</span></footer></div><nav class="bottom-nav" aria-label="Mobile Hauptnavigation">'+nav(true)+'</nav></div>'+searchDialog();
    if(state.page==="register")renderQRCode();
  }
  function setup(){
    root.innerHTML='<div class="app-shell"><aside class="sidebar"><div class="brand"><div class="brand-mark">S/S</div><div><div class="brand-name">Schule als Staat</div><div class="brand-sub">SCHULE ALS STAAT</div></div></div><div class="sidebar-foot"><span class="status"><i class="dot"></i> Backend nicht verbunden</span></div></aside><div class="main-area"><header class="topbar"><div>Schule als Staat / Einrichtung</div><span class="pill">V4</span></header><main class="content">'+header("PROJEKTSTATUS","V4 ist vorbereitet.","Die Anwendung braucht für mehrere Geräte eine sichere Datenbankverbindung.")+'<div class="grid two"><section class="card"><h2>Produktivsystem einrichten</h2><div class="divider"></div><p class="details">1. Supabase-Projekt anlegen.<br>2. Datei supabase/schema.sql ausführen.<br>3. Projekt-URL und Publishable Key in config.js eintragen.<br>4. E-Mail-Login und Redirect-URL konfigurieren.<br>5. Benutzerrollen vergeben und Testzahlung durchführen.</p>'+info("Ohne Backend werden bewusst keine erfolgreichen Zahlungen oder Kontostände vorgetäuscht.",true)+'<a class="btn primary" target="_blank" rel="noopener noreferrer" href="https://supabase.com/dashboard">Supabase öffnen</a></section><section class="card"><h2>Kamera-Diagnose</h2><div class="divider"></div><p class="details">Die Kameraberechtigung wird nur nach deiner Aktion angefragt. Test-Video wird nicht gespeichert.</p>'+btn("Kamerazugriff testen","camera-test")+'<p class="field-help">Für Smartphone-Kameras wird eine direkte HTTPS-Seite benötigt.</p></section></div></main></div></div>';
  }
  function login(){
    root.innerHTML='<div class="welcome"><section class="welcome-left"><div class="brand" style="padding:0"><div class="brand-mark">S/S</div><div><div class="brand-name" >Schule als Staat</div><div class="brand-sub" >SCHULE ALS STAAT</div></div></div><div><div class="eyebrow" >DEIN DIGITALER SCHULSTAAT</div><div class="welcome-hero">Gemeinsam<br>Staat machen.<br><span>Einfach digital.</span></div><p class="welcome-sub">Dein Ausweis, gemeinsame Entscheidungen, Veranstaltungen und alles für den Schulalltag. An einem Ort.</p></div><div class="small" >Schule als Staat · Gemeinsam gestalten.</div><a href="https://www.instagram.com/schule.als.staat_rng/" class="project-social" target="_blank" rel="noopener noreferrer" aria-label="Schule als Staat auf Instagram öffnen">Instagram · @schule.als.staat_rng ↗</a></section><section class="welcome-side"><div class="login-box">'+header("WILLKOMMEN","Jetzt anmelden.","Melde dich mit E-Mail-Adresse und Passwort an oder erstelle ein neues Konto.")+'<form id="password-login-form"><div class="form-group"><label for="account-email">E-Mail-Adresse</label><input class="field" type="email" autocomplete="username" name="email" id="account-email" placeholder="name@schule.de" required></div><div class="form-group"><label for="account-password">Passwort</label><input class="field" type="password" autocomplete="current-password" name="password" id="account-password" minlength="6" required></div><button type="submit" class="btn primary full">Mit Passwort anmelden</button></form><details class="alternate-auth" open><summary>Neu hier? Kostenloses Konto erstellen</summary><p class="field-help">Einmal registrieren und sofort anmelden. Für den Testbetrieb ist keine Bestätigungs-E-Mail nötig.</p><form id="signup-form"><div class="form-group"><label for="signup-name">Name oder Testname (optional)</label><input class="field" type="text" autocomplete="name" name="display_name" id="signup-name" maxlength="80" placeholder="z. B. Alex Muster"></div><div class="form-group"><label for="signup-class">Klasse (optional)</label><input class="field" type="text" name="class_label" id="signup-class" maxlength="24" placeholder="z. B. 10a"></div><div class="form-group"><label for="signup-email">E-Mail-Adresse</label><input class="field" type="email" autocomplete="email" name="email" id="signup-email" placeholder="name@schule.de" required></div><div class="form-group"><label for="signup-password">Neues Passwort (mindestens 12 Zeichen)</label><input class="field" type="password" autocomplete="new-password" name="password" id="signup-password" minlength="12" required></div><div class="form-group"><label for="signup-repeat">Passwort wiederholen</label><input class="field" type="password" autocomplete="new-password" name="repeat" id="signup-repeat" minlength="12" required></div><p id="signup-feedback" class="field-help" role="alert" aria-live="polite"></p><button type="submit" class="btn dark full">Konto erstellen</button></form></details><details class="alternate-auth"><summary>Passwort vergessen?</summary><p class="field-help">Für ein bestehendes Konto erhältst du einen Link, mit dem du selbst ein neues Passwort festlegen kannst. Je nach kostenlosem E-Mail-Limit kann der Versand verzögert sein.</p><form id="password-reset-request-form"><div class="form-group"><label for="password-reset-email">E-Mail-Adresse</label><input class="field" type="email" autocomplete="email" name="email" id="password-reset-email" placeholder="name@schule.de" required></div><button type="submit" class="btn dark full">Passwort-Link anfordern</button></form></details><p class="login-footer">Nur für berechtigte Teilnehmer. Gib dein Passwort niemals an andere weiter. Guthaben stellt kein Echtgeld dar.</p></div></section></div>';
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
    var open=(state.polls||[]).filter(function(p){return p.status==="open"&&!p.has_voted;}).length;
    var dateLabel=new Intl.DateTimeFormat("de-DE",{weekday:"long",day:"numeric",month:"long"}).format(new Date());
    return '<div class="dashboard-intro"><div>'+header(dateLabel,"Guten Tag, "+esc(state.profile.display_name)+".","Dein Schulstaat. Deine Möglichkeiten.")+'</div><span class="live-label"><i class="dot connected"></i> Live-Daten</span></div>'+
      '<div class="overview-grid"><section class="card overview-card"><div class="card-header"><span class="module-icon">'+icon("idcard")+'</span><span class="pill">Persönlich</span></div><h2>Dein Schülerausweis</h2><p class="details">Deine Projektkarte und dein Lieblingsdesign.</p><button class="btn" data-nav="idcard">Ausweis öffnen <span aria-hidden="true">→</span></button></section><section class="card overview-card balance-card"><div class="card-header"><span class="module-icon">'+icon("wallet")+'</span><span class="pill">Schulwährung</span></div><div class="stat-label">Dein Guthaben</div><div class="stat-value">'+cashFmt(state.wallet.balance_cents)+'</div><p class="stat-caption">Interne Einheiten · kein Echtgeld</p><button class="btn primary" data-nav="pay">'+icon("pay")+' Bezahlen</button></section><section class="card overview-card"><div class="card-header"><span class="module-icon">'+icon("votes")+'</span><span class="pill">Mitgestalten</span></div><h2>'+open+' offene Abstimmung'+(open===1?'':'en')+'</h2><p class="details">'+(open?'Deine Stimme macht einen Unterschied.':'Hier findest du gemeinsame Entscheidungen.')+'</p><button class="btn" data-nav="votes">Zu den Abstimmungen <span aria-hidden="true">→</span></button></section></div>'+
      '<div class="section-heading"><div><h2>Entdecke dein Portal</h2><p>Alles, was unseren Schulstaat verbindet.</p></div><button class="btn subtle" data-nav="apps">Alle Bereiche →</button></div><div class="home-modules">'+["bulletin","events","map","rooms","lost","blog"].map(function(id){return '<button class="module-tile" data-nav="'+id+'"><span class="module-icon">'+icon(id)+'</span><span class="module-copy"><strong>'+esc(label(id))+'</strong><span>'+esc(descriptions[id])+'</span></span><span class="module-arrow" aria-hidden="true">→</span></button>';}).join("")+'</div><div class="section-heading"><h2>Letzte Kontobewegungen</h2><button class="btn subtle" data-nav="wallet">Zum Konto →</button></div><section class="card">'+latest(4)+'</section>';
  }
  function wallet(){
    return header("DEIN KONTO","Mein Guthaben.","Alle deine digitalen Zahlungen auf einen Blick.")+'<div class="grid two"><section class="card ink"><div class="stat-label">Verfügbares Guthaben</div><div class="stat-value">'+cashFmt(state.wallet.balance_cents)+'</div><div class="stat-caption">Interne Schulwährung, kein Echtgeld</div></section><section class="card"><h2>Digital bezahlen</h2><p class="details" style="margin:17px 0">Du scannst den QR-Code einer Kasse, kontrollierst den Betrag und bestätigst selbst. Bargeld wird getrennt verbucht.</p>'+btn("Zum QR-Scanner","to-pay")+'</section></div><h2 class="section-title">Kontobewegungen</h2><section class="card">'+latest()+'</section>';
  }
  function invoiceCard(){
    var r=state.invoice;if(!r)return "";
    return '<section class="card" style="margin-top:20px"><div class="card-header"><h2>Zahlung prüfen</h2><span class="pill blue">Freigabe erforderlich</span></div><div class="confirm-line"><span>Empfänger</span><b>'+esc(r.cashier_name)+'</b></div><div class="confirm-line"><span>Beschreibung</span><b>'+esc(r.note||"Kassenzahlung")+'</b></div><div class="divider"></div><p class="small muted">Betrag</p><div class="fancy-number">'+cashFmt(r.amount_cents)+'</div><p class="details" style="margin-top:14px">Dieser Betrag wird von deinem digitalen Guthaben abgebucht. Prüfe den Empfänger.</p><div class="button-row">'+btn("Zahlung verbindlich bestätigen","confirm")+' '+btn("Abbrechen","cancel","")+'</div></section>';
  }
  function pay(){
    return header("QR-ZAHLUNG","Digital bezahlen.","Scanne den QR-Code einer Kasse. Du bestätigst den Betrag immer selbst.")+
      '<div class="grid two"><section class="card"><div class="card-header"><h2>QR-Code scannen</h2><span class="pill">Kamera</span></div><div class="reader" id="qr-reader">'+empty("Die Kamera startet erst nach deiner Freigabe.")+'</div><div class="scan-actions">'+btn("Kamera starten","scan-start")+' '+btn("Stoppen","scan-stop","")+' <label class="btn" for="scan-file">QR-Bild wählen</label><input id="scan-file" type="file" accept="image/*" style="position:absolute;width:1px;height:1px;opacity:0"></div><p class="field-help">HTTPS erforderlich. Bei gesperrter Kamera kannst du den Link oder ein QR-Bild verwenden.</p></section><section class="card"><div class="card-header"><h2>Ohne Kamera</h2><span class="pill">Alternative</span></div><form id="manual-form"><div class="form-group"><label for="code">Link oder QR-Code</label><input class="field" id="code" name="code" required placeholder="Zahlungslink oder NV-PAY:…"><p class="field-help">Zahlungslinks lassen sich direkt auf dem Smartphone öffnen.</p></div><button type="submit" class="btn dark full">Zahlung öffnen</button></form>'+info("Keine Videos werden gespeichert. Die Kamera wird beim Verlassen der Ansicht beendet.")+'</section></div>'+invoiceCard();
  }
  function activeCard(){
    if(!state.active)return "";
    var r=state.active,paid=r.status==="paid";
    var link=paymentURL(r.id);
    return '<section class="card" style="margin-top:20px"><div class="card-header"><h2>Aktuelle Zahlungsanforderung</h2><span class="pill '+(paid?"green":"blue")+'">'+(paid?"Bezahlt":"Offen")+'</span></div><div class="grid two"><div class="code-panel"><div id="qr-output"></div><div class="code-ref">'+esc(link)+'</div></div><div><p class="small muted">Angeforderter Betrag</p><div class="fancy-number">'+cashFmt(r.amount_cents)+'</div><p class="details" style="margin-top:14px">Zweck: '+esc(r.note||"Kassenzahlung")+'<br>Gültig bis '+time(r.expires_at)+'</p>'+info(paid?"Betrag digital gutgeschrieben.":"Kunde scannt und bestätigt auf seinem eigenen Gerät.")+'<div class="button-row">'+btn("Link kopieren","copy","")+' '+btn("Aktualisieren","reload","")+'</div></div></div></section>';
  }
  function register(){
    return header("KASSENPLATZ","Zahlungen annehmen.","Digitale und Bargeldumsätze sind vollständig getrennt.")+
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
    return header("BUCHUNGEN","Verlauf.","Digitale Transaktionen und Bargeldumsätze sind separat dokumentiert.")+
      '<section class="card"><div class="card-header"><h2>Digitales Konto</h2>'+btn("Aktualisieren","reload","")+'</div>'+ledger+'</section>'+
      (adminOrCashier()?'<h2 class="section-title">Bargeldumsätze</h2><section class="card">'+(cashRows?'<div class="table-wrap"><table class="simple-table"><thead><tr><th>Zeit</th><th>Beschreibung</th><th>Betrag</th></tr></thead><tbody>'+cashRows+'</tbody></table></div>':empty("Keine Bargeldumsätze."))+'</section><h2 class="section-title">QR-Anforderungen</h2><section class="card">'+(reqRows?'<div class="list">'+reqRows+'</div>':empty("Keine QR-Anforderungen."))+'</section>':"");
  }
  function votesPage(){
    var polls=state.polls||[];
    var enabled=Boolean(state.profile.vote_eligible);
    var admin=state.profile.role==="admin"||Boolean(state.schoolRoles?.operator);
    var notice=enabled?"":info("Für eine gültige Stimme muss die Schule dein Benutzerkonto zuerst freischalten. So werden unberechtigte Mehrfachkonten begrenzt.",true);
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
        return '<section class="card"><div class="card-header"><h2>'+esc(p.title)+'</h2><span class="pill '+(p.status==="open"?"blue":"")+'">'+(p.status==="open"?"Live":"Beendet")+'</span></div><p class="details">'+total+' abgegebene Stimme'+(total===1?"":"n")+'</p>'+data+'<div class="poll-footer">'+(p.status==="open"?'<button type="button" class="btn" data-action="close-poll" data-poll-id="'+esc(p.id)+'">Abstimmung schließen</button>':"")+'</div></section>';
      }).join("");
      adminResults='<h2 class="section-title">Live-Auswertung · Verwaltung</h2><p class="details">Aggregierte Stimmen, automatische Aktualisierung etwa alle 6 Sekunden. Keine einzelnen Stimmzettel werden hier angezeigt.</p><div class="grid two">'+(cards||empty("Noch keine Abstimmungen vorhanden."))+'</div>'+
        '<h2 class="section-title">Neue Abstimmung erstellen</h2><section class="card"><form id="poll-create"><div class="form-group"><label for="poll-title">Frage oder Abstimmungstitel</label><input class="field" id="poll-title" name="title" maxlength="160" required placeholder="Wie soll unser Schulstaat heißen?"></div><div class="form-group"><label for="poll-description">Beschreibung (optional)</label><input class="field" id="poll-description" name="description" maxlength="500" placeholder="Wähle deinen Favoriten."></div><div class="form-group"><label for="poll-options">Antwortmöglichkeiten · eine pro Zeile (2–10)</label><textarea class="field poll-textarea" id="poll-options" name="options" rows="5" required placeholder="Vorschlag A&#10;Vorschlag B&#10;Vorschlag C"></textarea><p class="field-help">Die Antwortmöglichkeiten stehen nach Veröffentlichung fest. Bitte vorab prüfen.</p></div><button type="submit" class="btn primary">Abstimmung veröffentlichen</button></form></section>';
    }
    return header("MITBESTIMMUNG","Abstimmungen.","Der Name unseres Schulstaats steht noch nicht fest. Darüber und über weitere Entscheidungen stimmen wir gemeinsam ab.")+
      notice+'<h2 class="section-title">Unsere zwei Wettbewerbe</h2><div class="grid two"><section class="card poll-card"><div class="card-header"><h2>Staatsname</h2><span class="pill">Vorbereitung</span></div><p class="details">Hier stimmen wir über die eingereichten Namensvorschläge ab. Die Kandidaten werden noch ergänzt.</p><p class="field-help">Noch keine Abstimmung möglich.</p></section><section class="card poll-card"><div class="card-header"><h2>Staatsflagge</h2><span class="pill">Vorbereitung</span></div><p class="details">Hier erscheinen die Flaggenentwürfe mit ihren Bildern. Die Bilder und Kandidaten werden später ergänzt.</p><p class="field-help">Noch keine Abstimmung möglich.</p></section></div><h2 class="section-title">Weitere Abstimmungen</h2><div class="grid two">'+(blocks||'<section class="card">'+empty("Noch keine weiteren Abstimmungen veröffentlicht.")+'</section>')+'</div>'+adminResults;
  }
  function settingsPage(){
    var memberOptions=(state.users||[]).map(function(u){return '<option value="'+esc(u.id)+'">'+esc(u.name)+' ('+esc(u.role)+')</option>';}).join("");
    var adminPanel=state.profile.role!=="admin"?"":'<h2 class="section-title">Administration</h2><div class="grid two"><section class="card"><div class="card-header"><h2>Guthaben ausgeben</h2><span class="pill blue">Nur Admin</span></div><form id="credit-form"><div class="form-group"><label for="credit-user">Mitglied</label><select id="credit-user" name="user_id" class="field" required>'+memberOptions+'</select></div><div class="form-group"><label for="credit-amount">Betrag in '+esc(units)+'</label><input id="credit-amount" name="amount" class="field" type="number" min=".01" max="10000" step=".01" required></div><div class="form-group"><label for="credit-note">Grund</label><input class="field" id="credit-note" name="note" maxlength="140" placeholder="z. B. Startguthaben"></div><button class="btn primary full" type="submit">Guthaben zuweisen</button></form><p class="field-help">Jede Ausgabe wird im digitalen Buchungsverlauf dokumentiert.</p></section><section class="card"><div class="card-header"><h2>Kassenberechtigung</h2><span class="pill">Rollen</span></div><form id="permission-form"><div class="form-group"><label for="permission-user">Mitglied</label><select class="field" id="permission-user" name="user_id" required>'+memberOptions+'</select></div><div class="form-group"><label for="permission-role">Berechtigung</label><select class="field" id="permission-role" name="enabled"><option value="true">Kassenpersonal</option><option value="false">Normales Mitglied</option></select></div><button class="btn dark full" type="submit">Berechtigung speichern</button></form><p class="field-help">Administratorrollen können hier nicht vergeben oder entfernt werden.</p></section></div>';
    var approvePanel=state.profile.role==="admin"?'<h2 class="section-title">Stimmberechtigungen</h2><section class="card"><h2>Teilnahme freischalten</h2><p class="details" style="margin-top:12px">Prüfe vor Freigabe anhand der Schulunterlagen, dass genau eine Person hinter dem Benutzerkonto steht.</p><form id="vote-permission-form"><div class="form-group"><label for="vote-user">Nutzer</label><select class="field" id="vote-user" name="user_id" required>'+(state.users||[]).map(function(u){return '<option value="'+esc(u.id)+'">'+esc(u.name)+' · '+esc(u.email||"ohne E-Mail")+(u.vote_eligible?" · freigegeben":" · gesperrt")+'</option>';}).join("")+'</select></div><div class="form-group"><label for="vote-permission">Stimmrecht</label><select class="field" id="vote-permission" name="enabled"><option value="true">Freigeben</option><option value="false">Sperren</option></select></div><button type="submit" class="btn dark">Berechtigung speichern</button></form><p class="field-help">Eine nachträgliche Sperre löscht keine bereits abgegebenen Stimmen.</p></section>':"";
    if(state.page==="admin")return header("VERWALTUNG","Administration.","Guthaben, Rollen und Stimmrecht für unseren Schulstaat verwalten.")+adminPanel+approvePanel;
    return header(state.page==="admin"?"VERWALTUNG":"MEIN BEREICH",state.page==="admin"?"Administration.":"Einstellungen.",state.page==="admin"?"Berechtigungen und Guthaben für unseren Schulstaat verwalten.":"Dein Profil, dein Passwort und deine Geräte.")+
      '<section class="card"><div class="card-header"><h2>Die Webseite kennenlernen</h2><span class="pill blue">Interaktiv</span></div><p class="details">Für neue Schüler: Ein interaktiver Rundgang führt dich direkt durch die wichtigsten Bereiche der App – ohne Eingaben.</p><button class="btn" type="button" data-action="restart-tutorial">Einführung starten oder wiederholen</button></section>'+ 
      '<div class="grid two"><section class="card"><h2>Benutzerkonto</h2><div class="divider"></div><div class="settings-row"><div><strong>Name</strong><p>'+esc(state.profile.display_name)+'</p></div></div><div class="settings-row"><div><strong>E-Mail</strong><p>'+esc(state.user.email)+'</p></div></div><div class="settings-row"><div><strong>Rolle</strong><p>'+roleLabel()+'</p></div></div><div class="divider"></div>'+btn("Abmelden","logout","")+'</section><section class="card"><h2>Kameraberechtigung</h2><div class="divider"></div><p class="details">HTTPS-Status: '+(window.isSecureContext?"Sicherer Kontext":"Unsicherer Kontext")+'. Kamera wird nur auf deinen Wunsch aktiviert und niemals aufgezeichnet.</p>'+btn("Kamerazugriff testen","camera-test")+'<div class="divider"></div><p class="details">Kontoeinheit: '+esc(units)+'. Kein Bank- oder Echtgeldsystem.</p></section></div>'+'<section class="card" style="margin-top:20px"><h2>Passwort ändern</h2><p class="field-help">Wähle ein individuelles, mindestens 12 Zeichen langes Passwort. Deine aktuelle Anmeldung muss gültig sein.</p><form id="password-change-form"><div class="form-group"><label for="change-pw">Neues Passwort</label><input class="field" type="password" autocomplete="new-password" id="change-pw" name="password" minlength="12" required></div><div class="form-group"><label for="change-pw-repeat">Passwort wiederholen</label><input class="field" type="password" autocomplete="new-password" id="change-pw-repeat" name="repeat" minlength="12" required></div><button type="submit" class="btn dark">Passwort aktualisieren</button></form></section>'+(state.page==="admin"?adminPanel+approvePanel:"");
  }
  function passwordRecoveryView(){
    return '<section class="welcome-side" style="max-width:560px;margin:48px auto"><div class="login-box">'+header("KONTO SICHERN","Neues Passwort festlegen.","Du hast einen Wiederherstellungslink geöffnet. Wähle jetzt ein eigenes Passwort.")+'<form id="password-recovery-form"><div class="form-group"><label for="recovery-pw">Neues Passwort (mindestens 12 Zeichen)</label><input class="field" type="password" autocomplete="new-password" id="recovery-pw" name="password" minlength="12" required></div><div class="form-group"><label for="recovery-pw-repeat">Passwort wiederholen</label><input class="field" type="password" autocomplete="new-password" id="recovery-pw-repeat" name="repeat" minlength="12" required></div><button type="submit" class="btn primary full">Neues Passwort speichern</button></form></div></section>';
  }
  function render(){
    state.editing=false;
    if(!api)return setup();
    if(state.recovering&&state.user){root.innerHTML=passwordRecoveryView();return;}
    if(!state.user)return login();
    if(!state.profile||!state.wallet){root.textContent="Profil oder Guthaben konnte nicht geladen werden. Bitte Zugang und Datenbankkonfiguration prüfen.";return;}
    var views={home:dashboard,wallet:wallet,pay:pay,register:register,history:history,votes:votesPage,settings:settingsPage,apps:appDirectory,admin:settingsPage};
    if(!allowed(state.page)){state.page="home";}
    if(window.SAS_VERIFICATION&&window.SAS_VERIFICATION.pages[state.page]){
      if(!allowed(state.page)){state.page="home";mount(dashboard());return;}
      mount('<div id="sas-school-verification" role="region" aria-label="'+esc(window.SAS_VERIFICATION.pages[state.page])+'"></div>');
      window.SAS_VERIFICATION.show({api:api,user:state.user,profile:state.profile,schoolRoles:state.schoolRoles,page:state.page,target:document.getElementById("sas-school-verification")}).catch(fail);
      return;
    }
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
      window.SAS_FEATURES.show({api:api,user:state.user,profile:state.profile,schoolRoles:state.schoolRoles,page:state.page,target:document.getElementById("sas-live-module"),navigate:navigate}).catch(fail);
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
  async function navigate(id){if(state.busy||(window.SAS_FEATURES&&window.SAS_FEATURES.isBusy())){showToast("Bitte warte, bis die Änderung gespeichert ist.");return;}if(!allowed(id))return;await stopScanner();if(window.SAS_VERIFICATION)await window.SAS_VERIFICATION.stop();if(window.SAS_ATTENDANCE)await window.SAS_ATTENDANCE.stop();if(window.SAS_WORK_HOURS)await window.SAS_WORK_HOURS.stop();state.page=id;state.editing=false;render();if(["home","wallet","history","votes"].includes(id))void refresh(true);window.scrollTo(0,0);var main=document.getElementById("main-content");if(main)main.focus({preventScroll:true});}
  window.SAS_TUTORIAL_NAV=function(page){if(allowed(page))void navigate(page);};
  async function action(id,pollId){
    if(state.busy)return;
    try{
      if(id==="open-search"){document.getElementById("portal-search").showModal();return;}
      if(id==="close-search"){document.getElementById("portal-search").close();return;}
      if(id.indexOf("to-")===0)return await navigate(id.slice(3));
      if(id==="camera-test")return await cameraTest();
      if(id==="restart-tutorial"&&window.SAS_TUTORIAL)return await window.SAS_TUTORIAL.reopen(api,state.user.id);
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
      if(id==="reload"){await refresh();showToast("Aktualisiert.");return;}
      if(id==="logout"){if(window.SAS_TUTORIAL)window.SAS_TUTORIAL.logout();await stopScanner();if(window.SAS_VERIFICATION)await window.SAS_VERIFICATION.stop();if(window.SAS_ATTENDANCE)await window.SAS_ATTENDANCE.stop();var o=await api.auth.signOut();if(o.error)throw o.error;return;}
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
      if(form.id==="sas-myjob-form"){
        var chosen=String(data.get("title")||"").trim();
        await rpc("set_my_school_job_title",{p_title:chosen});
        var jobStatus=document.getElementById("sas-myjob-status");if(jobStatus)jobStatus.textContent="Beruf gespeichert – ohne zusätzliche Berechtigungen.";
        showToast("Berufsbezeichnung gespeichert.");
        return;
      }
      if(form.id==="password-reset-request-form"){
        var resetEmail=String(data.get("email")||"").trim();
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
      if(form.id==="signup-form"){
        var feedback=form.querySelector("#signup-feedback");
        if(feedback){feedback.textContent="";feedback.className="field-help";}
        var newEmail=String(data.get("email")||"").trim().toLowerCase();
        var newPass=String(data.get("password")||"");
        if(newPass.length<12)throw Error("Bitte mindestens 12 Zeichen als Passwort verwenden.");
        if(newPass!==String(data.get("repeat")||""))throw Error("Die Passwörter stimmen nicht überein.");
        var displayName=String(data.get("display_name")||"").trim().slice(0,80);
        var classLabel=String(data.get("class_label")||"").trim().slice(0,24);
        var created=await api.auth.signUp({email:newEmail,password:newPass,options:{data:{full_name:displayName,class_label:classLabel}}});
        if(signupAccountExists(created)){
          if(feedback){
            feedback.textContent="Konto bereits vergeben. Bitte melde dich an oder verwende „Passwort vergessen?“.";
            feedback.className="info error";
          }
          return;
        }
        if(created.error)throw created.error;
        var signUpSession=created.data&&created.data.session||null;
        // If the service has returned a user without a session, attempt the
        // ordinary password login once. Never send another signup request.
        if(!signUpSession){
          var signedIn=await api.auth.signInWithPassword({email:newEmail,password:newPass});
          if(signedIn.error){
            if(feedback){
              feedback.textContent="Das Konto konnte nicht sofort angemeldet werden: "+friendlyAuthError(signedIn.error);
              feedback.className="info error";
            }
            return;
          }
          signUpSession=signedIn.data&&signedIn.data.session||null;
        }
        if(!signUpSession||!signUpSession.user)throw Error("Es wurde keine gültige Anmeldung zurückgegeben. Bitte versuche die normale Anmeldung.");
        state.user=signUpSession.user;
        await claimDesignatedAdmin();
        await fetchData();
        state.page="home";
        render();
        showToast("Konto erfolgreich erstellt. Willkommen bei Schule als Staat!");
      }
      if(form.id==="password-login-form"){
        var response=await api.auth.signInWithPassword({
          email:String(data.get("email")||"").trim(),
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
      if(form.id==="vote-form"){
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
    var target=e.target.closest("[data-nav],[data-action]");
    if(!target)return;
    e.preventDefault();
    if(target.dataset.nav)void navigate(target.dataset.nav);
    else void action(target.dataset.action,target.dataset.pollId);
  });
  root.addEventListener("submit",function(e){e.preventDefault();void handleForm(e.target);});
  root.addEventListener("change",function(e){
    state.editing=true;
    if(e.target.id==="scan-file"&&e.target.files&&e.target.files[0])void scanFile(e.target.files[0]).catch(fail);
  });
  root.addEventListener("input",function(e){
    if(e.target.id!=="module-query"){state.editing=true;return;}
    var q=e.target.value.trim().toLocaleLowerCase("de");
    var dialog=document.getElementById("portal-search"),count=0;
    dialog.querySelectorAll("[data-module-search]").forEach(function(el){el.hidden=!el.dataset.moduleSearch.includes(q);if(!el.hidden)count++;});
    dialog.querySelectorAll("[data-module-group]").forEach(function(el){el.hidden=!Array.from(el.querySelectorAll("[data-module-search]")).some(function(t){return !t.hidden;});});
    dialog.querySelector(".search-empty").hidden=count>0;
  });
  document.addEventListener("keydown",function(e){if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==="k"&&state.user){e.preventDefault();var d=document.getElementById("portal-search");if(d){if(d.open)d.close();else d.showModal();}}});
  document.addEventListener("visibilitychange",function(){if(document.hidden)void stopScanner();});
  window.addEventListener("pagehide",function(){void stopScanner();});
  setInterval(function(){var a=document.activeElement;if(a&&/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))return;if(state.user&&["home","wallet","history","votes"].includes(state.page)&&!state.editing&&!document.hidden&&!state.busy&&!state.scanning&&!document.querySelector("dialog[open]"))void refresh(true);},5500);
  async function start(){
    if(!api)return render();
    var session=await api.auth.getSession();
    if(session.error)throw session.error;
    state.user=session.data.session&&session.data.session.user||null;
    if(state.user){await claimDesignatedAdmin();await fetchData();}

    render();
    if(state.user&&window.SAS_TUTORIAL)void window.SAS_TUTORIAL.start(api,state.user.id);
    if(deepLink&&state.user){try{await openInvoice(deepLink);}catch(e){fail(e);}}
    api.auth.onAuthStateChange(function(event,session){
      var next=session&&session.user||null;
      if(event==="PASSWORD_RECOVERY"){
        state.recovering=true;
        state.user=next;
        render();
        return;
      }
      if(next&&state.user&&next.id===state.user.id)return;
      state.user=next;state.profile=null;state.wallet=null;state.ledger=[];state.cash=[];state.requests=[];state.users=[];state.polls=[];state.pollResults=[];state.schoolRoles={operator:false,jobs:[]};state.active=null;state.invoice=null;
      if(window.SAS_TUTORIAL)window.SAS_TUTORIAL.logout();
      void stopScanner().then(async function(){
        try{if(state.user){await claimDesignatedAdmin();await fetchData();}render();if(state.user&&window.SAS_TUTORIAL)void window.SAS_TUTORIAL.start(api,state.user.id);if(deepLink&&state.user)await openInvoice(deepLink);}
        catch(e){fail(e);render();}
      });
    });
  }
  void start().catch(function(e){root.textContent="Start fehlgeschlagen: "+String(e&&e.message||e);});
})();
