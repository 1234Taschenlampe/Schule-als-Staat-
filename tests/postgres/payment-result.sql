do $$ begin
 if (select count(*) from public.wallet_ledger where kind='payment')<>1
 or (select balance_cents from public.wallets where user_id=(select id from auth.users where email='seller@example.invalid'))<>0
 or (select balance_cents from public.wallets where user_id=(select id from auth.users where email='fixture-3@example.invalid'))<>100
 then raise exception 'Payment retry changed balances or ledger more than once'; end if;
end $$;
