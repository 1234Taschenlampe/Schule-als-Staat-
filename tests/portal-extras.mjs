import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const source=read("portal-extras.js");
const app=read("app.js");
const plan=read("shop-plan.js");
const html=read("index.html");
const worker=read("scripts/build-worker.mjs");
const context={window:{SAS_SHOP_PLAN:{knownRooms:(q)=>q.includes("a302")?[{name:"A302",floor:"Gebäude A · Kunst"}]:[]}}};
vm.runInNewContext(source,context,{filename:"portal-extras.js"});
const hub=context.window.SAS_PORTAL_EXTRAS;

function apiFixture(){
 const user="user-1";
 const tables={
  room_bookings:[
   {id:"br1",booked_by:user,purpose:"Projekt",starts_at:"2027-07-12T12:00:00Z",submitted_at:"2026-10-31T12:00:00Z",status:"pending"},
   {id:"br2",booked_by:"someone-else",purpose:"Geheim",starts_at:"2027-07-12T12:00:00Z",submitted_at:"2026-10-31T12:00:00Z",status:"approved"}
  ],
  job_applications:[{id:"job1",applicant_id:user,submitted_at:"2026-10-31T08:00:00Z"}],
  visa_applications:[{id:"visa1",applicant_id:user,status:"approved",planned_entry:"2027-07-12",submitted_at:"2026-10-29T10:00:00Z"}],
  school_places:[{name:"C202",kind:"room",floor_label:"2. OG",active:true},{name:"Cookieshop",kind:"shop",floor_label:"EG",active:true}],
  school_events:[{title:"Kulturfest",starts_at:"2027-07-14T10:00:00Z",ends_at:"2027-07-14T16:00:00Z"}],
  civic_posts:[{title:"Kassendienst",kind:"job"}],
  portal_posts:[{title:"Eröffnung",section:"news",published:true}]
 };
 const queried=[];
 const api={rpc:async(name)=>({data:name==="shop_room_catalog"?[
  {name:"A003",slots:[{number:1,mine:true,shop:"Kuchen",status:"pending"},{number:2,mine:false,shop:"Fremd",status:"approved"}]}
 ]:[],error:null}),from(name){
  const filters=[];let top=100;
  const q={
   select(){return q;},
   eq(col,value){filters.push(row=>row[col]===value);return q;},
   ilike(col,pattern){const term=pattern.replaceAll("%","").toLowerCase();filters.push(row=>String(row[col]||"").toLowerCase().includes(term));return q;},
   gte(col,value){filters.push(row=>String(row[col])>=value);return q;},
   order(){return q;},
   limit(n){top=n;return q;},
   then(done,fail){queried.push(name);return Promise.resolve({data:(tables[name]||[]).filter(row=>filters.every(fn=>fn(row))).slice(0,top),error:null}).then(done,fail);}
  };return q;
 }};
 return {api,user,queried};
}
test("all application items are scoped to the signed-in account and shop mine flags",async()=>{
 const {api,user}=apiFixture();
 const r=await hub.collect({api,user:{id:user}});
 assert.equal(r.unavailable.length,0);
 assert.equal(r.items.length,4);
 assert.ok(r.items.some(x=>x.title.includes("A003 / Platz 1")));
 assert.ok(!r.items.some(x=>x.title.includes("Platz 2")));
 assert.ok(!r.items.some(x=>x.detail.includes("Geheim")));
 assert.ok(r.items.some(x=>x.status==="approved"&&x.kind==="ViSA"));
});
test("global search finds real rooms, events and static school plan labels without personal directory",async()=>{
 const {api}=apiFixture();
 const rooms=await hub.search({api},"C202");
 assert.ok(rooms.some(x=>x.title==="C202"&&x.page==="map"));
 const events=await hub.search({api},"Kultur");
 assert.ok(events.some(x=>x.title==="Kulturfest"&&x.page==="events"));
 const staticRooms=await hub.search({api},"A302");
 assert.ok(staticRooms.some(x=>x.title==="A302"&&x.page==="map"));
 assert.deepEqual(await hub.search({api},"C"),[]);
 assert.doesNotMatch(source,/from\(["']profiles["']\)|from\(["']auth\.users["']\)/);
});
test("dashboard navigation is role-oriented and does not grant special rights",async()=>{
 const target={innerHTML:""};
 const ctx={target,profile:{role:"admin"},schoolRoles:{operator:false,jobs:[]},polls:[]};
 await hub.enrichHome(ctx);
 assert.match(target.innerHTML,/data-nav="admin"/);
 ctx.profile.role="member";
 await hub.enrichHome(ctx);
 assert.doesNotMatch(target.innerHTML,/data-nav="admin"/);
 assert.match(target.innerHTML,/data-nav="applications"/);
});
test("room booking crosses from the map into the room reservation view",()=>{
 assert.match(plan,/data-book-room=/);
 assert.match(plan,/data-nav="rooms"/);
 assert.match(app,/prefillRoomId:/);
 assert.match(app,/data-room-search/);
 assert.match(app,/sas-global-results/);
 assert.match(worker,/portal-extras\.js/);
 assert.match(html,/portal-extras\.js/);
 assert.match(html,/portal-extras\.css/);
});
