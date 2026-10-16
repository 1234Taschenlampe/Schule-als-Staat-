-- SaS ONE V6: functional portal without demo transactions. All data stays in existing Supabase Free.
-- Personal data needs school approval and privacy review before school-wide rollout.
create extension if not exists btree_gist;

create or replace function public.sas_is_admin()
returns boolean language sql stable security invoker set search_path=''
as $$ select exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin') $$;
revoke all on function public.sas_is_admin() from public,anon;
grant execute on function public.sas_is_admin() to authenticated;

create table if not exists public.student_cards (
 user_id uuid primary key references auth.users(id) on delete cascade,
 display_name text not null check (char_length(btrim(display_name)) between 2 and 80),
 class_label text not null default '' check (char_length(class_label)<=24),
 design text not null default 'classic' check (design in ('classic','blue','forest','mono')),
 updated_at timestamptz not null default now()
);
alter table public.student_cards enable row level security;
revoke all on public.student_cards from public,anon;
grant select,insert,update on public.student_cards to authenticated;
create policy sas_card_read on public.student_cards for select to authenticated using (user_id=(select auth.uid()) or (select public.sas_is_admin()));
create policy sas_card_create on public.student_cards for insert to authenticated with check (user_id=(select auth.uid()));
create policy sas_card_edit on public.student_cards for update to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));

create table if not exists public.visa_applications (
 id uuid primary key default gen_random_uuid(),
 applicant_id uuid not null references auth.users(id) on delete cascade,
 first_name text not null check(char_length(btrim(first_name)) between 2 and 80),
 last_name text not null check(char_length(btrim(last_name)) between 2 and 80),
 origin_country text not null check(char_length(btrim(origin_country)) between 2 and 80),
 accommodation text not null check(char_length(btrim(accommodation)) between 2 and 100),
 address_line text not null check(char_length(btrim(address_line)) between 4 and 160),
 postal_city text not null check(char_length(btrim(postal_city)) between 4 and 120),
 preferred_language text not null check(char_length(btrim(preferred_language)) between 2 and 60),
 school_class text not null check(char_length(btrim(school_class)) between 1 and 60),
 planned_entry date not null,
 contact_email text not null check(char_length(contact_email) between 6 and 200),
 acknowledged_privacy boolean not null check(acknowledged_privacy),
 status text not null default 'submitted' check(status in('submitted','approved','rejected')),
 reviewer_note text not null default '' check(char_length(reviewer_note)<=500),
 submitted_at timestamptz not null default now(),
 reviewed_at timestamptz
);
create index if not exists visa_user_date on public.visa_applications(applicant_id,submitted_at desc);
alter table public.visa_applications enable row level security;
revoke all on public.visa_applications from public,anon;
grant select,insert,update on public.visa_applications to authenticated;
create policy sas_visa_read on public.visa_applications for select to authenticated using(applicant_id=(select auth.uid()) or (select public.sas_is_admin()));
create policy sas_visa_submit on public.visa_applications for insert to authenticated
 with check(applicant_id=(select auth.uid()) and status='submitted' and reviewer_note='' and reviewed_at is null);
create policy sas_visa_review on public.visa_applications for update to authenticated
 using((select public.sas_is_admin())) with check((select public.sas_is_admin()));

create table if not exists public.school_places(
 id uuid primary key default gen_random_uuid(),
 name text not null check(char_length(btrim(name)) between 2 and 100),
 kind text not null check(kind in ('room','shop','service','other')),
 floor_label text not null default '' check(char_length(floor_label)<=40),
 detail text not null default '' check(char_length(detail)<=500),
 x_percent numeric(5,2) check(x_percent between 0 and 100),
 y_percent numeric(5,2) check(y_percent between 0 and 100),
 owner_id uuid references auth.users(id) on delete set null,
 active boolean not null default true,
 created_at timestamptz not null default now()
);
create index if not exists sas_places_kind on public.school_places(kind,active);
alter table public.school_places enable row level security;
revoke all on public.school_places from public,anon;
grant select,insert,update,delete on public.school_places to authenticated;
create policy sas_places_view on public.school_places for select to authenticated using(active or (select public.sas_is_admin()));
create policy sas_places_insert on public.school_places for insert to authenticated with check((select public.sas_is_admin()));
create policy sas_places_update on public.school_places for update to authenticated using((select public.sas_is_admin())) with check((select public.sas_is_admin()));
create policy sas_places_delete on public.school_places for delete to authenticated using((select public.sas_is_admin()));

create table if not exists public.room_bookings (
 id uuid primary key default gen_random_uuid(),
 place_id uuid not null references public.school_places(id) on delete cascade,
 booked_by uuid not null references auth.users(id) on delete cascade,
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 purpose text not null check(char_length(btrim(purpose)) between 3 and 180),
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 submitted_at timestamptz not null default now(),
 check(ends_at>starts_at and ends_at<=starts_at+interval '8 hours')
);
-- Prevent double-booked approved rooms under concurrency, not merely in client-side checks.
alter table public.room_bookings add constraint sas_no_approved_room_overlap
  exclude using gist(place_id with =, tstzrange(starts_at,ends_at,'[)') with &&)
  where(status='approved');
create index if not exists sas_bookings_room_time on public.room_bookings(place_id,starts_at);
alter table public.room_bookings enable row level security;
revoke all on public.room_bookings from public,anon;
grant select,insert,update,delete on public.room_bookings to authenticated;
create policy sas_bookings_read on public.room_bookings for select to authenticated using(booked_by=(select auth.uid()) or status='approved' or (select public.sas_is_admin()));
create policy sas_bookings_submit on public.room_bookings for insert to authenticated with check(
 booked_by=(select auth.uid()) and status='pending' and starts_at>now()
 and exists(select 1 from public.school_places p where p.id=place_id and p.kind='room' and p.active)
);
create policy sas_bookings_admin_update on public.room_bookings for update to authenticated using((select public.sas_is_admin())) with check((select public.sas_is_admin()));
create policy sas_bookings_cancel on public.room_bookings for delete to authenticated using((booked_by=(select auth.uid()) and status='pending') or (select public.sas_is_admin()));

create table if not exists public.school_events (
 id uuid primary key default gen_random_uuid(),
 title text not null check(char_length(btrim(title)) between 3 and 150),
 description text not null default '' check(char_length(description)<=3000),
 starts_at timestamptz not null,
 ends_at timestamptz not null,
 place_id uuid references public.school_places(id) on delete set null,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 check(ends_at>starts_at)
);
alter table public.school_events enable row level security;
revoke all on public.school_events from public,anon;
grant select,insert,update,delete on public.school_events to authenticated;
create policy sas_events_read on public.school_events for select to authenticated using(true);
create policy sas_events_admin_insert on public.school_events for insert to authenticated with check(created_by=(select auth.uid()) and (select public.sas_is_admin()));
create policy sas_events_admin_update on public.school_events for update to authenticated using((select public.sas_is_admin())) with check((select public.sas_is_admin()));
create policy sas_events_admin_delete on public.school_events for delete to authenticated using((select public.sas_is_admin()));

create table if not exists public.event_rsvps (
 event_id uuid not null references public.school_events(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(event_id,user_id)
);
alter table public.event_rsvps enable row level security;
revoke all on public.event_rsvps from public,anon;
grant select,insert,delete on public.event_rsvps to authenticated;
create policy sas_rsvps_read on public.event_rsvps for select to authenticated using(user_id=(select auth.uid()) or (select public.sas_is_admin()));
create policy sas_rsvps_insert on public.event_rsvps for insert to authenticated
 with check(user_id=(select auth.uid()) and exists(select 1 from public.school_events e where e.id=event_id and e.starts_at>now()));
create policy sas_rsvps_delete on public.event_rsvps for delete to authenticated using(user_id=(select auth.uid()) or (select public.sas_is_admin()));

create table if not exists public.lost_items (
 id uuid primary key default gen_random_uuid(),
 created_by uuid not null references auth.users(id) on delete cascade,
 kind text not null check(kind in ('lost','found')),
 title text not null check(char_length(btrim(title)) between 4 and 120),
 detail text not null check(char_length(btrim(detail)) between 5 and 1200),
 location_hint text not null default '' check(char_length(location_hint)<=120),
 status text not null default 'open' check(status in ('open','resolved')),
 created_at timestamptz not null default now()
);
alter table public.lost_items enable row level security;
revoke all on public.lost_items from public,anon;
grant select,insert,update,delete on public.lost_items to authenticated;
create policy sas_lost_read on public.lost_items for select to authenticated using(true);
create policy sas_lost_insert on public.lost_items for insert to authenticated with check(created_by=(select auth.uid()) and status='open');
create policy sas_lost_update on public.lost_items for update to authenticated using((select public.sas_is_admin())) with check((select public.sas_is_admin()));
create policy sas_lost_delete on public.lost_items for delete to authenticated using((created_by=(select auth.uid()) and status='open') or (select public.sas_is_admin()));

-- Jobs, government information, parties, and justice notices (not private case records).
create table if not exists public.civic_posts (
 id uuid primary key default gen_random_uuid(),
 kind text not null check(kind in ('job','law','party','court')),
 title text not null check(char_length(btrim(title)) between 4 and 140),
 body text not null check(char_length(btrim(body)) between 4 and 4000),
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists civic_kind_created on public.civic_posts(kind,created_at desc);
alter table public.civic_posts enable row level security;
revoke all on public.civic_posts from public,anon;
grant select,insert,delete on public.civic_posts to authenticated;
create policy sas_civic_read on public.civic_posts for select to authenticated using(true);
create policy sas_civic_insert on public.civic_posts for insert to authenticated with check(created_by=(select auth.uid()) and (select public.sas_is_admin()));
create policy sas_civic_delete on public.civic_posts for delete to authenticated using((select public.sas_is_admin()));

create table if not exists public.job_applications (
 id uuid primary key default gen_random_uuid(),
 job_id uuid not null references public.civic_posts(id) on delete cascade,
 applicant_id uuid not null references auth.users(id) on delete cascade,
 motivation text not null check(char_length(btrim(motivation)) between 10 and 1000),
 submitted_at timestamptz not null default now(),
 unique(job_id,applicant_id)
);
alter table public.job_applications enable row level security;
revoke all on public.job_applications from public,anon;
grant select,insert,delete on public.job_applications to authenticated;
create policy sas_job_read on public.job_applications for select to authenticated using(applicant_id=(select auth.uid()) or (select public.sas_is_admin()));
create policy sas_job_apply on public.job_applications for insert to authenticated
 with check(applicant_id=(select auth.uid()) and exists(select 1 from public.civic_posts p where p.id=job_id and p.kind='job'));
create policy sas_job_withdraw on public.job_applications for delete to authenticated using(applicant_id=(select auth.uid()) or (select public.sas_is_admin()));
