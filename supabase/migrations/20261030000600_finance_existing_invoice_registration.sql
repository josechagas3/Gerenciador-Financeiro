begin;

alter table finance.card_invoices
  add column if not exists historical_import_pending boolean not null default false,
  add column if not exists historical_paid_cents bigint not null default 0;

alter table finance.card_invoices
  add constraint card_invoices_historical_paid_check check (historical_paid_cents >= 0 and historical_paid_cents <= total_cents);

create or replace function finance.validate_invoice_totals()
returns trigger language plpgsql as $$
declare
  invoice_id_value uuid;
  item_total bigint;
  paid_total bigint;
  declared_total bigint;
  pending_import boolean;
begin
  invoice_id_value := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  select total_cents, historical_import_pending into declared_total, pending_import from finance.card_invoices where id = invoice_id_value for update;
  select coalesce(sum(total_cents), 0) into item_total from finance.card_invoice_items where invoice_id = invoice_id_value;
  select coalesce(sum(paid_cents), 0) into paid_total from finance.card_payments where invoice_id = invoice_id_value;
  if not (pending_import and item_total = 0) and declared_total <> item_total then raise exception 'invoice total must equal the sum of its items'; end if;
  if paid_total + (select historical_paid_cents from finance.card_invoices where id = invoice_id_value) > declared_total then raise exception 'invoice payments cannot exceed the amount due'; end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

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
set search_path = finance, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card finance.credit_cards%rowtype;
  v_invoice finance.card_invoices%rowtype;
  v_existing_hash text;
  v_existing_body jsonb;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_period_start is null or p_period_end is null or p_period_end < p_period_start then raise exception 'invalid invoice period'; end if;
  if p_due_on is null or p_total_cents is null or p_total_cents < 0 then raise exception 'invalid invoice total or due date'; end if;
  if p_historical_paid_cents is null or p_historical_paid_cents < 0 or p_historical_paid_cents > p_total_cents then raise exception 'invalid paid amount'; end if;
  if p_operation_key is null or length(trim(p_operation_key)) not between 16 and 200 then raise exception 'invalid operation key'; end if;
  insert into finance.idempotency_keys (key, operation, request_hash)
  values (p_operation_key, 'register_existing_card_invoice', p_request_hash)
  on conflict (key) do nothing;
  select request_hash, response_body into v_existing_hash, v_existing_body from finance.idempotency_keys where key = p_operation_key for update;
  if v_existing_hash <> p_request_hash then raise exception 'operation key was already used with a different request'; end if;
  if v_existing_body is not null and v_existing_body ? 'invoice_id' then return query select (v_existing_body->>'invoice_id')::uuid; return; end if;

  select * into v_card from finance.credit_cards where id = p_card_id and user_id = v_user_id for update;
  if not found then raise exception 'card not found'; end if;
  select * into v_invoice from finance.card_invoices where account_id = v_card.account_id and period_start = p_period_start and period_end = p_period_end for update;
  if found then raise exception 'invoice already exists for this card and period'; end if;
  insert into finance.card_invoices (account_id, user_id, period_start, period_end, due_on, total_cents, status, historical_import_pending, historical_paid_cents)
  values (v_card.account_id, v_user_id, p_period_start, p_period_end, p_due_on, p_total_cents, 'closed', true, p_historical_paid_cents)
  returning * into v_invoice;
  update finance.idempotency_keys set response_status = 201, response_body = jsonb_build_object('invoice_id', v_invoice.id), completed_at = now() where key = p_operation_key;
  return query select v_invoice.id;
end;
$$;

revoke execute on function finance.register_existing_card_invoice(uuid,date,date,date,bigint,bigint,text,text) from public, anon;
grant execute on function finance.register_existing_card_invoice(uuid,date,date,date,bigint,bigint,text,text) to authenticated;

commit;
