-- V5: shared authenticated bulletin board and project blog.
-- No personal documents, photos or visa addresses are stored here.
create table if not exists public.portal_posts (
  id uuid primary key default gen_random_uuid(),
  section text not null check (section in ('news','blog')),
  title text not null check (char_length(btrim(title)) between 4 and 140),
  body text not null check (char_length(btrim(body)) between 4 and 4000),
  author_id uuid not null references auth.users(id),
  published boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists portal_posts_section_created_idx
  on public.portal_posts (section, created_at desc);
alter table public.portal_posts enable row level security;

revoke all on public.portal_posts from public, anon;
grant select, insert, delete on public.portal_posts to authenticated;

create policy portal_posts_read on public.portal_posts
  for select to authenticated using (
    published or exists(
      select 1 from public.profiles p
      where p.id=(select auth.uid()) and p.role='admin'
    )
  );
create policy portal_posts_admin_insert on public.portal_posts
  for insert to authenticated with check (
    author_id=(select auth.uid()) and exists(
      select 1 from public.profiles p
      where p.id=(select auth.uid()) and p.role='admin'
    )
  );
create policy portal_posts_admin_delete on public.portal_posts
  for delete to authenticated using (
    exists(
      select 1 from public.profiles p
      where p.id=(select auth.uid()) and p.role='admin'
    )
  );
