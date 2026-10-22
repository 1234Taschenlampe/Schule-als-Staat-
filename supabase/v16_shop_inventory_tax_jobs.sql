
-- Shop inventory, immutable itemized sales, optional school tax, and unprivileged self-selected jobs.
create table if not exists public.shop_products (
 id uuid primary key default gen_random_uuid(),
 shop_id uuid not null references public.school_places(id) on delete restrict,
 name text not null check (char_length(btrim(name)) between 2 and 100),
 sku text check (sku is null or char_length(sku)<=50),
 unit_price_cents integer not null check(unit_price_cents between 0 and 1000000),
 stock_quantity integer not null default 0 check(stock_quantity>=0),
 is_active boolean not null default true,
 created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique (id,shop_id)
);
create index if not exists shop_products_shop_idx on public.shop_products(shop_id);
create table if not exists public.shop_stock_movements (
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.shop_products(id),
 delta integer not null check(delta<>0),
 reason text not null check(reason in ('initial','restock','inventory','sale','refund')),
 note text not null default '' check(char_length(note)<=200),
 created_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists shop_stock_product_idx on public.shop_stock_movements(product_id,created_at);
create table if not exists public.shop_sales (
 id uuid primary key default gen_random_uuid(),
 shop_id uuid not null references public.school_places(id),
 cashier_id uuid not null references auth.users(id),
 payment_method text not null check(payment_method in ('cash','qr')),
 status text not null default 'pending' check(status in ('pending','paid','cancelled')),
 amount_cents integer not null check(amount_cents between 1 and 1000000),
 tax_rate_basis_points integer,
 tax_cents integer not null default 0 check(tax_cents>=0),
 cash_sale_id uuid unique references public.cash_sales(id),
 payment_request_id uuid unique references public.payment_requests(id),
 created_at timestamptz not null default now(),
 paid_at timestamptz,
 constraint shop_sales_payment_source check(
 (payment_method='cash' and cash_sale_id is not null and payment_request_id is null and status='paid')
 or(payment_method='qr' and payment_request_id is not null and cash_sale_id is null)
 )
);
create index if not exists shop_sales_shop_idx on public.shop_sales(shop_id,created_at desc);
create table if not exists public.shop_sale_items (
 sale_id uuid not null references public.shop_sales(id) on delete restrict,
 product_id uuid not null references public.shop_products(id),
 quantity integer not null check(quantity between 1 and 10000),
 unit_price_cents integer not null check(unit_price_cents between 0 and 1000000),
 primary key(sale_id,product_id)
);
create table if not exists public.shop_tax_configuration (
 singleton boolean primary key default true check(singleton),
 enabled boolean not null default false,
 rate_basis_points integer not null default 0 check(rate_basis_points between 0 and 10000),
 changed_by uuid references auth.users(id),
 changed_at timestamptz not null default now()
);
insert into public.shop_tax_configuration(singleton,enabled,rate_basis_points)
 values(true,false,0) on conflict(singleton) do nothing;
create table if not exists public.school_self_jobs (
 user_id uuid primary key references auth.users(id) on delete cascade,
 title text not null check(char_length(btrim(title)) between 3 and 65),
 updated_at timestamptz not null default now()
);
alter table public.shop_products enable row level security;
alter table public.shop_stock_movements enable row level security;
alter table public.shop_sales enable row level security;
alter table public.shop_sale_items enable row level security;
alter table public.shop_tax_configuration enable row level security;
alter table public.school_self_jobs enable row level security;
revoke all on public.shop_products,public.shop_stock_movements,public.shop_sales,public.shop_sale_items,public.shop_tax_configuration,public.school_self_jobs from public,anon,authenticated;

-- Privileged permissions come from actual authenticated identity, never chosen job text.
create or replace function public.shop_can_manage(p_shop_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
 select (select auth.uid()) is not null and exists(
 select 1 from public.school_places s
 where s.id=p_shop_id and s.kind='shop' and s.active
 and (
 s.owner_id=(select auth.uid())
 or exists(select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin')
 or public.sas_is_operator()
 )
 );
$$;
revoke all on function public.shop_can_manage(uuid) from public,anon,authenticated;
grant execute on function public.shop_can_manage(uuid) to authenticated;

create or replace function public.shop_catalog(p_shop_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $$
 select case when public.shop_can_manage(p_shop_id)
 then jsonb_build_object(
 'shop', (select jsonb_build_object('id',id,'name',name,'floor_label',floor_label,'owner_id',owner_id) from public.school_places where id=p_shop_id),
 'products',coalesce((select jsonb_agg(jsonb_build_object('id',id,'name',name,'price_cents',unit_price_cents,'stock',stock_quantity,'active',is_active) order by name) from public.shop_products where shop_id=p_shop_id),'[]'::jsonb),
 'sales',coalesce((select jsonb_agg(jsonb_build_object('id',id,'method',payment_method,'status',status,'amount_cents',amount_cents,'tax_cents',tax_cents,'created_at',created_at,'paid_at',paid_at) order by created_at desc) from (select * from public.shop_sales where shop_id=p_shop_id order by created_at desc limit 100) x),'[]'::jsonb),
 'tax',(select jsonb_build_object('enabled',enabled,'rate_basis_points',rate_basis_points) from public.shop_tax_configuration where singleton=true)
 )
 else null end;
$$;
revoke all on function public.shop_catalog(uuid) from public,anon,authenticated;
grant execute on function public.shop_catalog(uuid) to authenticated;

create or replace function public.shop_save_product(p_shop_id uuid,p_name text,p_price_cents integer,p_stock integer,p_product_id uuid default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare v_id uuid;v_old integer;
begin
 if not public.shop_can_manage(p_shop_id) then raise exception 'Keine Shopberechtigung.'; end if;
 if length(btrim(coalesce(p_name,''))) not between 2 and 100 or p_price_cents not between 0 and 1000000 or p_stock not between 0 and 1000000 then raise exception 'Ungültige Artikeldaten.'; end if;
 if p_product_id is null then
  insert into public.shop_products(shop_id,name,unit_price_cents,stock_quantity,created_by) values(p_shop_id,btrim(p_name),p_price_cents,p_stock,auth.uid()) returning id into v_id;
  if p_stock>0 then insert into public.shop_stock_movements(product_id,delta,reason,created_by) values(v_id,p_stock,'initial',auth.uid());end if;
 else
  select stock_quantity into v_old from public.shop_products where id=p_product_id and shop_id=p_shop_id for update;
  if not found then raise exception 'Artikel nicht gefunden.'; end if;
  update public.shop_products set name=btrim(p_name),unit_price_cents=p_price_cents,stock_quantity=p_stock where id=p_product_id returning id into v_id;
  if p_stock<>v_old then insert into public.shop_stock_movements(product_id,delta,reason,created_by) values(v_id,p_stock-v_old,'inventory',auth.uid());end if;
 end if;
 return v_id;
end;
$$;
revoke all on function public.shop_save_product(uuid,text,integer,integer,uuid) from public,anon,authenticated;
grant execute on function public.shop_save_product(uuid,text,integer,integer,uuid) to authenticated;

-- Itemized checkout: atomic cash receipt, or payment request awaiting student confirmation.
create or replace function public.shop_checkout(p_shop_id uuid,p_items jsonb,p_method text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare v_item jsonb;v_pid uuid;v_qty int;v_price int;v_stock int;v_total bigint:=0;v_tax_rate int:=0;v_tax int:=0;v_id uuid;v_cash uuid;v_req uuid;v_uid uuid:=auth.uid();v_label text;
begin
 if not public.shop_can_manage(p_shop_id) then raise exception 'Keine Shopberechtigung.'; end if;
 if p_method not in ('cash','qr') then raise exception 'Ungültige Zahlungsart.'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 60 then raise exception 'Warenkorb ist ungültig.'; end if;
 -- deterministic locking for concurrent sales, even when different carts overlap
 perform pg_advisory_xact_lock(hashtextextended(p_shop_id::text,84736));
 for v_item in select value from jsonb_array_elements(p_items) loop
  if jsonb_typeof(v_item)<>'object' or coalesce(v_item->>'product_id','') !~ '^[0-9a-fA-F-]{36}$' or coalesce(v_item->>'quantity','') !~ '^[0-9]{1,5}$' then raise exception 'Ungültiger Artikel.';end if;
  v_pid:=(v_item->>'product_id')::uuid;v_qty:=(v_item->>'quantity')::integer;
  if v_qty<1 or v_qty>10000 then raise exception 'Ungültige Menge.';end if;
  if exists(select 1 from jsonb_array_elements(p_items) z where z->>'product_id'=v_pid::text having count(*)>1) then raise exception 'Doppelter Artikel im Warenkorb.';end if;
  select unit_price_cents,stock_quantity,name into v_price,v_stock,v_label from public.shop_products where id=v_pid and shop_id=p_shop_id and is_active for update;
  if not found or v_stock<v_qty then raise exception 'Artikel nicht vorhanden oder Lagerbestand zu klein.';end if;
  v_total:=v_total+v_qty::bigint*v_price::bigint;
 end loop;
 if v_total<1 or v_total>1000000 then raise exception 'Kassenbetrag außerhalb des zulässigen Bereichs.';end if;
 select case when enabled then rate_basis_points else 0 end into v_tax_rate from public.shop_tax_configuration where singleton=true;
 -- Prices are gross amounts: tax is informational and included, never charged twice.
 v_tax:=round(v_total::numeric*v_tax_rate/(10000+v_tax_rate))::integer;
 if p_method='cash' then
  insert into public.cash_sales(cashier_id,amount_cents,note) values(v_uid,v_total,'Artikelverkauf') returning id into v_cash;
 else
  insert into public.payment_requests(cashier_id,amount_cents,note) values(v_uid,v_total,'Artikelverkauf') returning id into v_req;
 end if;
 insert into public.shop_sales(shop_id,cashier_id,payment_method,status,amount_cents,tax_rate_basis_points,tax_cents,cash_sale_id,payment_request_id,paid_at)
 values(p_shop_id,v_uid,p_method,case when p_method='cash' then 'paid' else 'pending' end,v_total,v_tax_rate,v_tax,v_cash,v_req,case when p_method='cash' then now() else null end) returning id into v_id;
 for v_item in select value from jsonb_array_elements(p_items) loop
  v_pid:=(v_item->>'product_id')::uuid;v_qty:=(v_item->>'quantity')::integer;
  select unit_price_cents into v_price from public.shop_products where id=v_pid;
  insert into public.shop_sale_items(sale_id,product_id,quantity,unit_price_cents) values(v_id,v_pid,v_qty,v_price);
  if p_method='cash' then
   update public.shop_products set stock_quantity=stock_quantity-v_qty where id=v_pid;
   insert into public.shop_stock_movements(product_id,delta,reason,created_by) values(v_pid,-v_qty,'sale',v_uid);
  end if;
 end loop;
 return jsonb_build_object('sale_id',v_id,'amount_cents',v_total,'tax_cents',v_tax,'payment_request_id',v_req,'status',case when p_method='cash' then 'paid' else 'pending' end);
end;
$$;
revoke all on function public.shop_checkout(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.shop_checkout(uuid,jsonb,text) to authenticated;

-- Successful wallet payment is the ONLY event that marks QR sale paid and deducts inventory.
create or replace function public.shop_finalize_paid_request()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_sale public.shop_sales%rowtype;v_item record;
begin
 if new.status<>'paid' or old.status='paid' then return new;end if;
 select * into v_sale from public.shop_sales where payment_request_id=new.id for update;
 if not found then return new;end if;
 perform pg_advisory_xact_lock(hashtextextended(v_sale.shop_id::text,84736));
 for v_item in select product_id,quantity from public.shop_sale_items where sale_id=v_sale.id order by product_id loop
  update public.shop_products set stock_quantity=stock_quantity-v_item.quantity
   where id=v_item.product_id and stock_quantity>=v_item.quantity;
  if not found then raise exception 'Bestand für diesen Kauf nicht mehr verfügbar.';end if;
  insert into public.shop_stock_movements(product_id,delta,reason,created_by) values(v_item.product_id,-v_item.quantity,'sale',v_sale.cashier_id);
 end loop;
 update public.shop_sales set status='paid',paid_at=new.paid_at where id=v_sale.id;
 return new;
end;
$$;
revoke all on function public.shop_finalize_paid_request() from public,anon,authenticated;
drop trigger if exists shop_payment_confirmed on public.payment_requests;
create trigger shop_payment_confirmed after update of status on public.payment_requests
 for each row when (new.status='paid' and old.status is distinct from new.status)
 execute function public.shop_finalize_paid_request();

-- Self-service display titles are never assigned in school_role_assignments.
create or replace function public.set_my_school_job_title(p_title text)
returns text language plpgsql security definer set search_path=''
as $$
declare v_title text:=btrim(coalesce(p_title,''));v_clean text;
begin
 if auth.uid() is null then raise exception 'Anmeldung erforderlich.';end if;
 if char_length(v_title) not between 3 and 65 then raise exception 'Rollenname muss 3 bis 65 Zeichen enthalten.';end if;
 if v_title !~ '^[[:alnum:]ÄÖÜäöüß][[:alnum:]ÄÖÜäöüß .&,/()_+-]{2,64}$' then raise exception 'Ungültige Zeichen im Rollennamen.';end if;
 v_clean:=lower(regexp_replace(v_title,'[^[:alnum:]ÄÖÜäöüß]','','g'));
 if v_clean ~ '(admin|administrator|operator|parlament|präsident|praesident|polizei|police|moderator|superuser|root|system|lehrer|lehrkraft|schulleitung|direktor|staff|support|official|offiziell|nazi|hitler|nsdap|heilhitler|fick|hurensohn|arschloch|scheisse|scheiße)' then raise exception 'Reservierter oder gesperrter Rollenname.';end if;
 if exists(select 1 from public.school_job_roles j where lower(regexp_replace(j.label,'[^[:alnum:]ÄÖÜäöüß]','','g'))=v_clean and j.tier>=30) then raise exception 'Rollenname ist reserviert.';end if;
 insert into public.school_self_jobs(user_id,title) values(auth.uid(),v_title)
 on conflict(user_id) do update set title=excluded.title,updated_at=now();
 return v_title;
end;
$$;
revoke all on function public.set_my_school_job_title(text) from public,anon,authenticated;
grant execute on function public.set_my_school_job_title(text) to authenticated;

create or replace function public.my_school_job_title()
returns text language sql stable security definer set search_path=''
as $$
 select title from public.school_self_jobs where user_id=(select auth.uid());
$$;
revoke all on function public.my_school_job_title() from public,anon,authenticated;
grant execute on function public.my_school_job_title() to authenticated;

-- DB guard: no second admin and no admin on any account other than designated Auth identity.
create or replace function public.guard_single_designated_school_admin()
returns trigger language plpgsql security definer set search_path=''
as $$
declare v_email text;
begin
 if new.role='admin' then
  select lower(email) into v_email from auth.users where id=new.id;
  if v_email is distinct from 'jan.felix.eckert@gmx.de' then raise exception 'Administrator ist ausschließlich für das festgelegte Schulkonto erlaubt.';end if;
  if exists(select 1 from public.profiles p where p.role='admin' and p.id<>new.id) then raise exception 'Nur ein Administrator erlaubt.';end if;
 end if;
 return new;
end;
$$;
revoke all on function public.guard_single_designated_school_admin() from public,anon,authenticated;
drop trigger if exists guard_school_admin_update on public.profiles;
create trigger guard_school_admin_update before insert or update of role on public.profiles
 for each row execute function public.guard_single_designated_school_admin();
