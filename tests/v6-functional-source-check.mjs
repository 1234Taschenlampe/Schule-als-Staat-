import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const file = (name) => readFileSync(new URL("../"+name,import.meta.url), "utf8");
const js = file("features.js");
const app = file("app.js");
const html = file("index.html");
const css = file("features.css");
const sql = file("supabase/v6_integrated_portal.sql");
const build = file("scripts/build-static.sh");
new vm.Script(js, {filename:"features.js"});
new vm.Script(app, {filename:"app.js"});

test("all portal screens render without demo data or backend errors", async()=>{
 const sandbox={window:{},Date,Intl,console,confirm:()=>true,alert:()=>{}};
 vm.runInNewContext(js,sandbox);
 const pages=sandbox.window.SAS_FEATURES.pages;
 assert.equal(Object.keys(pages).length,14);
 const mock=()=>{
  const t=new Proxy({}, {get(_,property){if(property==="then")return (ok)=>ok({data:[],error:null});return ()=>t;}});
  return t;
 };
 const api={from:()=>mock()};
 for(const role of ["member","admin"]){
   for(const page of Object.keys(pages)){
      const listeners=[];
      const node={innerHTML:"",isConnected:true,addEventListener:(...args)=>listeners.push(args),querySelector:()=>null};
      await sandbox.window.SAS_FEATURES.show({
        api,user:{id:"73abccce-04ad-49c0-a6b0-39234bc369c7",email:"user@example.test"},
        profile:{role,display_name:"Alex Beispiel"},page,target:node,navigate:async()=>{}
      });
      assert.match(node.innerHTML,/sas-space/,role+"/"+page+" did not render");
      assert.doesNotMatch(node.innerHTML,/Daten konnten nicht geladen werden/,role+"/"+page+" threw");
      assert.equal(listeners.length,2);
   }
 }
});

test("all modules and styles are included; obsolete demo site is not publicly served",()=>{
 assert.match(html,/features\.css/);
 assert.match(html,/features\.js/);
 assert.match(app,/SAS_FEATURES\.show/);
 assert.match(build,/features\.js features\.css/);
 assert.doesNotMatch(build,/cp portal\/index\.html/);
 assert.match(css,/sas-design-grid/);
 assert.match(js,/visa_applications/);
 assert.match(js,/room_bookings/);
 assert.match(js,/student_cards/);
 assert.match(js,/portal_posts/);
 assert.match(js,/lost_items/);
 assert.match(js,/school_events/);
 assert.match(js,/event_rsvps/);
 assert.match(js,/civic_posts/);
});

test("Postgres protects personal data, resources and concurrent approved room bookings",()=>{
 for(const name of ["student_cards","visa_applications","school_places","room_bookings","school_events","event_rsvps","lost_items","civic_posts","job_applications"]){
   assert.match(sql,new RegExp("alter table public\\."+name+" enable row level security"));
 }
 assert.match(sql,/exclude using gist/);
 assert.match(sql,/where\(status='approved'\)/);
 assert.match(sql,/visa_user_date/);
 assert.match(sql,/status='submitted'/);
 assert.match(sql,/sas_visa_review/);
 assert.match(sql,/sas_civic_insert/);
 assert.match(sql,/sas_rsvps_insert/);
 assert.match(sql,/sas_job_apply/);
 assert.doesNotMatch(sql,/grant .* to anon;/);
});
