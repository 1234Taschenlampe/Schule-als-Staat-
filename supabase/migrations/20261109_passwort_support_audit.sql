-- Auditing of administrator-assisted password resets; no passwords or names are recorded.
create table if not exists public.school_password_reset_audit(
  id uuid primary key default gen_random_uuid(),
  target_user_id uuid not null references public.profiles(id),
  performed_by uuid not null references public.profiles(id),
  reset_at timestamptz not null default now()
);
alter table public.school_password_reset_audit enable row level security;
revoke all on public.school_password_reset_audit from anon,authenticated;
create index if not exists school_password_reset_audit_target_idx on public.school_password_reset_audit(target_user_id,reset_at desc);
create index if not exists school_password_reset_audit_actor_idx on public.school_password_reset_audit(performed_by,reset_at desc);
