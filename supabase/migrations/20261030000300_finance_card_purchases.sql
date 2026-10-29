-- Preparação local. NÃO aplicar remotamente nesta etapa.
-- Registra uma compra de cartão + lançamento + item dentro da mesma transação.
-- O pagamento da fatura continua sendo um lançamento separado.
begin;

alter table finance.card_invoice_items
  add column if not exists description text,
  add column if not exists category_id uuid,
  add column if not exists occurred_on date,
  add column if not exists installment_number smallint not null default 1,
  add column if not exists installment_count smallint not null default 1;

alter table finance.card_invoice_items
  add constraint card_invoice_items_description_check check (description is null or length(trim(description)) between 1 and 240),
  add constraint card_invoice_items_installments_check check (installment_number between 1 and installment_count and installment_count between 1 and 120);

create index if not exists card_invoice_items_category_idx on finance.card_invoice_items (category_id);

create or replace function finance.register_card_purchase(
  p_invoice_id uuid,
  p_category_id uuid,
  p_description text,
  p_amount_cents bigint,
  p_occurred_on date,
  p_installment_count smallint,
  p_operation_key text,
  p_request_hash text
)
returns table (transaction_id uuid, invoice_item_id uuid, invoice_id uuid, total_cents bigint)
language plpgsql
security invoker
set search_path = finance, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_invoice finance.card_invoices%rowtype;
  v_transaction finance.transactions%rowtype;
  v_item finance.card_invoice_items%rowtype;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'purchase amount must be positive'; end if;
  if length(trim(coalesce(p_description, ''))) not between 1 and 240 then raise exception 'purchase description is required'; end if;
  if p_installment_count is null or p_installment_count <> 1 then raise exception 'installments require invoice allocation and are not enabled in this migration'; end if;
  if p_operation_key is null or length(trim(p_operation_key)) not between 16 and 200 then raise exception 'invalid operation key'; end if;

  select ci.* into v_invoice
    from finance.card_invoices ci
    join finance.accounts a on a.id = ci.account_id and a.user_id = v_user_id
    where ci.id = p_invoice_id
    for update of ci;
  if not found then raise exception 'invoice not found'; end if;
  if v_invoice.status <> 'open' then raise exception 'invoice is not accepting purchases'; end if;

  -- Idempotent replay returns the original item without creating a second expense.
  select t.* into v_transaction from finance.transactions t
    where t.operation_key = p_operation_key and t.user_id = v_user_id;
  if found then
    if not exists (select 1 from finance.idempotency_keys k where k.key = p_operation_key and k.user_id = v_user_id and k.operation = 'create_transaction' and k.request_hash = p_request_hash) then
      raise exception 'operation key was already used with a different request';
    end if;
    select i.* into v_item from finance.card_invoice_items i
      join finance.card_invoices ci on ci.id = i.invoice_id
      join finance.accounts a on a.id = ci.account_id and a.user_id = v_user_id
      where i.transaction_id = v_transaction.id;
    if not found then raise exception 'operation key already belongs to another operation'; end if;
    return query select v_transaction.id, v_item.id, v_item.invoice_id, v_item.total_cents;
    return;
  end if;

  select * into v_transaction from finance.create_transaction(
    v_invoice.account_id,
    p_category_id,
    'expense',
    p_amount_cents,
    (p_occurred_on::timestamptz),
    trim(p_description),
    p_operation_key,
    p_request_hash,
    null
  );

  insert into finance.card_invoice_items (
    invoice_id, transaction_id, principal_cents, interest_cents, fee_cents,
    user_id, description, category_id, occurred_on, installment_number, installment_count
  ) values (
    v_invoice.id, v_transaction.id, p_amount_cents, 0, 0,
    v_user_id, trim(p_description), p_category_id, p_occurred_on, 1, p_installment_count
  ) returning * into v_item;

  update finance.card_invoices
    set total_cents = total_cents + v_item.total_cents, updated_at = now()
    where id = v_invoice.id and user_id = v_user_id;

  return query select v_transaction.id, v_item.id, v_invoice.id, v_item.total_cents;
end;
$$;

revoke execute on function finance.register_card_purchase(uuid, uuid, text, bigint, date, smallint, text, text) from public, anon;
grant execute on function finance.register_card_purchase(uuid, uuid, text, bigint, date, smallint, text, text) to authenticated;

commit;
