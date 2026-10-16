-- V11: Einführungs-Tutorial für neue Mitglieder. Keine realen Quizantworten gespeichert.
-- Progress per authenticated student, never per browser/device; safe to resume.
create table if not exists public.student_onboarding (
  user_id uuid primary key references auth.users(id) on delete cascade,
  current_step smallint not null default 0 check (current_step between 0 and 6),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint student_onboarding_completion_check check (completed_at is null or current_step = 6)
);
alter table public.student_onboarding enable row level security;
revoke all on public.student_onboarding from public,anon;
grant select,insert,update on public.student_onboarding to authenticated;
create policy student_onboarding_read on public.student_onboarding
  for select to authenticated using (user_id=(select auth.uid()));
create policy student_onboarding_create on public.student_onboarding
  for insert to authenticated with check (user_id=(select auth.uid()) and completed_at is null);
create policy student_onboarding_update on public.student_onboarding
  for update to authenticated using (user_id=(select auth.uid()))
  with check (user_id=(select auth.uid()));
-- A completion record is simply onboarding progress. It must not elevate account permissions.
