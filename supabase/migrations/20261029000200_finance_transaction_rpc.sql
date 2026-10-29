-- Fase 2 — proposta documental; NÃO EXECUTAR nesta etapa.
-- Dependências: finance.idempotency_keys, finance.transactions e ownership/RLS.
-- A RPC é SECURITY INVOKER: auth.uid(), RLS e auditoria continuam valendo.

create or replace function finance.create_transaction(
  p_account_id uuid,
  p_category_id uuid,
  p_transaction_type text,
  p_amount_cents bigint,
  p_occurred_at timestamptz,
  p_description text,
  p_operation_key text,
  p_request_hash text,
  p_original_transaction_id uuid default null
)
returns finance.transactions
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_user_id uuid := auth.uid();
  v_existing finance.idempotency_keys;
  v_created finance.transactions;
  v_reserved text;
begin
  if v_user_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_amount_cents is null or p_amount_cents <= 0 then
    raise exception 'amount must be positive';
  end if;
  if p_transaction_type not in ('opening', 'income', 'expense') then
    raise exception 'unsupported transaction type';
  end if;
  if p_original_transaction_id is not null then
    raise exception 'reversal and adjustment must use their dedicated server flow';
  end if;
  if p_operation_key is null or length(p_operation_key) not between 16 and 200 then
    raise exception 'invalid operation key';
  end if;
  if p_request_hash is null or length(btrim(p_request_hash)) = 0 then
    raise exception 'request hash is required';
  end if;

  insert into finance.idempotency_keys (key, operation, request_hash, user_id)
  values (p_operation_key, 'create_transaction', p_request_hash, v_user_id)
  on conflict (key) do nothing
  returning key into v_reserved;

  if v_reserved is null then
    select * into v_existing
    from finance.idempotency_keys
    where key = p_operation_key
    for update;

    if v_existing.user_id is distinct from v_user_id
       or v_existing.operation <> 'create_transaction'
       or v_existing.request_hash <> p_request_hash then
      raise exception 'idempotency key was already used with a different request';
    end if;

    select * into v_created
    from finance.transactions
    where operation_key = p_operation_key
      and user_id = v_user_id;
    if not found then
      raise exception 'idempotency reservation has no transaction';
    end if;
    return v_created;
  end if;

  insert into finance.transactions (
    account_id, category_id, transaction_type, status, amount_cents,
    entry_sign, occurred_at, description, original_transaction_id,
    operation_key, user_id
  ) values (
    p_account_id, p_category_id, p_transaction_type, 'posted', p_amount_cents,
    case when p_transaction_type = 'expense' then -1 else 1 end,
    p_occurred_at, p_description, p_original_transaction_id,
    p_operation_key, v_user_id
  ) returning * into v_created;

  return v_created;
end;
$$;

grant execute on function finance.create_transaction(uuid, uuid, text, bigint, timestamptz, text, text, text, uuid) to authenticated;
revoke execute on function finance.create_transaction(uuid, uuid, text, bigint, timestamptz, text, text, text, uuid) from public, anon;
