import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const load=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const source=load("shop-plan.js");
const css=load("shop-plan.css");
const probeCode=source.replace("window.SAS_SHOP_PLAN={show:show};",
  "window.SAS_SHOP_PLAN={show:show};globalThis.__probe={"+
  "points:OFFICIAL_ROOM_POINTS,extra:EXTRA_ROOMS,allRooms,roomDetails,floorNavigation,"+
  "page:(n,bookable)=>{currentPage=n;currentBuilding='';rooms=bookable||[];return mapPins();},"+
  "details:(id,bookable)=>{rooms=bookable||[];selected=id;return roomDetails();}"+
  "};");
assert.notEqual(probeCode,source,"VM probe must reach scoped renderer");
const scope={window:{}};
vm.runInNewContext(probeCode,scope,{filename:"shop-plan.js"});
const p=scope.__probe;
const room=(name,page)=>p.points.find(x=>x[0]===page&&x[1]===name);

test("all seven pages: one physical, proven room marker for each official code",()=>{
  assert.equal(p.points.length,115);
  assert.deepEqual([...new Set(p.points.map(x=>x[0]))],[3,4,5,6,7]);
  const counts=Object.fromEntries([3,4,5,6,7].map(n=>[n,p.points.filter(x=>x[0]===n).length]));
  assert.deepEqual(counts,{3:7,4:37,5:39,6:27,7:5});
  assert.equal(new Set(p.points.map(x=>x[0]+":"+x[1])).size,115);
  for(const [page,code,x,y] of p.points){
    assert.match(code,/^[A-E]-?\d{3}$/);
    assert.ok(x>1&&x<68&&y>1&&y<99,code+" physical coordinate");
  }
});

test("every physically labeled room renders as a directly clickable map button",()=>{
  for(const n of [3,4,5,6,7]){
    const html=p.page(n);
    const buttons=[...html.matchAll(/data-room="/g)].length;
    assert.equal(buttons,p.points.filter(pt=>pt[0]===n).length,"page "+n);
  }
  assert.match(p.page(1),/data-building="A"/);
  assert.match(p.page(1),/data-building="E"/);
  assert.equal(p.page(2),""); // Printed directory has no physical room footprints.
  assert.ok(room("E204",5),"previously unrecognized, concatenated PDF room labels");
  assert.ok(room("A-101",3),"basement rooms not included in earlier index");
  assert.ok(room("D105",5),"physical label D105 exists");
  assert.equal(room("D102",5),undefined,"do not invent D102 geometry");
  assert.equal(room("A305",7),undefined,"A305 exists in PDF index but not the physical page");
});

test("specialist, arts, music and administration rooms stay nonbookable",()=>{
  const all=p.allRooms();
  assert.ok(all.some(r=>r.name==="A302"&&r.bookable===false));
  assert.ok(all.some(r=>r.name==="D101"&&r.bookable===false));
  assert.ok(all.some(r=>r.name==="A104"&&r.bookable===false));
  assert.ok(all.some(r=>r.name==="B-101"&&r.bookable===false));
  assert.match(p.page(7),/sas-shopmap-readonly/);
  assert.doesNotMatch(p.details("plan:A302:7"),/Shop anfragen/);
  const mock={id:"class-A003",name:"A003",plan_page:4,x_percent:41.63,y_percent:64.41,slots:[],floor:"EG"};
  assert.match(p.page(4,[mock]),/data-room="class-A003"/);
  assert.ok(!p.page(4,[mock]).includes('data-room="plan:A003:4"'),"no duplicate booking pins");
  assert.equal([...p.details("class-A003",[mock]).matchAll(/data-slot="/g)].length,4);
});

test("known D102 discrepancy must be visible instead of showing guessed coordinates",()=>{
  const mock={id:"class-D102",name:"D102",plan_page:5,x_percent:null,y_percent:null,slots:[],floor:"1. OG"};
  assert.doesNotMatch(p.page(5,[mock]),/data-room="class-D102"/);
  assert.match(p.details("class-D102",[mock]),/D105/);
  assert.match(p.details("class-D102",[mock]),/sas-shopmap-anomaly/);
});

test("mobile zoom and all seven navigation tabs remain operational",()=>{
  assert.match(source,/data-map-zoom="in"/);
  assert.match(source,/data-map-zoom="out"/);
  assert.match(source,/data-map-zoom="fit"/);
  assert.match(source,/scrollLeft=priorX/);
  assert.match(css,/\.sas-shopmap-scroll/);
  assert.match(css,/-webkit-overflow-scrolling:touch/);
  const navigation=p.floorNavigation();
  for(let n=1;n<=7;n++)assert.ok(navigation.includes('data-page="'+n+'"'));
});
