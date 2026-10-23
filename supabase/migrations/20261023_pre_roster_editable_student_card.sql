-- During the temporary pre-roster test period, even users previously marked
-- by old school-verification QR may edit their own ID card name and class.
-- The lock is restored automatically once roster_enforced=true.
create or replace function public.guard_verified_school_card_identity()
returns trigger
language plpgsql security definer
set search_path to ''
as $function$
begin
 if coalesce((select s.roster_enforced from public.school_access_settings s where s.singleton),true)
   and exists(select 1 from public.profiles p where p.id=new.user_id and p.school_verified_at is not null)
   and (
     new.display_name is distinct from old.display_name
     or new.class_label is distinct from old.class_label
   ) then
   raise exception 'Nach der Schulzuordnung können Name und Klasse nur durch die Schulverwaltung geändert werden.';
 end if;
 return new;
end;
$function$;
