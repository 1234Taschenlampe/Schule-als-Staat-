import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const app=read('app.js'),sql=read('supabase/migrations/20261103_school_legal_and_deletion.sql');

test('first login requires two distinct, unchecked acknowledgements, not a blanket GDPR consent',()=>{
 assert.match(app,/id="roster-first-password-form"/);
 assert.match(app,/function legalReceiptFields/);
 assert.match(app,/name="notice_read" required/);
 assert.match(app,/name="rules_accepted" required/);
 assert.doesNotMatch(app,/name="notice_read" checked/);
 assert.doesNotMatch(app,/name="rules_accepted" checked/);
 assert.match(app,/rpc\("acknowledge_school_legal"/);
 assert.match(sql,/acknowledged_at timestamptz/);
 assert.match(sql,/notice_version='2026-11-03'/);
});

test('users can request deletion without legal acknowledgement or a required reason',()=>{
 assert.match(app,/data-action="open-deletion"/);
 assert.match(app,/function dataDeletionRequestView/);
 assert.match(app,/if\(state.user&&state.showDeletionForm\)/);
 assert.match(app,/if\(state.user\?\.app_metadata\?\.sas_initial_password/);
 assert.ok(app.indexOf('if(state.user&&state.showDeletionForm)')<app.indexOf('if(state.user?.app_metadata?.sas_initial_password'), 'deletion option before first login gate');
 assert.match(app,/option value="keine_angabe"/);
 assert.match(app,/window.confirm\("Willst du die Löschung wirklich beantragen/);
 assert.match(app,/request_my_school_data_deletion/);
 assert.match(sql,/update public.profiles set vote_eligible=false/);
 assert.match(sql,/sas_private.school_deletion_voting_guard/);
});

test('sensitive tables are private and admin review has a role check',()=>{
 for(const table of ['school_deletion_requests','school_legal_acknowledgements']){
  assert.match(sql,new RegExp('alter table sas_private\\.'+table+' enable row level security'));
  assert.match(sql,new RegExp('revoke all on sas_private\\.'+table+' from public,anon,authenticated'));
 }
 assert.match(sql,/role='admin'/);
 assert.match(sql,/admin_list_school_deletion_requests/);
 assert.match(app,/review-data-deletion/);
});

test('privacy and rules are directly reachable, and closure does not overpromise',()=>{
 const privacy=read('datenschutz.html'),terms=read('nutzungsregeln.html'),index=read('index.html');
 assert.match(index,/href="\/nutzungsregeln.html"/);
 assert.match(privacy,/31\. Juli 2027/);
 assert.match(privacy,/Eine automatische Löschung ist aktuell noch nicht eingerichtet/);
 assert.match(terms,/keine kommerziellen Allgemeinen Geschäftsbedingungen/);
 assert.match(read('scripts/build-worker.mjs'),/"nutzungsregeln\.html"/);
});

test('student polling cutoff is consistent with source migration',()=>{
 assert.match(app,/2026-11-25T23:00:00Z/);
 const src=read('supabase/migrations/20261103_student_preview_write_guard.sql');
 assert.match(src,/2026-11-26 00:00:00/);
});
