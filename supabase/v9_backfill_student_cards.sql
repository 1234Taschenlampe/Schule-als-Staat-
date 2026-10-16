-- Backfill missing draft student ID cards for existing accounts.
-- Additive and idempotent: never overwrite a user's card, profile, permissions, or wallet.
-- All cards remain non-official until school identity verification.
insert into public.student_cards (user_id, display_name, class_label, design)
select
  p.id,
  case when char_length(btrim(p.display_name)) between 2 and 80
       then btrim(p.display_name)
       else 'Mitglied'
  end,
  left(btrim(coalesce(u.raw_user_meta_data->>'class_label','')),24),
  'classic'
from public.profiles p
join auth.users u on u.id=p.id
where not exists (
  select 1 from public.student_cards c where c.user_id=p.id
)
on conflict (user_id) do nothing;
