/* SaS: personal physical ID orders, 3-layer 3MF, no student data in source. */
(function(){"use strict";
const W=214,H=135,P=.4,labels={vorgemerkt:"Vorgemerkt",in_produktion:"In Produktion",fertig:"Abholbereit",ausgegeben:"Ausgegeben",storniert:"Storniert"};
const colors=["#e3eeff","#ffffff","#152941"];
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
let host,api,profile,info,qr,pixels,verified=false,orders=[];
async function call(name,args={}){const r=await api.rpc(name,args);if(r.error)throw r.error;return r.data;}
function message(s,bad){const el=host?.querySelector("#cardshop-message");if(el){el.textContent=s;el.className="sas-feedback"+(bad?" error":"");}}
function maskInside(x,y){const r=8;if(x>=r&&x<W-r||y>=r&&y<H-r)return true;const xx=x<r?r-.5:W-r-.5,yy=y<r?r-.5:H-r-.5;return (x-xx)**2+(y-yy)**2<r*r;}
function getMatrix(code){
 if(!/^SAS-ID:[a-f0-9]{16}$/.test(code))throw Error("Ungültiger Druck-QR-Code.");
 if(!window.QRCode)throw Error("QR-Code-Bibliothek nicht verfügbar.");
 const el=document.createElement("div");el.style.position="fixed";el.style.left="-9999px";document.body.append(el);
 try{const q=new QRCode(el,{text:code,width:264,height:264,correctLevel:QRCode.CorrectLevel.M});
  if(!q._oQRCode?.modules||q._oQRCode.modules.length>33)throw Error("Die QR-Matrix ist nicht druckgeeignet.");
  return q._oQRCode.modules.map(row=>row.map(Boolean));
 }finally{el.remove();}
}
function makePixels(){
 const a=new Uint8Array(W*H);for(let y=0;y<H;y++)for(let x=0;x<W;x++)a[y*W+x]=maskInside(x,y)?0:255;
 const n=qr.length,q=(n+8)*2,x=W-q-8,y=H-q-13;
 if(x<125||y<18)throw Error("QR-Code zu groß.");
 for(let j=0;j<q;j++)for(let i=0;i<q;i++)a[(y+j)*W+x+i]=1;
 for(let j=0;j<n;j++)for(let i=0;i<n;i++)if(qr[j][i])for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++)a[(y+(j+4)*2+yy)*W+x+(i+4)*2+xx]=2;
 const c=document.createElement("canvas");c.width=W;c.height=H;const g=c.getContext("2d",{willReadFrequently:true});
 g.fillStyle="#000";g.textBaseline="alphabetic";
 function text(s,px,py,size,bold,max){s=String(s||"");let z=size;g.font=(bold?"bold ":"")+z+"px Arial,sans-serif";while(g.measureText(s).width>max&&z>7){z-=.5;g.font=(bold?"bold ":"")+z+"px Arial,sans-serif";}if(g.measureText(s).width>max)throw Error("Beschriftung zu lang. Bitte vor dem Druck prüfen.");g.fillText(s,px,py);}
 text("SCHULE ALS STAAT",9,22,11,true,112);
 text("PERSONALAUSWEIS",9,32,7,false,112);
 text(info.name,9,76,12,true,x-17);
 text("KLASSE "+info.class_label,9,94,10,false,x-17);
 text(info.login_id,9,117,8,false,x-17);
 const d=g.getImageData(0,0,W,H).data;for(let i=0;i<a.length;i++)if(a[i]===0&&d[4*i+3]>104)a[i]=2;
 return a;
}
function draw(){const el=host.querySelector("#cardshop-preview");if(!el||!pixels)return;el.width=W;el.height=H;
 const ctx=el.getContext("2d"),frame=ctx.createImageData(W,H);
 for(let i=0;i<pixels.length;i++){const color=colors[pixels[i]]||"#ffffff";frame.data[4*i]=parseInt(color.slice(1,3),16);frame.data[4*i+1]=parseInt(color.slice(3,5),16);frame.data[4*i+2]=parseInt(color.slice(5,7),16);frame.data[4*i+3]=pixels[i]===255?0:255;}
 ctx.putImageData(frame,0,0);
 const stage=host.querySelector("#cardshop-stage");stage.onpointermove=e=>{if(e.pointerType==="touch")return;const r=stage.getBoundingClientRect();el.style.transform="rotateY("+((.5-(e.clientX-r.left)/r.width)*12)+"deg) rotateX("+(((e.clientY-r.top)/r.height-.5)*10)+"deg)";};
 stage.onpointerleave=()=>{el.style.transform="rotateY(-5deg) rotateX(4deg)";};
}
function html(){
 const admin=profile.role==="admin",st=info?.status;
 const list=admin?'<section class="sas-panel"><h2>Druckaufträge · Administration</h2><form id="cardshop-find" class="sas-form"><label class="sas-field">Bürgerkennung<input name="login" required placeholder="SAS-XXXXXXXXXX" pattern="SAS-[A-Z2-9]{10}"></label><button class="sas-btn soft">Ausweis laden</button></form><div class="sas-list">'+(orders.length?orders.map(o=>'<div class="sas-item"><strong>'+esc(o.login_id)+'</strong> · '+esc(o.class_label)+' · '+esc(labels[o.status]||o.status)+' <button class="sas-btn soft" data-card-open="'+esc(o.login_id)+'">Laden</button> <select data-card-state="'+esc(o.login_id)+'" aria-label="Auftragsstatus">'+Object.keys(labels).map(k=>'<option value="'+k+'"'+(o.status===k?" selected":"")+'>'+labels[k]+'</option>').join("")+'</select></div>').join(""):'<p class="sas-note">Noch keine Vormerkungen.</p>')+'</div></section>':"";
 host.innerHTML='<div class="sas-space sas-cardshop"><div class="sas-heading"><div><span class="sas-kicker">SCHULE ALS STAAT · AUSWEIS-SHOP</span><h1>3D-Schülerausweis</h1><p>Wie dein digitaler Ausweis – drei glatte Schichten in Kreditkartengröße.</p></div></div><div class="sas-columns"><section class="sas-panel"><h2>Drehbare 3D-Vorschau</h2><div class="sas-cardshop-stage" id="cardshop-stage"><canvas role="img" aria-label="Vorschau der dreifarbigen 3D-Karte" id="cardshop-preview"></canvas></div><p class="sas-note">85,6 × 54 mm · 3 × 0,2 mm = 0,6 mm · Hellblau, Weiß, Schwarz · völlig bündig</p><p class="sas-note">Offizieller Name, Klasse, Bürgerkennung und ein kurzer, dauerhaft gültiger QR-Code. Der frühere längere QR-Code bleibt ebenfalls gültig.</p></section><section class="sas-panel"><h2>'+(admin?'Druckfertigung':'Mein physischer Ausweis')+'</h2><p><strong>'+esc(info?.name||"Bürgerkennung auswählen")+'</strong> · '+esc(info?.class_label||"Administration")+'</p><p class="sas-note">Status: '+esc(labels[st]||"Noch nicht vorgemerkt")+'</p><p class="sas-note">Der Preis steht noch nicht fest. Die Vormerkung ist kostenlos und unverbindlich. Es wird nichts abgebucht.</p>'+
 (!admin&&(!st||st==="storniert")?'<button type="button" class="sas-btn primary" id="cardshop-request">Ausweis unverbindlich vormerken</button>':"")+
 (!admin&&st==="vorgemerkt"?'<button type="button" class="sas-btn soft" id="cardshop-cancel">Vormerkung stornieren</button>':"")+
 (admin&&info?'<h3>Druckdatei</h3><p class="sas-note">Erst QR-Code digital prüfen, dann die dreifarbige 3MF herunterladen. Vor Serienproduktion eine reale Karte scannen.</p><button type="button" class="sas-btn soft" id="cardshop-check">QR digital prüfen</button> <button type="button" class="sas-btn primary" id="cardshop-export" '+(verified?"":"disabled")+'>3MF exportieren</button>':"")+
 '</section></div>'+list+'<p id="cardshop-message" class="sas-feedback" aria-live="polite" role="status"></p></div>';
 draw();
}
async function load(record){if(!record?.name||!/^SAS-[A-Z2-9]{10}$/.test(record.login_id))throw Error("Ausweisdaten fehlen.");qr=getMatrix(record.qr_code);info=record;pixels=makePixels();verified=false;html();}
async function refreshOrders(){if(profile.role==="admin"){orders=await call("admin_printed_card_orders");if(!Array.isArray(orders))orders=[];}}
function box(mesh,x,y,z,xx,yy,zz){
 const k=mesh.v.length;mesh.v.push([x,y,z],[xx,y,z],[xx,yy,z],[x,yy,z],[x,y,zz],[xx,y,zz],[xx,yy,zz],[x,yy,zz]);
 [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]].forEach(t=>mesh.t.push(t.map(i=>i+k)));
}
function geometry(){
 const meshes=Array.from({length:3},()=>({v:[],t:[]}));
 // Two continuous blue base layers; three flush colours in the third/top layer.
 for(let y=0;y<H;y++){
  let x=0;while(x<W){while(x<W&&pixels[y*W+x]===255)x++;if(x===W)break;const a=x;while(x<W&&pixels[y*W+x]!==255)x++;box(meshes[0],a*P,y*P,0,x*P,(y+1)*P,.4);}
  x=0;while(x<W){if(pixels[y*W+x]===255){x++;continue;}const color=pixels[y*W+x],a=x;while(x<W&&pixels[y*W+x]===color)x++;box(meshes[color],a*P,y*P,.4,x*P,(y+1)*P,.6);}
 }
 return meshes;
}
function meshXML(m){return '<mesh><vertices>'+m.v.map(v=>'<vertex x="'+v[0].toFixed(3)+'" y="'+v[1].toFixed(3)+'" z="'+v[2].toFixed(3)+'"/>').join("")+'</vertices><triangles>'+m.t.map(t=>'<triangle v1="'+t[0]+'" v2="'+t[1]+'" v3="'+t[2]+'"/>').join("")+'</triangles></mesh>';}
async function export3MF(){
 if(profile.role!=="admin"||!verified)throw Error("Die Druckdatei darf nur nach QR-Prüfung exportiert werden.");
 if(!window.JSZip)throw Error("Die 3MF-Bibliothek ist nicht geladen.");
 const g=geometry(),zip=new JSZip();
 const model='<?xml version="1.0" encoding="UTF-8"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><basematerials id="1"><base name="Hellblau" displaycolor="#E3EEFFFF"/><base name="Weiss" displaycolor="#FFFFFFFF"/><base name="Schwarz" displaycolor="#152941FF"/></basematerials>'+g.map((m,i)=>'<object id="'+(i+2)+'" type="model" pid="1" pindex="'+i+'">'+meshXML(m)+'</object>').join("")+'</resources><build><item objectid="2"/><item objectid="3"/><item objectid="4"/></build></model>';
 zip.file("[Content_Types].xml",'<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
 zip.file("_rels/.rels",'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r0" Target="/3D/3dmodel.model" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
 zip.file("3D/3dmodel.model",model);
 const blob=await zip.generateAsync({type:"blob",compression:"DEFLATE"});
 const url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download="SaS-"+info.login_id+"-3-Schichten.3mf";document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
 message("Druckdatei erstellt. Im Slicer 0,2-mm-Schichten, Materialfarben und Drucklage kontrollieren. Vor Serienproduktion reale Scanprobe durchführen.");
}
async function verify(){
 if(!window.Html5Qrcode)throw Error("QR-Prüfbibliothek fehlt.");
 // Decode the QR matrix independently via the existing reader before export.
 const size=(qr.length+8)*8,c=document.createElement("canvas");c.width=size;c.height=size;
 const g=c.getContext("2d");g.fillStyle="#fff";g.fillRect(0,0,size,size);g.fillStyle=colors[2];
 for(let y=0;y<qr.length;y++)for(let x=0;x<qr.length;x++)if(qr[y][x])g.fillRect((x+4)*8,(y+4)*8,8,8);
 const b=await new Promise(ok=>c.toBlob(ok,"image/png"));if(!b)throw Error("QR-Bild fehlt.");
 const node=document.createElement("div");node.id="sas-print-qr-check";node.style.cssText="position:fixed;left:-9999px;width:300px;height:300px";document.body.append(node);
 const reader=new Html5Qrcode(node.id);
 try{const value=await reader.scanFile(new File([b],"qr.png",{type:"image/png"}),false);if(value!==info.qr_code)throw Error("QR-Dekodierung stimmt nicht überein.");verified=true;html();message("QR-Code erfolgreich dekodiert. Eine reale Druckprobe muss zusätzlich geprüft werden.");}
 finally{try{reader.clear();}catch(_){}node.remove();}
}
async function show(ctx){
 host=ctx.target;api=ctx.api;profile=ctx.profile;verified=false;orders=[];host.textContent="Ausweis-Shop lädt …";
 await refreshOrders();
 if(profile.role==="admin"){info=null;pixels=null;html();}
 else await load(await call("my_printed_card_data"));
 if(host.dataset.boundCardshop)return;host.dataset.boundCardshop="true";
 host.addEventListener("click",async e=>{
  const b=e.target.closest("#cardshop-request,#cardshop-cancel,#cardshop-check,#cardshop-export,[data-card-open]");
  if(!b)return;e.preventDefault();b.disabled=true;
  try{
   if(b.id==="cardshop-request"){const r=await call("request_printed_card");info.status=r.status;await refreshOrders();html();message("Kostenlose Vormerkung gespeichert.");}
   else if(b.id==="cardshop-cancel"){if(!confirm("Vormerkung stornieren?"))return;await call("cancel_printed_card");info.status="storniert";await refreshOrders();html();message("Vormerkung storniert.");}
   else if(b.id==="cardshop-check")await verify();
   else if(b.id==="cardshop-export")await export3MF();
   else if(b.dataset.cardOpen){if(profile.role!=="admin")throw Error("Nur Admin.");await load(await call("admin_printed_card_data",{p_login_id:b.dataset.cardOpen}));message("Offizielle Ausweisdaten für den Druck geladen.");}
  }catch(err){message(err.message||String(err),true);}finally{if(b.isConnected)b.disabled=false;}
 });
 host.addEventListener("submit",async e=>{
  const f=e.target.closest("#cardshop-find");if(!f)return;e.preventDefault();e.stopPropagation();const b=f.querySelector("button");b.disabled=true;
  try{if(profile.role!=="admin")throw Error("Nur Admin.");const id=String(new FormData(f).get("login")||"").trim().toUpperCase();await load(await call("admin_printed_card_data",{p_login_id:id}));message("Ausweis geladen, bitte QR-Code prüfen.");}
  catch(err){message(err.message||String(err),true);}finally{if(b.isConnected)b.disabled=false;}
 });
 host.addEventListener("change",async e=>{
  const el=e.target.closest("[data-card-state]");if(!el)return;const old=orders.find(o=>o.login_id===el.dataset.cardState)?.status;
  try{if(profile.role!=="admin")throw Error("Nur Admin.");await call("admin_printed_card_status",{p_login_id:el.dataset.cardState,p_status:el.value});await refreshOrders();if(info?.login_id===el.dataset.cardState)info.status=el.value;html();message("Auftragsstatus geändert.");}
  catch(err){el.value=old||"vorgemerkt";message(err.message||String(err),true);}
 });
}
window.SAS_CARD_SHOP={show};
})();