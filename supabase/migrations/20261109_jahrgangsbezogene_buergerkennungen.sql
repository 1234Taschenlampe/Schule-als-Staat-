-- Grade-prefixed six-digit citizen aliases; preserve UUIDs, old 10-char IDs,
-- hashed passwords, balances, attendance and static card QR tokens.
-- Prefix: J1=1, J2=2, teaching/staff=3, VKL=4, grades 5-9=their digit, grade 10=0.
-- Do not place any names, student rosters or login credentials in this migration.

create or replace function sas_private.sas_short_login_prefix(p_class_label text)
returns text
language plpgsql immutable security invoker set search_path = ''
as $$
declare label text := upper(btrim(coalesce(p_class_label,'')));
begin
  if label = 'J1' then return '1'; end if;
  if label = 'J2' then return '2'; end if;
  if label in ('LEHRKRAFT', 'PERSONAL') then return '3'; end if;
  if label = 'VKL' then return '4'; end if;
  if label ~ '^10[A-Z]+$' then return '0'; end if;
  if label ~ '^[5-9][A-Z]+$' then return left(label,1); end if;
  raise exception 'Keine Kurzkennungsgruppe fuer diese Jahrgangsbezeichnung.'
    using errcode='22023';
end
$$;
revoke all on function sas_private.sas_short_login_prefix(text) from public, anon, authenticated;

-- Single-row provisioning remains automatic for future official roster imports,
-- and an actual grade change automatically receives the new grade prefix.
create or replace function sas_private.sas_assign_short_login_id()
returns trigger language plpgsql security definer set search_path = ''
as $$
declare
  prefix text := sas_private.sas_short_login_prefix(new.class_label);
  candidate text;
  entropy bytea;
begin
  if tg_op = 'UPDATE' and new.class_label is not distinct from old.class_label then
    return new;
  end if;
  if new.short_login_id is not null
      and new.short_login_id ~ '^SAS-[0-9]{6}$'
      and substring(new.short_login_id from 5 for 1) = prefix then
    return new;
  end if;
  if tg_op = 'INSERT' and new.short_login_id is not null then
    raise exception 'Die vorgegebene Buergerkennung hat ein falsches Jahrgangspraefix.'
      using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(82903);
  for attempt in 1..400 loop
    entropy := extensions.gen_random_bytes(4);
    candidate := 'SAS-' || prefix || lpad(((
      get_byte(entropy,0)::bigint * 16777216
      + get_byte(entropy,1)::bigint * 65536
      + get_byte(entropy,2)::bigint * 256
      + get_byte(entropy,3)
    ) % 100000)::text,5,'0');
    if not exists (
      select 1 from public.school_roster_members r
      where r.short_login_id=candidate
        and r.user_id is distinct from new.user_id
    ) then
      new.short_login_id := candidate;
      return new;
    end if;
  end loop;
  raise exception 'Keine eindeutige Kurzkennung verfuegbar.';
end
$$;
revoke all on function sas_private.sas_assign_short_login_id() from public, anon, authenticated;
drop trigger if exists sas_assign_short_login_id on public.school_roster_members;
create trigger sas_assign_short_login_id
before insert or update of class_label on public.school_roster_members
for each row execute function sas_private.sas_assign_short_login_id();

-- Reassign only the rows whose prefix is currently wrong.
-- Old aliases stay reserved for the entire batch to avoid a rename collision;
-- do not retain an unnecessary mapping of old IDs or any identifiable roster.
do $$
declare
  rec record;
  used_ids text[];
  prefix text;
  candidate text;
  entropy bytea;
  found_candidate boolean;
begin
  perform pg_advisory_xact_lock(82903);
  lock table public.school_roster_members in share row exclusive mode;
  select coalesce(array_agg(short_login_id),array[]::text[])
    into used_ids from public.school_roster_members;
  for rec in
    select user_id,class_label,short_login_id
    from public.school_roster_members order by user_id
  loop
    prefix := sas_private.sas_short_login_prefix(rec.class_label);
    if substring(rec.short_login_id from 5 for 1)=prefix then
      continue;
    end if;
    found_candidate := false;
    for attempt in 1..400 loop
      entropy := extensions.gen_random_bytes(4);
      candidate := 'SAS-' || prefix || lpad(((
        get_byte(entropy,0)::bigint * 16777216
        + get_byte(entropy,1)::bigint * 65536
        + get_byte(entropy,2)::bigint * 256
        + get_byte(entropy,3)
      ) % 100000)::text,5,'0');
      if not candidate = any(used_ids) then
        update public.school_roster_members
        set short_login_id=candidate
        where user_id=rec.user_id;
        used_ids := array_append(used_ids,candidate);
        found_candidate := true;
        exit;
      end if;
    end loop;
    if not found_candidate then
      raise exception 'Keine freie eindeutige Jahrgangskennung gefunden.';
    end if;
  end loop;
end
$$;

-- Independently enforce the prefix rule even on direct short_login_id updates.
alter table public.school_roster_members
  add constraint sas_short_login_class_prefix
  check (
    short_login_id ~ '^SAS-[0-9]{6}$'
    and substring(short_login_id from 5 for 1) =
      case
        when upper(btrim(class_label))='J1' then '1'
        when upper(btrim(class_label))='J2' then '2'
        when upper(btrim(class_label)) in ('LEHRKRAFT','PERSONAL') then '3'
        when upper(btrim(class_label))='VKL' then '4'
        when upper(btrim(class_label)) ~ '^10[A-Z]+$' then '0'
        when upper(btrim(class_label)) ~ '^[5-9][A-Z]+$'
          then left(upper(btrim(class_label)),1)
        else null
      end
  );

-- Fail the whole migration if any roster record remains mismatched or duplicated.
do $$
begin
  if exists (
    select 1 from public.school_roster_members r
    where substring(r.short_login_id from 5 for 1)
      is distinct from sas_private.sas_short_login_prefix(r.class_label)
  ) then raise exception 'Jahrgangspruefung fehlgeschlagen.'; end if;
  if (select count(*) from public.school_roster_members) <>
     (select count(distinct short_login_id) from public.school_roster_members) then
    raise exception 'Doppelte Buergerkennungen festgestellt.'; end if;
end
$$;
