import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import {readFileSync} from "node:fs";
const read=name=>readFileSync(new URL("../"+name,import.meta.url),"utf8");
const roles=read("roles.js"),attendance=read("attendance.js"),tutorial=read("tutorial.js");
const app=read("app.js"),features=read("features.js"),html=read("index.html");
const roleSQL=read("supabase/v13_school_roles.sql");
const operatorSQL=read("supabase/v13_operator_capabilities.sql");
const attendanceSQL=read("supabase/v12_attendance_qr.sql");
const tutorialSQL=read("supabase/v11_student_onboarding.sql");
for(const [name,code] of [["roles",roles],["attendance",attendance],["tutorial",tutorial],["app",app],["features",features]]){
 new vm.Script(code,{filename:name+".js"});
}

test("role hierarchy is admin, operator and multiple lesser professions",()=>{
 assert.match(roleSQL,/role_slug='operator'/);
 assert.match(roleSQL,/v_tier>=80/);
 assert.match(roleSQL,/v_target_role='admin'/);
 assert.match(roleSQL,/p_user_id=auth.uid\(\)/);
 assert.match(roleSQL,/assign_school_role/);
 assert.match(roleSQL,/create_school_job_role/);
 assert.match(roleSQL,/school_role_find_students/);
 assert.match(roleSQL,/school_role_assignments.*enable row level security/);
 assert.match(roleSQL,/revoke all on public.school_job_roles,public.school_role_assignments from public,anon,authenticated/);
 assert.match(operatorSQL,/sas_can_manage_school/);
 assert.match(operatorSQL,/admin_create_poll/);
 assert.match(operatorSQL,/admin_poll_results/);
 assert.match(operatorSQL,/review_school_verification_qr/);
 assert.match(operatorSQL,/confirm_school_verification_qr/);
 assert.match(operatorSQL,/sas_can_check_attendance/);
 assert.doesNotMatch(operatorSQL,/admin_set_cashier/);
 assert.doesNotMatch(operatorSQL,/admin_set_vote_eligibility/);
});

test("operator can assign only lower roles in the rendered roles interface",async()=>{
 const sandbox={window:{},console,Date};
 vm.runInNewContext(roles,sandbox);
 const tool=sandbox.window.SAS_SCHOOL_ROLES;
 const fake={innerHTML:"",isConnected:true,addEventListener:()=>{},dataset:{},querySelector:()=>null};
 const api={rpc:async(name)=>({error:null,data:name==="school_role_catalog"?[
 {slug:"operator",label:"Operator",tier:80,description:"Leitung"},
 {slug:"journalist",label:"Journalist",tier:10,description:"Berichte"}
 ]:[]})};
 await tool.show({api,profile:{role:"member"},schoolRoles:{operator:true},target:fake});
 assert.match(fake.innerHTML,/Berufe & Rollen/);
 assert.match(fake.innerHTML,/Journalist/);
 assert.match(fake.innerHTML,/Operator/);
 assert.match(fake.innerHTML,/Schüler finden/);
 const target={innerHTML:"",dataset:{},addEventListener:()=>{},querySelector:()=>null};
 await tool.show({api,profile:{role:"member"},schoolRoles:{operator:false},target});
 assert.match(target.textContent,/fehlen dir die Rechte/);
});

test("attendance permits only authorized checkers and uses server-side one-time passes",async()=>{
 const sandbox={window:{},console,Date};
 vm.runInNewContext(attendance,sandbox);
 const tool=sandbox.window.SAS_ATTENDANCE;
 const fake={innerHTML:"",dataset:{},addEventListener:()=>{},querySelector:()=>null};
 const api={rpc:async()=>({data:[],error:null})};
 await tool.show({api,profile:{role:"member"},schoolRoles:{can_check_attendance:false},target:fake});
 assert.match(fake.innerHTML,/Kein Zugriff/);
 await tool.show({api,profile:{role:"member"},schoolRoles:{can_check_attendance:true},target:{innerHTML:"",dataset:{},addEventListener:()=>{},querySelector:()=>null}});
 assert.match(attendance,/create_attendance_pass/);
 assert.match(attendance,/scan_attendance_pass/);
 assert.match(attendance,/open_attendance_session/);
 assert.match(attendanceSQL,/primary key\(session_id,user_id\)/);
 assert.match(attendanceSQL,/on conflict\(session_id,user_id\) do nothing/);
 assert.match(attendanceSQL,/extensions\.digest/);
 assert.match(attendanceSQL,/interval '2 minutes'/);
 assert.match(attendanceSQL,/revoke all on public.attendance_checkers,public.attendance_sessions,public.attendance_scans,public.attendance_passes from public,anon,authenticated/);
 assert.match(features,/id-attendance-qr/);
 assert.match(features,/id-school-qr/);
});

test("first-visit tutorial is per-account and never asks for real passwords or pays",()=>{
 const sandbox={window:{},console,Date};
 vm.runInNewContext(tutorial,sandbox);
 assert.equal(sandbox.window.SAS_TUTORIAL.lessonsCount,6);
 assert.match(tutorial,/Tippe das Wort/);
 assert.match(tutorial,/normalize/);
 assert.match(tutorial,/student_onboarding/);
 assert.match(tutorial,/completed_at/);
 assert.match(tutorial,/Später weitermachen/);
 assert.match(tutorial,/KEIN Geld/);
 assert.match(tutorialSQL,/student_onboarding_read/);
 assert.match(tutorialSQL,/student_onboarding_update/);
 assert.match(app,/SAS_TUTORIAL\.start/);
 assert.match(app,/restart-tutorial/);
 assert.match(html,/tutorial\.js/);
 assert.match(html,/roles\.js/);
 assert.match(html,/attendance\.js/);
 assert.match(html,/tutorial\.css/);
});

test("operator election UI has no financial admin rights",()=>{
 assert.match(app,/state\.schoolRoles\?\.operator/);
 assert.match(app,/admin_poll_results/);
 assert.match(app,/admin_create_poll/);
 assert.match(app,/admin_set_cashier/);
 assert.match(app,/Kassenberechtigung/);
 assert.match(app,/state\.profile\.role!==\"admin\"/);
});
