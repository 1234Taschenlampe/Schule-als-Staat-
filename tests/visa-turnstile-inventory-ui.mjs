import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const src=name=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
test("Turnstile verifier uses private Vault and validates visitor challenge",()=>{
 const e=src("supabase/functions/visa-request/index.ts");
 const sql=src("supabase/migrations/20261027_visa_turnstile_vault_access.sql");
 assert.match(e,/visa_turnstile_siteverify_secret/);
 assert.match(e,/SUPABASE_SERVICE_ROLE_KEY/);
 assert.match(e,/verdict\.hostname/);
 assert.match(e,/verdict\.action/);
 assert.match(sql,/from vault\.decrypted_secrets/);
 assert.match(sql,/from public,anon,authenticated/);
 assert.match(sql,/to service_role/);
});
test("Shop inventory exports owner-only product stock with CSV formula sanitization",()=>{
 const shop=src("shop-management.js");
 assert.match(shop,/rpc\("shop_catalog",\{p_shop_id:id\}\)/);
 assert.match(shop,/owner_id===ctx\.user\.id/);
 assert.match(shop,/sas-stock-stats/);
 assert.match(shop,/text\/csv/);
 assert.match(shop,/sas-shop-inventur\.csv/);
 assert.match(shop,/shop_save_product/);
 assert.match(src("mobile-ui.css"),/hover:none/);
 assert.match(src("mobile-ui.css"),/max-width: 1199px/);
});
