-- V4 add-on: school polls, one ballot per approved account and admin-only live tally.
-- Execute AFTER supabase/schema.sql, exactly once (safe to re-run to update functions).
-- No individual ballots are exposed via the Data API.

alter table public.profiles add column if not exists vote_eligible boolean not null default false;

create table if not exists public.polls (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(btrim(title)) between 5 and 160),
  description text not null default '' check (char_length(description)<=500),
  status text not null default 'open' check (status in ('open','closed')),
  created_by uuid not null references public.profiles(id),
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint poll_closed_consistency check ((status='open' and closed_at is null) or (status='closed' and closed_at is not null))
);

create table if not exists public.poll_options (
  id uuid primary key default gen_random_uuid(),
  poll_id uuid not null references public.polls(id) on delete restrict,
  label text not null check (char_length(btrim(label)) between 1 and 100),
  sort_order integer not null,
  unique(poll_id,id),
  unique(poll_id,sort_order)
);

create table if not exists public.poll_ballots (
  poll_id uuid not null references public.polls(id) on delete restrict,
  voter_id uuid not null references public.profiles(id) on delete restrict,
  option_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (poll_id,voter_id),
  foreign key (poll_id,option_id) references public.poll_options(poll_id,id)
);
create index if not exists poll_ballots_option_idx on public.poll_ballots (poll_id,option_id);
create index if not exists polls_created_desc_idx on public.polls(created_at desc);

alter table public.polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_ballots enable row level security;
revoke all on public.polls,public.poll_options,public.poll_ballots from public,anon,authenticated;
-- Poll data is returned ONLY by vetted RPCs; ballots remain private.
-- SQL administrators can still access individual ballots for maintenance; this is NOT cryptographic anonymity.

create or replace function public.poll_catalog()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_result jsonb;
begin
  if v_uid is null then raise exception 'Anmeldung erforderlich.'; end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',p.id,'title',p.title,'description',p.description,
      'status',p.status,'created_at',p.created_at,
      'options',coalesce((
        select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label) order by o.sort_order)
        from public.poll_options o where o.poll_id=p.id
      ),'[]'::jsonb),
      'has_voted',exists(select 1 from public.poll_ballots b where b.poll_id=p.id and b.voter_id=v_uid)
    ) order by p.created_at desc
  ),'[]'::jsonb) into v_result
  from (select * from public.polls order by created_at desc limit 50) p;
  return v_result;
end;
$$;

create or replace function public.submit_vote(p_poll_id uuid,p_option_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_status text;
begin
  if v_uid is null then raise exception 'Anmeldung erforderlich.'; end if;
  if not exists (
    select 1 from public.profiles where id=v_uid and vote_eligible=true
  ) then raise exception 'Dein Konto wurde noch nicht zur Abstimmung freigeschaltet.'; end if;

  -- Serialize close-poll and submit-vote; prevents ballots after close.
  select status into v_status from public.polls where id=p_poll_id for share;
  if not found then raise exception 'Abstimmung nicht gefunden.'; end if;
  if v_status<>'open' then raise exception 'Abstimmung ist geschlossen.'; end if;
  if not exists(select 1 from public.poll_options where id=p_option_id and poll_id=p_poll_id) then
    raise exception 'Antwortoption gehört nicht zu dieser Abstimmung.';
  end if;

  -- PRIMARY KEY(poll_id,voter_id) rejects double votes, including concurrent requests.
  insert into public.poll_ballots(poll_id,voter_id,option_id)
    values(p_poll_id,v_uid,p_option_id);
  return true;
exception
  when unique_violation then raise exception 'Du hast bereits abgestimmt.';
end;
$$;

create or replace function public.admin_create_poll(
  p_title text,p_description text,p_options text[]
)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_id uuid; v_n int; v_option text; v_index int := 0;
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role='admin') then
    raise exception 'Nur die Administration darf Abstimmungen erstellen.';
  end if;
  if p_title is null or char_length(btrim(p_title)) not between 5 and 160 then
    raise exception 'Titel muss zwischen 5 und 160 Zeichen lang sein.';
  end if;
  if p_options is null then raise exception 'Mindestens zwei Optionen erforderlich.'; end if;
  v_n:=coalesce(array_length(p_options,1),0);
  if v_n<2 or v_n>10 or array_ndims(p_options)<>1 then
    raise exception 'Es müssen 2 bis 10 Antwortoptionen angegeben werden.';
  end if;
  if exists(select 1 from unnest(p_options) x where x is null or char_length(btrim(x)) not between 1 and 100) then
    raise exception 'Antwortoptionen müssen zwischen 1 und 100 Zeichen lang sein.';
  end if;
  if (select count(distinct lower(btrim(x))) from unnest(p_options) x)<>v_n then
    raise exception 'Doppelte Antwortoptionen sind nicht erlaubt.';
  end if;
  insert into public.polls(title,description,created_by)
    values(btrim(p_title),left(coalesce(p_description,''),500),v_uid) returning id into v_id;
  foreach v_option in array p_options loop
    v_index:=v_index+1;
    insert into public.poll_options(poll_id,label,sort_order) values(v_id,btrim(v_option),v_index);
  end loop;
  return v_id;
end;
$$;

create or replace function public.admin_close_poll(p_poll_id uuid)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role='admin') then
    raise exception 'Nur die Administration darf Abstimmungen schließen.';
  end if;
  update public.polls set status='closed',closed_at=now()
  where id=p_poll_id and status='open';
  if not found then raise exception 'Abstimmung nicht gefunden oder bereits geschlossen.'; end if;
  return true;
end;
$$;

create or replace function public.admin_poll_results()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_data jsonb;
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role='admin') then
    raise exception 'Nur Administratoren sehen die Live-Auswertung.';
  end if;
  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',p.id,'title',p.title,'status',p.status,
      'total', (select count(*) from public.poll_ballots b where b.poll_id=p.id),
      'options',coalesce((
        select jsonb_agg(jsonb_build_object('id',o.id,'label',o.label,
          'count',(select count(*) from public.poll_ballots b where b.poll_id=p.id and b.option_id=o.id)
        ) order by o.sort_order)
        from public.poll_options o where o.poll_id=p.id
      ),'[]'::jsonb)
    ) order by p.created_at desc
  ),'[]'::jsonb) into v_data
  from (select * from public.polls order by created_at desc limit 50) p;
  return v_data;
end;
$$;

-- Replace existing admin directory RPC with vote approval status.
-- The email is visible only to admin inside this RPC and is used to verify school membership.
create or replace function public.admin_list_users()
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid(); v_data jsonb;
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role='admin') then
    raise exception 'Keine Administratorberechtigung.';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',p.id,'name',p.display_name,'role',p.role,'vote_eligible',p.vote_eligible,
    'email',u.email
  ) order by p.display_name),'[]'::jsonb) into v_data
  from public.profiles p left join auth.users u on u.id=p.id;
  return v_data;
end;
$$;

create or replace function public.admin_set_vote_eligibility(p_user_id uuid,p_enabled boolean)
returns boolean language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null or not exists(select 1 from public.profiles where id=v_uid and role='admin') then
    raise exception 'Keine Administratorberechtigung.';
  end if;
  if p_enabled is null then raise exception 'Freigabe muss explizit gesetzt werden.'; end if;
  update public.profiles set vote_eligible=p_enabled where id=p_user_id;
  if not found then raise exception 'Benutzer nicht gefunden.'; end if;
  return true;
end;
$$;

revoke all on function public.poll_catalog(),public.submit_vote(uuid,uuid),
  public.admin_create_poll(text,text,text[]),public.admin_close_poll(uuid),
  public.admin_poll_results(),public.admin_set_vote_eligibility(uuid,boolean)
  from public,anon,authenticated;
grant execute on function public.poll_catalog(),public.submit_vote(uuid,uuid),
  public.admin_create_poll(text,text,text[]),public.admin_close_poll(uuid),
  public.admin_poll_results(),public.admin_set_vote_eligibility(uuid,boolean)
  to authenticated;
-- admin_list_users remains accessible to authenticated callers at SQL permission level
-- but rejects all non-admin callers inside its definer body.
