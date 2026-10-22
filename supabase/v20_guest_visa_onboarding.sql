-- Public visitor visa applications, separated from citizen accounts.
create table if not exists public.guest_visa_applications(
 id uuid primary key default gen_random_uuid(),
 first_name text not null check(char_length(first_name) between 1 and 80),
 last_name text not null check(char_length(last_name) between 1 and 80),
 origin_country text not null check(char_length(origin_country) between 2 and 80),
 planned_entry date not null,
 contact_email text not null check(char_length(contact_email) between 5 and 200),
 school_class text not null default '',
 privacy_accepted boolean not null check(privacy_accepted),
 status text not null default 'submitted' check(status in ('submitted','approved','rejected')),
 submitted_at timestamptz not null default now()
);
alter table public.guest_visa_applications enable row level security;
revoke all on public.guest_visa_applications from public,anon,authenticated;
grant select on public.guest_visa_applications to authenticated;
create policy guest_visa_admin_read on public.guest_visa_applications for select to authenticated using (public.sas_is_admin());
create or replace function public.submit_guest_visa(p_first_name text,p_last_name text,p_origin_country text,p_planned_entry date,p_contact_email text,p_school_class text,p_privacy_accepted boolean,p_website text default '')
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_email text:=lower(btrim(coalesce(p_contact_email,'')));v_id uuid;
begin
 if coalesce(p_website,'')<>'' then raise exception 'Anfrage nicht angenommen.';end if;
 if p_privacy_accepted is distinct from true then raise exception 'Datenschutzhinweise müssen bestätigt werden.';end if;
 if char_length(btrim(coalesce(p_first_name,''))) not between 1 and 80 or char_length(btrim(coalesce(p_last_name,''))) not between 1 and 80
 or char_length(btrim(coalesce(p_origin_country,''))) not between 2 and 80 or char_length(btrim(coalesce(p_school_class,'')))>60
 or char_length(v_email) not between 5 and 200 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
 or p_planned_entry is null or p_planned_entry<current_date or p_planned_entry>current_date+interval '2 years'
 then raise exception 'Bitte alle Angaben prüfen.';end if;
 perform pg_advisory_xact_lock(hashtextextended(v_email,1937));
 if (select count(*) from public.guest_visa_applications where contact_email=v_email and submitted_at>now()-interval '1 day')>=3
 then raise exception 'Zu viele Anträge. Bitte morgen erneut versuchen.';end if;
 if exists(select 1 from public.guest_visa_applications where contact_email=v_email and submitted_at>now()-interval '15 minutes')
 then raise exception 'Bitte vor einem weiteren Antrag 15 Minuten warten.';end if;
 insert into public.guest_visa_applications(first_name,last_name,origin_country,planned_entry,contact_email,school_class,privacy_accepted)
 values(btrim(p_first_name),btrim(p_last_name),btrim(p_origin_country),p_planned_entry,v_email,btrim(coalesce(p_school_class,'')),true) returning id into v_id;
 return jsonb_build_object('submitted',true);
end;
$$;
revoke execute on function public.submit_guest_visa(text,text,text,date,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.submit_guest_visa(text,text,text,date,text,text,boolean,text) to anon,authenticated;
