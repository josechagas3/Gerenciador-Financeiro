begin;

-- Corrige somente a reserva de idempotência da RPC de fatura existente.
-- A tabela exige user_id e a chave primária continua sendo key.
create or replace function finance.register_existing_card_invoice(
  p_card_id uuid,
  p_period_start date,
  p_period_end date,
  p_due_on date,
  p_total_cents bigint,
  p_historical_paid_cents bigint,
  p_operation_key text,
  p_request_hash text
)
returns table (invoice_id uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card finance.credit_cards%rowtype;
  v_invoice finance.card_invoices%rowtype;
  v_existing finance.idempotency_keys%rowtype;
  v_reserved text;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then raise exception 'invalid invoice period'; end if;
  if p_due_on is null or p_total_cents is null or p_total_cents < 0 then raise exception 'invalid invoice total or due date'; end if;
  if p_historical_paid_cents is null or p_historical_paid_cents < 0 or p_historical_paid_cents > p_total_cents then raise exception 'invalid paid amount'; end if;
  if p_operation_key is null or length(trim(p_operation_key)) not between 16 and 200 then raise exception 'invalid operation key'; end if;
  if p_request_hash is null or length(trim(p_request_hash)) = 0 then raise exception 'request hash is required'; end if;

  insert into finance.idempotency_keys (key, operation, request_hash, user_id)
    values (p_operation_key, 'register_existing_card_invoice', p_request_hash, v_user_id)
    on conflict (key) do nothing
    returning key into v_reserved;

  if v_reserved is null then
    select * into v_existing
      from finance.idempotency_keys
     where key = p_operation_key
       and user_id = v_user_id
     for update;
    if not found then raise exception 'idempotency key is not available to this user' using errcode = '42501'; end if;
    if v_existing.operation is distinct from 'register_existing_card_invoice'
       or v_existing.request_hash is distinct from p_request_hash then
      raise exception 'idempotency key was already used with a different request';
    end if;
    if v_existing.response_body is not null and v_existing.response_body ? 'invoice_id' then
      return query select (v_existing.response_body->>'invoice_id')::uuid;
      return;
    end if;
  end if;

  select cc.* into v_card
    from finance.credit_cards cc
   where cc.id = p_card_id
     and cc.user_id = v_user_id
   for update;
  if not found then raise exception 'card not found'; end if;

  select ci.* into v_invoice
    from finance.card_invoices ci
   where ci.account_id = v_card.account_id
     and ci.user_id = v_user_id
     and ci.period_start = p_period_start
     and ci.period_end = p_period_end
   for update;
  if found then raise exception 'invoice already exists for this card and period'; end if;

  insert into finance.card_invoices (account_id, user_id, period_start, period_end, due_on, total_cents, status, historical_import_pending, historical_paid_cents)
    values (v_card.account_id, v_user_id, p_period_start, p_period_end, p_due_on, p_total_cents, 'closed', true, p_historical_paid_cents)
    returning * into v_invoice;

  update finance.idempotency_keys
     set response_status = 201,
         response_body = jsonb_build_object('invoice_id', v_invoice.id),
         completed_at = now()
   where key = p_operation_key
     and user_id = v_user_id;
  if not found then raise exception 'idempotency finalization failed'; end if;

  return query select v_invoice.id;
end;
$$;

revoke execute on function finance.register_existing_card_invoice(uuid, date, date, date, bigint, bigint, text, text) from public, anon;
grant execute on function finance.register_existing_card_invoice(uuid, date, date, date, bigint, bigint, text, text) to authenticated;

commit;
