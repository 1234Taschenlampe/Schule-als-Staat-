-- V6.1: do not cascade-delete booking audit history with room deletion; let applicants withdraw their own personal ViSA records.
alter table public.room_bookings drop constraint if exists room_bookings_place_id_fkey;
alter table public.room_bookings add constraint room_bookings_place_id_fkey
  foreign key(place_id) references public.school_places(id) on delete restrict;
create policy sas_visa_withdraw on public.visa_applications for delete to authenticated
  using((applicant_id=(select auth.uid()) and status in ('submitted','rejected')) or (select public.sas_is_admin()));
grant delete on public.visa_applications to authenticated;
