import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");

test("verified student ID and gallery render the user's decrypted name before the pseudonym",()=>{
 const app=read("app.js"),features=read("features.js");
 assert.match(app,/my_secure_school_name/);
 assert.match(app,/if\(typeof secureName===\x27string\x27&&secureName\.trim\(\)\)state\.profile\.display_name=secureName\.trim\(\)/);
 assert.match(features,/name=ctx\.profile\.display_name\|\|c\?\.display_name/);
 assert.match(features,/escapeHtml\(ctx\.profile\.display_name\|\|data\[0\]\?\.display_name/);
 assert.match(features,/identityLocked=ctx\.profile\.role!=="admin"/);
 assert.match(features,/api\.from\('student_cards'\)\.select\('\*'\)\.eq\('user_id',u\)\.limit\(1\)/);
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
