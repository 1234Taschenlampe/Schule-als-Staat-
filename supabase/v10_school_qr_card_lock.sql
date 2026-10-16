-- Protect approved school identity after in-person review.
-- Members may continue changing the visual card design, but NOT identity fields
-- (name/class). A new identity change must be reviewed by school administration.
create or replace function public.guard_verified_school_card_identity()
returns trigger
language plpgsql security definer set search_path=''
as $$
begin
 if exists (
   select 1 from public.profiles p
   where p.id=new.user_id and p.school_verified_at is not null
 ) and (
   new.display_name is distinct from old.display_name
   or new.class_label is distinct from old.class_label
 ) then
   raise exception 'Nach der Schulverifizierung können Name und Klasse nur durch die Schulverwaltung geändert werden.';
 end if;
 return new;
end;
$$;
drop trigger if exists guard_verified_school_card_identity on public.student_cards;
create trigger guard_verified_school_card_identity
 before update on public.student_cards for each row
 execute function public.guard_verified_school_card_identity();
