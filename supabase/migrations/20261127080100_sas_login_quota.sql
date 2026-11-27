begin;

create schema if not exists sas_login_guard;
revoke all on schema sas_login_guard from public, anon, authenticated;

create table sas_login_guard.quota (
  singleton boolean primary key default true check (singleton),
  window_start timestamptz not null default '-infinity',
  attempts integer not null default 0,
  alias_throttles bigint not null default 0,
  saturated_windows bigint not null default 0
);
insert into sas_login_guard.quota default values;

create table sas_login_guard.alias_attempts (
  alias_key text primary key,
  attempts integer not null
);

create function public.sas_consume_login_quota(p_alias_key text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_quota sas_login_guard.quota%rowtype;
  current_window timestamptz;
  alias_count integer;
begin
  if p_alias_key is null or p_alias_key !~ '^[a-f0-9]{64}$' then
    return false;
  end if;

  select * into strict current_quota from sas_login_guard.quota
    where singleton for update;
  current_window := date_trunc('minute', clock_timestamp());
  if current_quota.window_start < current_window then
    delete from sas_login_guard.alias_attempts;
    update sas_login_guard.quota set window_start = current_window, attempts = 0 where singleton;
    current_quota.attempts := 0;
  end if;

  -- One shared budget for all Edge instances and aliases, including unknown aliases.
  if current_quota.attempts >= 1800 then
    return false;
  end if;
  update sas_login_guard.quota
    set attempts = attempts + 1,
        saturated_windows = saturated_windows + case when attempts = 1799 then 1 else 0 end
    where singleton;

  insert into sas_login_guard.alias_attempts as a (alias_key, attempts)
    values (p_alias_key, 1)
    on conflict (alias_key) do update set attempts = a.attempts + 1
      where a.attempts < 12
    returning attempts into alias_count;
  if alias_count is null then
    update sas_login_guard.quota set alias_throttles = alias_throttles + 1 where singleton;
    return false;
  end if;
  return true;
end;
$$;
revoke all on function public.sas_consume_login_quota(text) from public, anon, authenticated;
grant execute on function public.sas_consume_login_quota(text) to service_role;

commit;
