#!/usr/bin/env node
/**
 * PRIVATE one-time provisioning of validated citizens-private.json.
 * Environment (never commit): SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.
 * Requires --apply to write. No end-user browser access to the service key.
 * Journal each completed operation so interrupted imports can resume safely.
 * Does NOT delete, modify or disable existing accounts.
 */
import {readFileSync,writeFileSync,existsSync,openSync,closeSync,renameSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import process from "node:process";
import assert from "node:assert/strict";

const manifestArg=process.argv.find(x=>x.endsWith(".json"));
if(!manifestArg)throw Error("Usage: node scripts/provision-school-roster.mjs /secure/citizens-private.json [--apply]");
const path=resolve(manifestArg), confirmed=process.argv.includes("--apply");
const raw=JSON.parse(readFileSync(path,"utf8"));
assert.equal(raw.format_version,1,"Unexpected manifest version");
assert.ok(Array.isArray(raw.citizens)&&raw.citizens.length>=1&&raw.citizens.length<=5000,"Invalid roster size");
const emailSuffix="@accounts.schule-als-staat.invalid";
const ids=new Set(),pins=new Set(),emails=new Set();
for(const entry of raw.citizens){
  assert.match(entry.login_id,/^SAS-[A-HJ-NP-Z2-9]{10}$/);
  assert.match(entry.temporary_password,/^\d{7}$/);
  assert.equal(entry.email,entry.login_id.slice(4).toLowerCase()+emailSuffix);
  assert.ok(entry.first_name&&entry.last_name&&entry.class_label,"Incomplete roster record");
  assert.ok(!ids.has(entry.login_id)&&!pins.has(entry.temporary_password)&&!emails.has(entry.email),
    "Duplicate login or seven-digit start PIN");
  ids.add(entry.login_id);pins.add(entry.temporary_password);emails.add(entry.email);
}
if(!confirmed){
  process.stdout.write("Validiert: "+raw.citizens.length+" eindeutige Bürger, "+pins.size+
    " Start-PINs. Es wurde kein Konto angelegt. Für die tatsächliche Anlage --apply verwenden.\n");
  process.exit(0);
}
const url=process.env.SUPABASE_URL?.replace(/\/+$/,"");
const service=process.env.SUPABASE_SERVICE_ROLE_KEY;
if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url||"")||!service||service.length<35)
  throw Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be configured in a private terminal");
const journalPath=join(dirname(path),"citizens-progress.json");
let journal={version:1,records:{}};
if(existsSync(journalPath))journal=JSON.parse(readFileSync(journalPath,"utf8"));
const save=()=>{
 const temp=journalPath+".tmp";
 const fd=openSync(temp,"w",0o600);
 try{writeFileSync(fd,JSON.stringify(journal,null,2)+"\n");}finally{closeSync(fd);}
 renameSync(temp,journalPath);
};
const common={"apikey":service,"authorization":"Bearer "+service,"content-type":"application/json"};
async function post(endpoint,body,extraHeaders={}){
 const response=await fetch(url+endpoint,{method:"POST",headers:{...common,...extraHeaders},
   body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});
 const text=await response.text();
 if(!response.ok)throw Error("Supabase returned HTTP "+response.status+" on "+endpoint+" (details withheld to protect personal data)");
 return text?JSON.parse(text):null;
}
let created=0,linked=0,skipped=0;
for(const c of raw.citizens){
 const id=c.login_id;
 let progress=journal.records[id]||{};
 if(progress.linked){skipped++;continue;}
 if(!progress.auth_user_id){
   const user=await post("/auth/v1/admin/users",{
     email:c.email,
     password:c.temporary_password,
     email_confirm:true,
     user_metadata:{full_name:c.first_name+" "+c.last_name,class_label:c.class_label},
     app_metadata:{sas_roster_provisioned:true,sas_initial_password:true}
   });
   assert.match(user.id,/^[a-f0-9-]{36}$/i);
   progress={auth_user_id:user.id,linked:false};
   journal.records[id]=progress;save();created++;
 }
 await post("/rest/v1/school_roster_members",{
   user_id:progress.auth_user_id,login_id:id,
   given_name:c.first_name,family_name:c.last_name,class_label:c.class_label,active:true
 },{"Prefer":"return=minimal"});
 progress.linked=true;save();linked++;
}
console.log("Import abgeschlossen: "+created+" neue Auth-Konten, "+linked+
 " Roster-Zuordnungen, "+skipped+" bereits verarbeitete.");
console.log("Geheime Start-PINs wurden nicht protokolliert. Zugangsdaten nur persönlich ausgeben.");
