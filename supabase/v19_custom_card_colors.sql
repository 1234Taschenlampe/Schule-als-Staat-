-- Allow arbitrary hexadecimal card backgrounds, but do not introduce privileged metallic designs.
alter table public.student_cards drop constraint if exists student_cards_design_check;
alter table public.student_cards add constraint student_cards_design_check
check(design in ('classic','blue','forest','mono') or design ~ '^custom:#[0-9a-fA-F]{6}$');
