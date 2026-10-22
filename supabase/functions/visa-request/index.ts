// All anonymous guest applications must pass Cloudflare Turnstile on the server.
// The public SQL insert RPC is denied; only this Edge Function uses service_role.
const allowedOrigin="https://schule-als-staat.schule-als-staat-jfe.workers.dev";
const headers={"content-type":"application/json","access-control-allow-origin":allowedOrigin,"vary":"Origin","cache-control":"no-store"};
function response(status,message){return new Response(JSON.stringify({message}),{status,headers});}
Deno.serve(async req=>{
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers:{...headers,"access-control-allow-headers":"apikey, authorization, content-type","access-control-allow-methods":"POST, OPTIONS"}});
 if(req.method!=="POST")return response(405,"Method not allowed");
 if(req.headers.get("origin")!==allowedOrigin)return response(403,"Origin denied");
 const secret=Deno.env.get("TURNSTILE_SECRET"),url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!secret||!url||!key)return response(503,"ViSA-Verifizierung derzeit nicht freigeschaltet");
 try{
  const raw=await req.text();
  if(raw.length>6000)return response(413,"Request too large");
  const body=JSON.parse(raw),token=body?.turnstileToken;
  if(typeof token!=="string"||token.length<10||token.length>2048)return response(403,"Bot-Schutz muss bestätigt werden");
  const form=new URLSearchParams({secret,response:token});
  const ip=req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if(ip)form.set("remoteip",ip);
  const checked=await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify",{
   method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},body:form.toString()
  });
  if(!checked.ok)return response(503,"Bot-Schutz aktuell nicht verfügbar");
  const verdict=await checked.json();
  if(verdict.success!==true||verdict.hostname!=="schule-als-staat.schule-als-staat-jfe.workers.dev")
   return response(403,"Bot-Schutz nicht bestätigt");
  const input=body?.application;
  if(!input||typeof input!=="object")return response(400,"Ungültige Angaben");
  // Never accept user_id, status, payment amounts or verified flags from visitors.
  const data={
   p_first_name:input.first_name,p_last_name:input.last_name,
   p_origin_country:input.origin_country,p_planned_entry:input.planned_entry,
   p_contact_email:input.contact_email,p_school_class:input.school_class,
   p_privacy_accepted:input.privacy_accepted,p_website:input.website||""
  };
  const submitted=await fetch(url+"/rest/v1/rpc/submit_guest_visa",{
   method:"POST",headers:{"apikey":key,"authorization":"Bearer "+key,"content-type":"application/json"},body:JSON.stringify(data)
  });
  if(!submitted.ok){
   // Avoid disclosing whether an address already exists or rate limits were hit.
   return response(429,"Anfrage momentan nicht möglich. Bitte später erneut versuchen.");
  }
  return response(200,"Falls deine Angaben akzeptiert wurden, folgt eine Bestätigungs-E-Mail.");
 }catch(e){console.error("Visa request rejected",String(e?.message||e));return response(503,"Antrag konnte derzeit nicht verarbeitet werden");}
});
