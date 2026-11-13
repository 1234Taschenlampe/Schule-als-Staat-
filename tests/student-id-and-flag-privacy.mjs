import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("student ID and gallery display citizen IDs and request only card design data",()=>{
 const app=read("app.js"),features=read("features.js");
 assert.match(app,/my_short_login_id/);
 assert.doesNotMatch(app,/my_secure_school_name/);
 assert.match(features,/citizenLabel\(ctx.user\)/);
 assert.match(features,/api\.from\('student_cards'\)\.select\('user_id,design'\)/);
 assert.doesNotMatch(features,/class_label/);
});

test("voting gallery does not fetch author identity, even using untrusted client options",()=>{
 const voting=read("flag-voting.js");
 const sql=read("supabase/migrations/20261103_flag_identity_column_access.sql");
 assert.match(voting,/school_competition_entries"\)\.select\("id,title,image_path,meaning,option_id,created_at"\)/);
 assert.doesNotMatch(voting,/\.select\([^\n]*submitted_by/);
 assert.match(sql,/REVOKE SELECT ON TABLE public\.school_competition_entries FROM authenticated/);
 assert.match(sql,/GRANT SELECT \(id, competition_slug, title, image_path, approved, created_at, meaning, option_id\)/);
 assert.doesNotMatch(sql,/GRANT SELECT \([^)]*submitted_by/);
});

test("student card is a project card with a permanent QR code",()=>{
 const features=read("features.js");
 assert.match(features,/PROJEKT 12.–16\.07\.2027/);
 assert.match(features,/QR-Code identifiziert das Konto im Projekt/);
 assert.match(features,/my_student_card_code/);
 assert.doesNotMatch(features,/NICHT ALS IDENTITÄTSNACHWEIS GÜLTIG|VORSCHAU · KEIN IDENTITÄTSNACHWEIS/);
});
