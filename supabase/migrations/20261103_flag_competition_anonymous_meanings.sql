alter table public.school_competition_entries add column if not exists meaning text not null default '';
alter table public.school_competition_entries add column if not exists option_id uuid unique references public.poll_options(id);
alter table public.school_competition_entries drop constraint if exists school_competition_entries_meaning_length;
alter table public.school_competition_entries add constraint school_competition_entries_meaning_length check (char_length(meaning) <= 1200);
create index if not exists school_competition_entries_flag_approved_idx on public.school_competition_entries (competition_slug, approved, created_at);
