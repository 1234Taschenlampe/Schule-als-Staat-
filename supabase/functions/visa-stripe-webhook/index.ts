// Stripe is the authority for real-money settlement. Never trust a browser redirect.
const textHeaders={"content-type":"application/json","cache-control":"no-store"};
const reply=(status,message)=>new Response(JSON.stringify({message}),{status,headers:textHeaders});
function constantEqual(a,b){
 if(a.length!==b.length)return false;
 let value=0;for(let i=0;i<a.length;i++)value|=a[i]^b[i];return value===0;
}
function bytes(hex){
 if(!/^[0-9a-f]+$/i.test(hex)||hex.length%2)return new Uint8Array(0);
 return new Uint8Array(hex.match(/.{2}/g).map(x=>parseInt(x,16)));
}
async function validSignature(body,header,secret){
 const parts=header.split(",").map(x=>x.trim().split("="));
 const ts=parts.find(x=>x[0]==="t")?.[1];
 const sigs=parts.filter(x=>x[0]==="v1").map(x=>x[1]);
 if(!ts||!/^[0-9]{10,}$/.test(ts)||!sigs.length)return false;
 if(Math.abs(Math.floor(Date.now()/1000)-Number(ts))>300)return false;
 const key=await crypto.subtle.importKey("raw",new TextEncoder().encode(secret),{name:"HMAC",hash:"SHA-256"},false,["sign"]);
 const expected=new Uint8Array(await crypto.subtle.sign("HMAC",key,new TextEncoder().encode(ts+"."+body)));
 return sigs.some(hex=>constantEqual(expected,bytes(hex)));
}
async function callRpc(name,data){
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)throw Error("Backend secrets unavailable");
 const r=await fetch(url+"/rest/v1/rpc/"+name,{
  method:"POST",headers:{"apikey":key,"authorization":"Bearer "+key,"content-type":"application/json"},
  body:JSON.stringify(data)
 });
 if(!r.ok){const e=await r.text();throw Error("DB rejected verified event "+r.status+" "+e.slice(0,240));}
 return await r.json();
}
Deno.serve(async request=>{
 if(request.method!=="POST")return reply(405,"Method not allowed");
 const secret=Deno.env.get("STRIPE_WEBHOOK_SECRET");
 const stripeKey=Deno.env.get("STRIPE_SECRET_KEY");
 if(!secret||!stripeKey)return reply(503,"Webhook not configured");
 const raw=await request.text();
 if(raw.length>160000)return reply(413,"Too large");
 if(!(await validSignature(raw,request.headers.get("stripe-signature")||"",secret)))
  return reply(400,"Invalid Stripe signature");
 try{
  const event=JSON.parse(raw);
  if(!["checkout.session.completed","checkout.session.async_payment_succeeded"].includes(event.type))
   return reply(200,"Ignored");
  const session=event.data?.object;
  if(!session||session.object!=="checkout.session"||session.mode!=="payment"
     ||session.payment_status!=="paid")return reply(200,"Not yet paid");
  const live=stripeKey.startsWith("sk_live_");
  if(Boolean(session.livemode)!==live)return reply(400,"Stripe mode mismatch");
  if(typeof session.id!=="string"||typeof session.payment_intent!=="string"
     ||!Number.isInteger(session.amount_total)||session.amount_total<=0
     ||session.currency!=="eur"||typeof event.id!=="string")
   return reply(400,"Invalid paid session data");
  await callRpc("visa_confirm_checkout",{
   p_session:session.id,p_payment_intent:session.payment_intent,
   p_amount_cents:session.amount_total,p_currency:session.currency,p_event_id:event.id
  });
  return reply(200,"Confirmed");
 }catch(error){
  console.error("Visa Stripe webhook processing failed",error?.message);
  return reply(500,"Retry later");
 }
});
