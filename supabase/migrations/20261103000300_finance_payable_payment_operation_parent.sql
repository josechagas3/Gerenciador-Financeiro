create or replace function finance.pay_payable(
  p_payable_id uuid, p_account_id uuid, p_paid_cents bigint, p_paid_on date,
  p_operation_key text, p_request_hash text
) returns finance.payables
language plpgsql security invoker set search_path = '' as $$
declare
  v_user_id uuid := auth.uid(); v_payable finance.payables; v_transaction finance.transactions;
  v_existing_key finance.idempotency_keys; v_reserved text;
begin
  if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
  if p_paid_cents is null or p_paid_cents <= 0 or p_paid_on is null then raise exception 'invalid payment'; end if;
  if p_operation_key is null or length(p_operation_key) not between 16 and 200 then raise exception 'invalid operation key'; end if;
  if p_request_hash is null or length(btrim(p_request_hash)) = 0 then raise exception 'request hash is required'; end if;
  select * into v_payable from finance.payables where id=p_payable_id and user_id=v_user_id for update;
  if not found then raise exception 'payable not found' using errcode = 'P0002'; end if;
  if v_payable.status='paid' then
    if v_payable.payment_operation_key=p_operation_key then return v_payable; end if;
    raise exception 'payable already paid';
  end if;
  if v_payable.status <> 'pending' then raise exception 'payable is not payable'; end if;
  if p_paid_cents <> v_payable.amount_cents then raise exception 'partial payments are not supported'; end if;
  if not exists (select 1 from finance.accounts a where a.id=p_account_id and a.user_id=v_user_id and a.is_active) then raise exception 'payment account not found'; end if;
  insert into finance.idempotency_keys(key,operation,request_hash,user_id) values(p_operation_key,'pay_payable',p_request_hash,v_user_id) on conflict(key) do nothing returning key into v_reserved;
  if v_reserved is null then
    select * into v_existing_key from finance.idempotency_keys where key=p_operation_key for update;
    if v_existing_key.user_id is distinct from v_user_id or v_existing_key.operation <> 'pay_payable' or v_existing_key.request_hash <> p_request_hash then raise exception 'idempotency key was already used with a different request'; end if;
    select * into v_transaction from finance.transactions where operation_key=p_operation_key and user_id=v_user_id;
    if found then
      if v_transaction.account_id <> p_account_id or v_transaction.amount_cents <> p_paid_cents then raise exception 'idempotency key was already used with a different payment'; end if;
      update finance.payables set status='paid',paid_account_id=p_account_id,paid_transaction_id=v_transaction.id,paid_cents=p_paid_cents,paid_on=p_paid_on,payment_operation_key=p_operation_key,updated_at=now() where id=p_payable_id and user_id=v_user_id returning * into v_payable;
      return v_payable;
    end if;
    raise exception 'idempotency reservation has no transaction';
  end if;
  insert into finance.transactions(account_id,category_id,transaction_type,status,amount_cents,entry_sign,occurred_at,description,operation_key,user_id) values(p_account_id,v_payable.category_id,'expense','posted',p_paid_cents,-1,p_paid_on::timestamptz,v_payable.description,p_operation_key,v_user_id) returning * into v_transaction;
  update finance.payables set status='paid',paid_account_id=p_account_id,paid_transaction_id=v_transaction.id,paid_cents=p_paid_cents,paid_on=p_paid_on,payment_operation_key=p_operation_key,updated_at=now() where id=p_payable_id and user_id=v_user_id returning * into v_payable;
  return v_payable;
end; $$;
grant execute on function finance.pay_payable(uuid,uuid,bigint,date,text,text) to authenticated;
revoke execute on function finance.pay_payable(uuid,uuid,bigint,date,text,text) from public, anon;
