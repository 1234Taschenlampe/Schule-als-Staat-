begin;
select set_config('request.jwt.claim.sub',(select id::text from auth.users where email='seller@example.invalid'),true);
select id as request_id from public.payment_requests where note='fixture' \gset
set local role authenticated;
select public.settle_payment_request(:'request_id');
commit;
