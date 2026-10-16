-- Testbetrieb: Kontoerstellung ist vollständig durch Supabase Auth automatisiert.
-- Die globale E-Mail-Bestätigung bleibt eine Supabase-Auth-Einstellung
-- und wird NICHT über Datenbank-SQL gesteuert.
-- Niemals Rollen oder Stimmrecht aus vom Benutzer gesetzten Metadaten lesen.
create or replace function public.on_new_user()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_name text := left(btrim(coalesce(nullif(new.raw_user_meta_data->>'full_name',''),split_part(coalesce(new.email,''),'@',1),'Mitglied')),80);
  v_class text := left(btrim(coalesce(new.raw_user_meta_data->>'class_label','')),24);
begin
  if char_length(v_name)<2 then v_name:='Mitglied'; end if;

  insert into public.profiles(id,display_name,role,vote_eligible)
    values(new.id,v_name,'member',false)
    on conflict(id) do nothing;

  insert into public.wallets(user_id,balance_cents)
    values(new.id,0)
    on conflict(user_id) do nothing;

  insert into public.student_cards(user_id,display_name,class_label,design)
    values(new.id,v_name,v_class,'classic')
    on conflict(user_id) do nothing;

  return new;
end;
$$;
-- Existing trigger on auth.users remains attached; no migration of existing accounts.
