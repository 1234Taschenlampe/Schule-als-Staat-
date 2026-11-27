-- Run manually after deploying and verifying the new browser assets.
begin;
revoke execute on function public.shop_checkout(uuid, jsonb, text),
  public.record_cash_sale(integer, text) from public, anon, authenticated;
commit;
