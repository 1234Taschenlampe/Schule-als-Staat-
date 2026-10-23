import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const app=read("app.js"),html=read("index.html"),map=read("shop-plan.js"),
  css=read("shop-plan.css"),builder=read("scripts/build-worker.mjs"),
  roster=read("supabase/migrations/20261023_rng_official_classrooms_47.sql"),
  shops=read("supabase/migrations/20261023_rng_classroom_shop_stalls.sql");

test("retired on-site QR school verification cannot be accessed from live UI",()=>{
  assert.doesNotMatch(app,/SAS_VERIFICATION|schoolverify|verifyadmin/);
  assert.doesNotMatch(html,/verification\.(js|css)/);
  assert.match(html,/shop-plan\.js/);
  assert.match(html,/shop-plan\.css/);
  assert.match(app,/state\.page==="map"&&window\.SAS_SHOP_PLAN/);
  assert.doesNotMatch(builder,/verification\.(js|css)/);
});

test("actual seven-page RNG PDF and browser rendering are integrated without Adobe",()=>{
  assert.doesNotThrow(()=>new vm.Script(map,{filename:"shop-plan.js"}));
  assert.match(map,/230625_digitaler-uebersichtsplan\.pdf/);
  assert.match(map,/PDF_LOCAL="\/rng-floorplan\.pdf"/);
  assert.match(map,/pdfjs-dist@4\.10\.38/);
  assert.match(map,/getDocument\(/);
  assert.match(map,/data-room=/);
  assert.match(map,/data-building=/);
  for(const building of ["A","B","C","D","E"])assert.match(map,new RegExp('["\\x27]'+building+'["\\x27]'));
  assert.match(css,/\.sas-shopmap-pins/);
  assert.match(css,/\.sas-shopmap-building/);
  assert.match(builder,/rng-floorplan\.pdf/);
  assert.match(builder,/font-src/);
  assert.match(builder,/worker-src/);
});

test("official classroom roster contains exactly 47 real classrooms, 46 placed pins and one unplaced D102",()=>{
 const lines=roster.split("\n").filter(line=>/^\('[A-E]\d{3}', 'room',/.test(line.trim()));
 assert.equal(lines.length,47);
 assert.equal(new Set(lines.map(line=>line.match(/\('([A-E]\d{3})'/)[1])).size,47);
 const perPage={4:0,5:0,6:0},geolocated={4:0,5:0,6:0};
 for(const line of lines){
  const code=line.match(/^\('([A-E]\d{3})'/)[1];
  const pg=Number(line.match(/,\s([456]), TRUE, TRUE\),?$/)[1]);
  perPage[pg]++;
  if(!line.includes("NULL, NULL,"))geolocated[pg]++;
  if(code==="D102")assert.match(line,/NULL, NULL, 5, TRUE, TRUE/);
 }
 assert.deepEqual(perPage,{4:13,5:14,6:20});
 assert.deepEqual(geolocated,{4:13,5:13,6:20});
 assert.match(roster,/E101/);
 assert.match(roster,/Gebäude E · Erdgeschoss/);
 assert.doesNotMatch(roster,/\('B-101', 'room'/);
 assert.doesNotMatch(roster,/\('A306', 'room'/);
});

test("four and only four concurrent-safe bookable shop places exist per classroom",()=>{
  assert.match(shops,/slot_no between 1 and 4/);
  assert.match(shops,/unique index if not exists sas_room_active_stall_slot/);
  assert.match(shops,/status in \('pending','approved'\)/);
  assert.match(shops,/for update/);
  assert.match(shops,/classroom_shop_enabled/);
  assert.match(shops,/shop_place_id/);
  assert.match(shops,/public\.sas_is_admin\(\)/);
  assert.match(shops,/enable row level security/);
  assert.match(map,/request_shop_stall/);
  assert.match(map,/review_shop_stall/);
  assert.match(map,/cancel_shop_stall/);
});
