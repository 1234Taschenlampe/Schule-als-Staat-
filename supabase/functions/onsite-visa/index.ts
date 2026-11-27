// Separate capability login: no Supabase citizen account is created.
import { createClient } from "npm:@supabase/supabase-js@2.118.0";
import { boundedText } from "../_shared/body.js";
const admin=createClient(Deno.env.get("SUPABASE_URL")!,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,{auth:{persistSession:false,autoRefreshToken:false}});
const portal="https://schule-als-staat.schule-als-staat-jfe.workers.dev";
Deno.serve(async req=>{
 const headers={"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Vary":"Origin","Access-Control-Allow-Origin":portal,"Access-Control-Allow-Headers":"apikey, content-type","Access-Control-Allow-Methods":"POST, OPTIONS"};
 const reply=(status:number,body:object)=>new Response(JSON.stringify(body),{status,headers});
 if(req.headers.get("origin")!==portal)return reply(403,{error:"Nicht erlaubt."});
 if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
 if(req.method!=="POST")return reply(405,{error:"Nicht erlaubt."});
 try{
  const raw=await boundedText(req,2048);
  if(raw===null)return reply(400,{error:"Ungültige Anfrage."});
  const body=JSON.parse(raw);
  if(!["station_login","station_quote","station_create","station_logout","guest_status"].includes(body.action)||typeof body.key!=="string"||!/^[a-f0-9]{64}$/.test(body.key))return reply(400,{error:"Ungültige Anfrage."});
  const {data,error}=await admin.rpc("onsite_visa_access",{p_action:body.action,p_key:body.key,p_input:body.input??{}});
  if(error)return reply(error.code==="42501"?403:error.code==="54000"?429:400,{error:"Anfrage nicht möglich. Zugang, Zeitraum oder Freigabe prüfen."});
  return reply(200,data);
 }catch{return reply(400,{error:"Ungültige Anfrage."});}
});
