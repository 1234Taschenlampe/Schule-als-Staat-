// Limited gateway for a Raspberry Pi mail dispatcher.
// Configure VISA_MAIL_WORKER_SECRET on Supabase, use the same secret only on the Pi.
// No public or browser endpoint can read queued e-mail verification tokens.
const toJson=(code,obj)=>new Response(JSON.stringify(obj),{status:code,headers:{"content-type":"application/json","cache-control":"no-store"}});
function secureEqual(a,b){
 const x=new TextEncoder().encode(a),y=new TextEncoder().encode(b);
 let diff=x.length^y.length;const len=Math.max(x.length,y.length);
 for(let i=0;i<len;i++)diff|=(x[i]||0)^(y[i]||0);
 return diff===0;
}
async function rpc(name,args){
 const url=Deno.env.get("SUPABASE_URL"),key=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
 if(!url||!key)throw Error("Backend unavailable");
 const r=await fetch(url+"/rest/v1/rpc/"+name,{
  method:"POST",headers:{"apikey":key,"authorization":"Bearer "+key,"content-type":"application/json"},body:JSON.stringify(args)
 });
 if(!r.ok)throw Error("Queue error "+r.status);
 return r.json();
}
Deno.serve(async req=>{
 if(req.method!=="POST")return toJson(405,{error:"Method not allowed"});
 const secret=Deno.env.get("VISA_MAIL_WORKER_SECRET");
 if(!secret||secret.length<32)return toJson(503,{error:"Mail worker not configured"});
 const auth=req.headers.get("authorization")||"";
 if(!secureEqual(auth,"Bearer "+secret))return toJson(401,{error:"Unauthorized"});
 try{
  const body=await req.text();
  if(body.length>1024)return toJson(413,{error:"Too large"});
  const data=JSON.parse(body);
  if(data.action==="claim"){
   const items=await rpc("visa_mail_claim",{p_limit:Math.min(20,Math.max(1,Number(data.limit)||10))});
   return toJson(200,{items});
  }
  if(data.action==="ack"){
   if(typeof data.id!=="string"||!/^[0-9a-f-]{36}$/i.test(data.id)||typeof data.success!=="boolean")
    return toJson(400,{error:"Invalid acknowledgement"});
   const recorded=await rpc("visa_mail_ack",{p_id:data.id,p_success:data.success,p_error:String(data.error||"").slice(0,200)});
   return toJson(200,{recorded});
  }
  return toJson(400,{error:"Unknown operation"});
 }catch(err){console.error("Mail bridge failed",err?.message);return toJson(500,{error:"Mail queue temporarily unavailable"});}
});
