
alter table public.school_places
 add column if not exists classroom_shop_enabled boolean not null default false,
 add column if not exists plan_page smallint;
alter table public.school_places drop constraint if exists school_places_plan_page_range;
alter table public.school_places add constraint school_places_plan_page_range
 check(plan_page is null or plan_page between 1 and 40);
create unique index if not exists sas_classroom_code_unique
 on public.school_places(lower(btrim(name))) where kind='room' and active;

create table if not exists public.school_shop_stalls(
 id uuid primary key default gen_random_uuid(),
 room_id uuid not null references public.school_places(id) on delete restrict,
 slot_no smallint not null check(slot_no between 1 and 4),
 requested_by uuid not null references auth.users(id) on delete cascade,
 shop_name text not null check(char_length(btrim(shop_name)) between 3 and 100),
 description text not null default '' check(char_length(description)<=450),
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 shop_place_id uuid references public.school_places(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 reviewed_at timestamptz,
 reviewed_by uuid references auth.users(id) on delete set null
);
create unique index if not exists sas_room_active_stall_slot
 on public.school_shop_stalls(room_id,slot_no) where status in ('pending','approved');
create index if not exists sas_shop_stalls_mine_idx
 on public.school_shop_stalls(requested_by,created_at desc);
alter table public.school_shop_stalls enable row level security;
revoke all on public.school_shop_stalls from public,anon,authenticated;

create or replace function public.shop_room_catalog()
returns jsonb language sql stable security definer set search_path to ''
as $fn$
 select coalesce(jsonb_agg(jsonb_build_object(
  'id',r.id,'name',r.name,'floor',r.floor_label,'detail',r.detail,
  'plan_page',r.plan_page,'x_percent',r.x_percent,'y_percent',r.y_percent,
  'slots',coalesce((
   select jsonb_agg(jsonb_build_object(
    'number',s.slot_no,'status',s.status,
    'id',case when s.requested_by=(select auth.uid()) or public.sas_is_admin() then s.id else null end,
    'mine',s.requested_by=(select auth.uid()),
    'shop',case when s.status='approved' or s.requested_by=(select auth.uid()) or public.sas_is_admin()
           then s.shop_name else 'Reserviert' end,
    'description',case when s.status='approved' or s.requested_by=(select auth.uid()) or public.sas_is_admin()
           then s.description else '' end
   ) order by s.slot_no)
   from public.school_shop_stalls s
   where s.room_id=r.id and s.status in ('pending','approved')
  ),'[]'::jsonb)
 ) order by r.name),'[]'::jsonb)
 from (select * from public.school_places
  where kind='room' and active and classroom_shop_enabled order by name limit 300) r;
$fn$;

create or replace function public.request_shop_stall(
 p_room_id uuid,p_slot_no integer,p_shop_name text,p_description text default '')
returns uuid language plpgsql security definer set search_path to ''
as $fn$
declare v_uid uuid:=(select auth.uid());v_id uuid;
begin
 if v_uid is null then raise exception 'Bitte zuerst anmelden.';end if;
 if p_room_id is null or p_slot_no is null or p_slot_no not between 1 and 4 then
  raise exception 'Ungültiger Raum oder Shop-Platz.';end if;
 if char_length(btrim(coalesce(p_shop_name,''))) not between 3 and 100
   or char_length(coalesce(p_description,''))>450 then
  raise exception 'Shop-Name (3–100 Zeichen) oder Beschreibung (maximal 450 Zeichen) ungültig.';end if;
 perform 1 from public.school_places p
  where p.id=p_room_id and p.kind='room' and p.active and p.classroom_shop_enabled for update;
 if not found then raise exception 'Dieses Klassenzimmer ist nicht für Shops freigegeben.';end if;
 if exists(select 1 from public.school_shop_stalls s where s.room_id=p_room_id
  and s.slot_no=p_slot_no and s.status in ('pending','approved')) then
  raise exception 'Dieser Shop-Platz ist bereits reserviert.';end if;
 insert into public.school_shop_stalls(room_id,slot_no,requested_by,shop_name,description)
 values(p_room_id,p_slot_no,v_uid,btrim(p_shop_name),btrim(coalesce(p_description,'')))
 returning id into v_id;
 return v_id;
exception when unique_violation then
 raise exception 'Dieser Shop-Platz wurde inzwischen reserviert. Bitte aktualisieren.';
end;
$fn$;

create or replace function public.cancel_shop_stall(p_request_id uuid)
returns boolean language plpgsql security definer set search_path to ''
as $fn$
declare v_uid uuid:=(select auth.uid());v_shop uuid;v_status text;
begin
 if v_uid is null then raise exception 'Bitte zuerst anmelden.';end if;
 select s.shop_place_id,s.status into v_shop,v_status
 from public.school_shop_stalls s where s.id=p_request_id
 and (s.requested_by=v_uid or public.sas_is_admin())
 and (s.status='pending' or (s.status='approved' and public.sas_is_admin()))
 for update;
 if not found then raise exception 'Die Reservierung kann nicht zurückgenommen werden.';end if;
 update public.school_shop_stalls set status='cancelled',updated_at=now(),
  reviewed_at=case when public.sas_is_admin() then now() else reviewed_at end,
  reviewed_by=case when public.sas_is_admin() then v_uid else reviewed_by end
 where id=p_request_id;
 if v_status='approved' and v_shop is not null then
  update public.school_places set active=false where id=v_shop and kind='shop';end if;
 return true;
end;
$fn$;

create or replace function public.review_shop_stall(p_request_id uuid,p_approve boolean)
returns jsonb language plpgsql security definer set search_path to ''
as $fn$
declare v_uid uuid:=(select auth.uid());
 v_stall public.school_shop_stalls%rowtype;
 v_room public.school_places%rowtype;v_shop uuid;
begin
 if v_uid is null or not public.sas_is_admin() then
  raise exception 'Nur die Schuladministration darf Shopbuchungen freigeben.';end if;
 if p_approve is null then raise exception 'Entscheidung fehlt.';end if;
 select * into v_stall from public.school_shop_stalls
 where id=p_request_id and status='pending' for update;
 if not found then raise exception 'Die Anfrage ist nicht mehr offen.';end if;
 select * into v_room from public.school_places
 where id=v_stall.room_id and kind='room' and classroom_shop_enabled and active;
 if not found then raise exception 'Dieses Klassenzimmer ist nicht mehr freigegeben.';end if;
 if p_approve then
  insert into public.school_places(name,kind,floor_label,detail,owner_id,active)
  values(left(v_stall.shop_name,100),'shop',
   left(v_room.name||' · '||v_room.floor_label,40),
   left('Shop-Platz '||v_stall.slot_no||' in Raum '||v_room.name||'. '||v_stall.description,500),
   v_stall.requested_by,true) returning id into v_shop;
 end if;
 update public.school_shop_stalls set
  status=case when p_approve then 'approved' else 'rejected' end,
  shop_place_id=v_shop,updated_at=now(),reviewed_at=now(),reviewed_by=v_uid
 where id=v_stall.id;
 return jsonb_build_object('ok',true,'approved',p_approve,'shop_id',v_shop);
end;
$fn$;

revoke all on function public.shop_room_catalog() from public,anon,authenticated;
revoke all on function public.request_shop_stall(uuid,integer,text,text) from public,anon,authenticated;
revoke all on function public.cancel_shop_stall(uuid) from public,anon,authenticated;
revoke all on function public.review_shop_stall(uuid,boolean) from public,anon,authenticated;
grant execute on function public.shop_room_catalog() to authenticated;
grant execute on function public.request_shop_stall(uuid,integer,text,text) to authenticated;
grant execute on function public.cancel_shop_stall(uuid) to authenticated;
grant execute on function public.review_shop_stall(uuid,boolean) to authenticated;
