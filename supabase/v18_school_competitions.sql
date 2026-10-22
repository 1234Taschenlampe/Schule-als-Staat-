-- Two competitions are prepared as drafts. No ballots can be cast until actual entries are provided.
create table if not exists public.school_competitions (
 slug text primary key check(slug in ('state_name','state_flag')),
 title text not null,
 description text not null,
 status text not null default 'awaiting_entries' check(status in ('awaiting_entries','ready','open','closed')),
 poll_id uuid unique references public.polls(id),
 created_at timestamptz not null default now()
);
insert into public.school_competitions(slug,title,description)
values
('state_name','Wettbewerb: Name unseres Schulstaats','Die eingereichten Namensvorschläge werden nach Freigabe zur Abstimmung gestellt.'),
('state_flag','Wettbewerb: Flagge unseres Schulstaats','Die eingereichten Flaggenbilder werden nach Freigabe zur Abstimmung gestellt.')
on conflict(slug) do nothing;
create table if not exists public.school_competition_entries (
 id uuid primary key default gen_random_uuid(),
 competition_slug text not null references public.school_competitions(slug),
 title text not null check(char_length(btrim(title)) between 2 and 100),
 image_path text,
 approved boolean not null default false,
 submitted_by uuid references auth.users(id),
 created_at timestamptz not null default now(),
 check(image_path is null or (length(image_path)<300 and image_path !~ '[<>]'))
);
create index if not exists school_competition_entries_competition_idx on public.school_competition_entries(competition_slug,approved);
alter table public.school_competitions enable row level security;
alter table public.school_competition_entries enable row level security;
revoke all on public.school_competitions,public.school_competition_entries from public,anon,authenticated;
grant select on public.school_competitions to authenticated;
create policy "school_competitions_visible" on public.school_competitions for select to authenticated using (true);
grant select on public.school_competition_entries to authenticated;
create policy "school_competition_entries_visible" on public.school_competition_entries for select to authenticated using (approved);
-- Entries will be added after the user supplies the contestants and flag images.
