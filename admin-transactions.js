/* SaS | Administrator-only financial journal and linked counterbookings. */
(function () {
  "use strict";
  let host=null, api=null, page=0, rows=[], total=0, selected=null, operationId=null, busy=false, loadVersion=0;
  const PAGE_SIZE=40;
  const escapeHtml=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const money=value=>new Intl.NumberFormat("de-DE",{minimumFractionDigits:2,maximumFractionDigits:2}).format(Number(value||0)/100);
  const date=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?d.toLocaleString("de-DE"):"–";};
  const types={payment:"Digitale Zahlung",credit:"Guthabenausgabe",reversal:"Rückbuchung",cash:"Barverkauf"};
  const statuses={gebucht:"Gebucht",rueckgebucht:"Rückgebucht",gegenbuchung:"Gegenbuchung",bar_erfasst:"Bar erfasst"};
  async function rpc(name,args){
    const res=await api.rpc(name,args);
    if(res.error)throw res.error;
    return res.data;
  }
  function feedback(text,error=false){
    const el=host?.querySelector("#sas-transactions-feedback");
    if(el){el.textContent=text;el.className="details"+(error?" sas-error":"");el.style.color=error?"#a33d35":"";}
  }
  function amountCents(raw){
    if(!raw)return null;
    const number=Number(String(raw).trim().replace(",","."));
    const cents=Math.round(number*100);
    if(!Number.isFinite(number)||!Number.isSafeInteger(cents)||cents<1||cents>1000000||
       Math.abs(number*100-cents)>0.001)throw Error("Betrag muss zwischen 0,01 und 10.000,00 liegen.");
    return cents;
  }
  function toDate(value,exclusiveEnd=false){
    if(!value)return null;
    const d=new Date(value+"T00:00:00");
    if(Number.isNaN(d.getTime()))throw Error("Ungültiger Zeitraum.");
    if(exclusiveEnd)d.setDate(d.getDate()+1);
    return d.toISOString();
  }
  function filters(){
    const f=host.querySelector("#sas-transactions-filters").elements;
    return {
      p_offset:page*PAGE_SIZE,p_limit:PAGE_SIZE,
      p_query:f.query.value.trim(),p_kind:f.kind.value,
      p_from:toDate(f.from.value),p_to:toDate(f.to.value,true),
      p_amount_cents:amountCents(f.amount.value)
    };
  }
  function csvValue(value){
    let text=String(value??"");
    if(/^[\s]*[=+\-@]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  }
  function exportPage(){
    if(!rows.length)return feedback("Keine Buchungen auf dieser Seite.",true);
    const data=[["Zeit","ID","Typ","Status","Von","An","Betrag in Schulwährung","Grund","Ursprungsbuchung","Rückbuchungs-ID"]];
    for(const row of rows)data.push([
      date(row.created_at),row.id,types[row.kind]||row.kind,statuses[row.status]||row.status,
      row.payer||"",row.payee||"",money(row.amount_cents),row.note||row.reversal_reason||"",
      row.reverse_of_id||"",row.reversal_id||""
    ]);
    const csv="\uFEFF"+data.map(line=>line.map(csvValue).join(";")).join("\r\n");
    const blob=new Blob([csv],{type:"text/csv;charset=utf-8"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");
    link.href=url;link.download="sas-transaktionen-seite-"+(page+1)+".csv";
    document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function rowsHtml(){
    if(!rows.length)return '<p class="empty">Für diese Filter wurden keine Buchungen gefunden.</p>';
    return '<div class="table-wrap"><table class="simple-table" style="min-width:990px">'+
      '<thead><tr><th>Zeit / ID</th><th>Art</th><th>Von</th><th>An</th><th>Betrag</th><th>Status / Grund</th><th>Aktion</th></tr></thead><tbody>'+
      rows.map(row=>{
        const original=row.kind==="payment"||row.kind==="credit";
        const canReverse=original&&!row.reversal_id&&row.status==="gebucht";
        const payer=row.kind==="credit"?"Ausgabe durch Verwaltung":row.kind==="cash"?"Barzahlung":row.payer;
        const status=statuses[row.status]||row.status;
        const reversalLink=row.reverse_of_id?'<div class="item-meta">Ursprung: '+escapeHtml(row.reverse_of_id)+'</div>':
          row.reversal_id?'<div class="item-meta">Gegenbuchung: '+escapeHtml(row.reversal_id)+'</div>':"";
        const note=row.kind==="reversal"?row.reversal_reason:row.note;
        return '<tr><td>'+escapeHtml(date(row.created_at))+
          '<div class="item-meta" style="max-width:220px;overflow-wrap:anywhere">'+escapeHtml(row.id)+'</div></td>'+
          '<td>'+escapeHtml(types[row.kind]||row.kind)+'</td>'+
          '<td>'+escapeHtml(payer||"–")+'</td><td>'+escapeHtml(row.payee||"–")+'</td>'+
          '<td class="mono">'+escapeHtml(money(row.amount_cents))+'</td>'+
          '<td>'+escapeHtml(status)+(note?'<div class="item-meta">'+escapeHtml(note)+'</div>':"")+
          reversalLink+'</td><td>'+
          (canReverse?'<button class="btn" type="button" data-reverse="'+escapeHtml(row.id)+'">Rückbuchen</button>':
          row.kind==="cash"?'<span class="small muted">Nur Kassenkorrektur</span>':'<span class="small muted">–</span>')+
          '</td></tr>';
      }).join("")+'</tbody></table></div>';
  }
  function renderResults(result){
    rows=Array.isArray(result?.rows)?result.rows:[];
    total=Number(result?.total_count||0);
    const target=host.querySelector("#sas-transactions-results");
    if(!target)return;
    target.innerHTML='<section class="card" style="margin-top:20px">'+
      '<div class="card-header"><div><h2>Alle Buchungen</h2>'+
      '<p class="details" style="margin:8px 0 0">'+escapeHtml(total)+' Treffer · Seite '+(page+1)+'</p></div>'+
      '<button class="btn" type="button" id="sas-transactions-export">Diese Seite als CSV</button></div>'+
      '<div class="grid three" style="margin-bottom:24px">'+
        '<div><div class="stat-label">Digitale Buchungen</div><strong>'+escapeHtml(money(result?.digital_booked_cents))+'</strong></div>'+
        '<div><div class="stat-label">Digitale Gegenbuchungen</div><strong>'+escapeHtml(money(result?.digital_reversed_cents))+'</strong></div>'+
        '<div><div class="stat-label">Erfasste Barumsätze</div><strong>'+escapeHtml(money(result?.cash_recorded_cents))+'</strong></div>'+
      '</div>'+rowsHtml()+
      '<div class="button-row" style="margin-top:22px">'+
        '<button class="btn" type="button" id="sas-transactions-previous" '+(page===0?"disabled":"")+'>Vorherige</button>'+
        '<button class="btn" type="button" id="sas-transactions-next" '+((page+1)*PAGE_SIZE>=total?"disabled":"")+'>Nächste</button>'+
      '</div><p class="field-help">Beträge in interner Schulwährung. Barumsätze und externe Euro-Zahlungen werden nicht durch digitale Gegenbuchungen erstattet. Export umfasst ausschließlich die angezeigte Seite.</p></section>';
    target.querySelector("#sas-transactions-export").onclick=exportPage;
    target.querySelector("#sas-transactions-previous").onclick=()=>{page=Math.max(0,page-1);void load();};
    target.querySelector("#sas-transactions-next").onclick=()=>{page+=1;void load();};
    target.querySelectorAll("[data-reverse]").forEach(btn=>btn.onclick=()=>selectReverse(btn.dataset.reverse));
  }
  async function load(){
    if(!host?.isConnected)return;
    const version=++loadVersion;
    const btn=host.querySelector("#sas-transactions-apply");
    if(btn)btn.disabled=true;
    feedback("Buchungen werden geladen …");
    try {
      const data=await rpc("admin_list_transactions",filters());
      if(version!==loadVersion||!host?.isConnected)return;
      renderResults(data);
      feedback("Journal aktualisiert.");
    } catch(err){
      if(version===loadVersion)feedback("Journal konnte nicht geladen werden: "+err.message,true);
    } finally {if(version===loadVersion&&btn)btn.disabled=false;}
  }
  function selectReverse(id){
    if(busy)return;
    const row=rows.find(x=>x.id===id);
    if(!row||!["payment","credit"].includes(row.kind)||row.reversal_id)return;
    selected=row;operationId=crypto.randomUUID();
    const panel=host.querySelector("#sas-transactions-reverse");
    panel.hidden=false;
    host.querySelector("#sas-reverse-caption").textContent=
      "Buchung "+row.id+" · "+money(row.amount_cents)+" Schulwährung · "+(types[row.kind]||row.kind);
    panel.querySelector("form").reset();
    panel.scrollIntoView({block:"nearest",behavior:"smooth"});
    panel.querySelector('textarea[name="reason"]').focus({preventScroll:true});
    feedback("Die ursprüngliche Buchung bleibt erhalten. Eine Gegenbuchung wird separat protokolliert.");
  }
  async function submitReverse(event){
    event.preventDefault();
    if(busy||!selected||!operationId)return;
    const form=event.currentTarget,reason=form.elements.reason.value.trim();
    if(reason.length<8||reason.length>500)return feedback("Begründung mit 8 bis 500 Zeichen erforderlich.",true);
    if(!form.elements.confirm.checked)return feedback("Bitte die Rückbuchung ausdrücklich bestätigen.",true);
    const button=form.querySelector('button[type="submit"]');
    busy=true;button.disabled=true;
    try{
      const result=await rpc("admin_reverse_transaction",{
        p_original_ledger_id:selected.id,p_operation_id:operationId,p_reason:reason
      });
      selected=null;operationId=null;
      host.querySelector("#sas-transactions-reverse").hidden=true;
      page=0;await load();
      feedback(result.already_processed?
        "Diese Gegenbuchung war bereits ausgeführt; keine Doppelbelastung.":
        "Gegenbuchung gespeichert: "+result.ledger_id);
    }catch(err){feedback("Rückbuchung nicht ausgeführt: "+err.message,true);}
    finally{busy=false;button.disabled=false;}
  }
  async function show(ctx){
    host=ctx.target;api=ctx.api;page=0;rows=[];selected=null;operationId=null;loadVersion++;
    if(ctx.profile?.role!=="admin"){host.textContent="Nur für die Administration.";return;}
    host.innerHTML='<div class="sas-space">'+
      '<div class="page-heading"><div class="eyebrow">VERWALTUNG / FINANZEN</div>'+
        '<h1>Transaktionen</h1><p class="lead">Zentrales Journal aller digitalen Buchungen und erfassten Barumsätze. Gegenbuchungen nur nach überprüfter Administratorberechtigung.</p></div>'+
      '<section class="card"><h2>Suche und Filter</h2>'+
      '<form id="sas-transactions-filters" class="sas-form" style="margin-top:16px">'+
        '<div class="grid three">'+
          '<label class="sas-field"><span>Transaktions-ID oder Bürgerkennung</span><input name="query" maxlength="100" placeholder="6-stellige Kennung oder UUID"></label>'+
          '<label class="sas-field"><span>Typ</span><select name="kind"><option value="all">Alle</option><option value="payment">Zahlungen</option><option value="credit">Guthabenausgaben</option><option value="reversal">Rückbuchungen</option><option value="cash">Barverkäufe</option></select></label>'+
          '<label class="sas-field"><span>Exakter Betrag (Schulwährung)</span><input name="amount" inputmode="decimal" placeholder="z. B. 12,50"></label>'+
          '<label class="sas-field"><span>Von (einschließlich)</span><input name="from" type="date"></label>'+
          '<label class="sas-field"><span>Bis (einschließlich)</span><input name="to" type="date"></label>'+
        '</div><div class="button-row" style="margin-top:15px">'+
          '<button type="submit" class="btn primary" id="sas-transactions-apply">Filtern / aktualisieren</button>'+
          '<button type="reset" class="btn" id="sas-transactions-reset">Zurücksetzen</button>'+
        '</div></form></section>'+
      '<p class="details" id="sas-transactions-feedback" role="status" style="margin-top:16px"></p>'+
      '<div id="sas-transactions-results"></div>'+
      '<section class="card" id="sas-transactions-reverse" hidden style="margin-top:20px">'+
        '<h2>Gegenbuchung bestätigen</h2><p class="details" id="sas-reverse-caption"></p>'+
        '<p class="details">Der ursprüngliche Beleg wird nicht gelöscht. Der Empfänger wird belastet, der ursprüngliche Zahler erhält sein Guthaben zurück. Bei unzureichendem Guthaben wird keine Umbuchung durchgeführt.</p>'+
        '<form id="sas-transactions-reverse-form"><label class="sas-field"><span>Verbindliche Begründung</span>'+
          '<textarea class="field" name="reason" minlength="8" maxlength="500" rows="3" required></textarea></label>'+
          '<label style="display:flex;gap:10px;align-items:center;margin:14px 0"><input type="checkbox" name="confirm" required>Ich habe Buchung, Betrag und Folgen geprüft.</label>'+
          '<div class="button-row"><button class="btn primary" type="submit">Gegenbuchung endgültig ausführen</button>'+
          '<button class="btn" id="sas-reverse-cancel" type="button">Abbrechen</button></div></form></section>'+
      '</div>';
    host.querySelector("#sas-transactions-filters").onsubmit=e=>{e.preventDefault();page=0;void load();};
    host.querySelector("#sas-transactions-reset").onclick=()=>{page=0;queueMicrotask(()=>void load());};
    host.querySelector("#sas-transactions-reverse-form").onsubmit=e=>void submitReverse(e);
    host.querySelector("#sas-reverse-cancel").onclick=()=>{
      selected=null;operationId=null;host.querySelector("#sas-transactions-reverse").hidden=true;
      feedback("Rückbuchung abgebrochen.");
    };
    await load();
  }
  window.SAS_ADMIN_TRANSACTIONS={show};
})();
