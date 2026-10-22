// Public entry point, but every monetary decision is server-side.
// Required Edge secrets: STRIPE_SECRET_KEY (test/live), and Supabase service role (provided by Supabase).
const ROOT="https://schule-als-staat.schule-als-staat-jfe.workers.dev/";
const ORIGIN=new URL(ROOT).origin;
const headers={"content-type":"application/json","access-control-allow-origin":ORIGIN,"vary":"Origin","cache-control":"no-store"};
const respond=(status,body)=>new Response(JSON.stringify(body),{status,headers});
async function rpc(name,data){
 const url=Deno.env.get("SUPABASE_URL"),secret=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!secret)throw Error("Backend not configured");
 const r=await fetch(url+"/rest/v1/rpc/"+name,{method:"POST",headers:{"apikey":secret,"authorization":"Bearer "+secret,"content-type":"application/json"},body:JSON.stringify(data)});
 const val=await r.json().catch(()=>null);
 if(!r.ok)throw Error("Backend denied checkout");
 return val;
}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{"access-control-allow-origin":ORIGIN,"access-control-allow-headers":"apikey, authorization, content-type","access-control-allow-methods":"POST, OPTIONS","vary":"Origin"}});
 if(req.method!=="POST")return respond(405,{error:"Method not allowed"});
 if(req.headers.get("origin")!==ORIGIN)return respond(403,{error:"Origin denied"});
 const stripeKey=Deno.env.get("STRIPE_SECRET_KEY");
 if(!stripeKey || !/^sk_(test|live)_/.test(stripeKey))return respond(503,{error:"Zahlungen sind noch nicht freigeschaltet."});
 try{
  const raw=await req.text();
  if(raw.length>2048)return respond(413,{error:"Request too large"});
  const {token}=JSON.parse(raw);
  if(typeof token!=="string"||!/^[0-9a-f]{64}$/.test(token))return respond(400,{error:"Ungültiger Verifizierungslink."});
  const context=await rpc("visa_checkout_context",{p_token:token});
  if(context.session_id)return respond(409,{error:"Für diesen Antrag wurde bereits ein Bezahlvorgang angelegt. Bitte die Schulverwaltung kontaktieren."});
  const amount=Number(context.amount_cents);
  if(!Number.isInteger(amount)||amount<=0||context.currency!=="eur")return respond(503,{error:"Preis noch nicht festgelegt."});
  const params=new URLSearchParams({
   "mode":"payment",
   "payment_method_types[0]":"card",
   "client_reference_id":context.id,
   "customer_email":context.email,
   "line_items[0][price_data][currency]":"eur",
   "line_items[0][price_data][unit_amount]":String(amount),
   "line_items[0][price_data][product_data][name]":"Schule als Staat – ViSA",
   "line_items[0][quantity]":"1",
   "metadata[visa_id]":context.id,
   "success_url":ROOT+"#visa-payment-success",
   "cancel_url":ROOT+"#visa-onboarding"
  });
  const created=await fetch("https://api.stripe.com/v1/checkout/sessions",{
   method:"POST",
   headers:{"authorization":"Bearer "+stripeKey,"content-type":"application/x-www-form-urlencoded","Idempotency-Key":"sas-visa-"+context.id},
   body:params.toString()
  });
  const session=await created.json();
  if(!created.ok||!session?.id||!session?.url)return respond(502,{error:"Bezahlvorgang konnte nicht erstellt werden."});
  await rpc("visa_store_checkout",{p_token:token,p_session:session.id,p_amount_cents:amount});
  const u=new URL(session.url);
  if(u.protocol!=="https:"||u.hostname!=="checkout.stripe.com")return respond(502,{error:"Unerwartetes Zahlungsziel."});
  return respond(200,{url:session.url});
 }catch(e){
  console.error("Visa checkout refused",String(e?.message||e));
  return respond(503,{error:"Zahlung zurzeit nicht verfügbar. Es wurde nichts abgebucht."});
 }
});
