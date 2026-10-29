-- Preparação local. NÃO aplicar remotamente nesta etapa.
-- Compra parcelada: uma compra, N lançamentos e N itens distribuídos nas faturas corretas.
begin;

create table if not exists finance.card_purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  card_id uuid not null references finance.credit_cards(id) on delete restrict,
  account_id uuid not null references finance.accounts(id) on delete restrict,
  category_id uuid not null references finance.categories(id) on delete restrict,
  operation_key text not null unique,
  request_hash text not null,
  description text not null check (length(trim(description)) between 1 and 240),
  occurred_on date not null,
  total_cents bigint not null check (total_cents > 0),
  installment_count smallint not null check (installment_count between 1 and 120),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  constraint card_purchases_card_fk foreign key (card_id) references finance.credit_cards(id) on delete restrict,
  constraint card_purchases_account_same_user_fk foreign key (account_id, user_id) references finance.accounts(id, user_id) on delete restrict
);

alter table finance.card_invoice_items
  add column if not exists card_purchase_id uuid,
  add column if not exists installment_number smallint,
  add column if not exists installment_count smallint;

alter table finance.card_invoice_items
  add constraint card_invoice_items_purchase_fk foreign key (card_purchase_id) references finance.card_purchases(id) on delete restrict,
  add constraint card_invoice_items_purchase_installment_unique unique (card_purchase_id, installment_number),
  add constraint card_invoice_items_purchase_installment_check check (
    card_purchase_id is null or (installment_number between 1 and installment_count and installment_count between 1 and 120)
  );

create index if not exists card_purchases_user_date_idx on finance.card_purchases (user_id, occurred_on desc);
create index if not exists card_purchase_items_purchase_idx on finance.card_invoice_items (card_purchase_id, installment_number);

alter table finance.card_purchases enable row level security;
revoke all on finance.card_purchases from anon;
grant select on finance.card_purchases to authenticated;
drop policy if exists card_purchases_owner_select on finance.card_purchases;
create policy card_purchases_owner_select on finance.card_purchases
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists card_purchases_owner_insert on finance.card_purchases;
create policy card_purchases_owner_insert on finance.card_purchases
  for insert to authenticated with check ((select auth.uid()) = user_id);

create or replace function finance.register_card_purchase(
  p_card_id uuid,
  p_invoice_id uuid,
  p_category_id uuid,
  p_description text,
  p_amount_cents bigint,
  p_occurred_on date,
  p_installment_count smallint,
  p_operation_key text,
  p_request_hash text
)
returns table (purchase_id uuid, installment_number smallint, invoice_id uuid, transaction_id uuid, invoice_item_id uuid, installment_cents bigint)
language plpgsql
security invoker
set search_path = finance, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_card finance.credit_cards%rowtype;
  v_purchase finance.card_purchases%rowtype;
  v_invoice finance.card_invoices%rowtype;
  v_item finance.card_invoice_items%rowtype;
  v_transaction finance.transactions%rowtype;
  v_first_end date;
  v_period_end date;
  v_period_start date;
  v_due_on date;
  v_month date;
  v_last_day smallint;
  v_base_amount bigint;
  v_remainder bigint;
  v_installment_amount bigint;
  v_installment_key text;
  v_installment_hash text;
  v_index smallint;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_amount_cents is null or p_amount_cents <= 0 then raise exception 'purchase amount must be positive'; end if;
  if p_installment_count is null or p_installment_count not between 1 and 120 then raise exception 'invalid installment count'; end if;
  if p_occurred_on is null then raise exception 'purchase date is required'; end if;
  if length(trim(coalesce(p_description, ''))) not between 1 and 240 then raise exception 'purchase description is required'; end if;
  if p_operation_key is null or length(trim(p_operation_key)) not between 16 and 200 then raise exception 'invalid operation key'; end if;

  select * into v_card from finance.credit_cards where id = p_card_id and user_id = v_user_id for update;
  if not found then raise exception 'card not found'; end if;
  if not exists (select 1 from finance.categories where id = p_category_id and user_id = v_user_id) then raise exception 'category not found'; end if;

  v_month := date_trunc('month', p_occurred_on)::date;
  v_last_day := extract(day from (v_month + interval '1 month - 1 day'))::smallint;
  v_period_end := v_month + (least(v_card.closing_day, v_last_day) - 1) * interval '1 day';
  if p_occurred_on > v_period_end then
    v_month := (v_month + interval '1 month')::date;
    v_last_day := extract(day from (v_month + interval '1 month - 1 day'))::smallint;
    v_period_end := v_month + (least(v_card.closing_day, v_last_day) - 1) * interval '1 day';
  end if;
  v_first_end := v_period_end;
  v_period_start := (date_trunc('month', v_period_end - interval '1 month')::date + (least(v_card.closing_day, extract(day from (date_trunc('month', v_period_end - interval '1 month') + interval '1 month - 1 day'))::smallint)) * interval '1 day')::date;

  if p_invoice_id is not null and not exists (
    select 1 from finance.card_invoices where id = p_invoice_id and account_id = v_card.account_id and period_start = v_period_start and period_end = v_period_end
  ) then raise exception 'selected invoice does not match the purchase card cycle'; end if;

  select * into v_purchase from finance.card_purchases where operation_key = p_operation_key and user_id = v_user_id for update;
  if found then
    if v_purchase.request_hash <> p_request_hash then raise exception 'operation key was already used with a different request'; end if;
    return query select i.card_purchase_id, i.installment_number, i.invoice_id, i.transaction_id, i.id, i.total_cents
      from finance.card_invoice_items i where i.card_purchase_id = v_purchase.id order by i.installment_number;
    return;
  end if;

  insert into finance.card_purchases (user_id, card_id, account_id, category_id, operation_key, request_hash, description, occurred_on, total_cents, installment_count)
  values (v_user_id, v_card.id, v_card.account_id, p_category_id, p_operation_key, p_request_hash, trim(p_description), p_occurred_on, p_amount_cents, p_installment_count)
  returning * into v_purchase;

  v_base_amount := p_amount_cents / p_installment_count;
  v_remainder := p_amount_cents % p_installment_count;
  v_period_start := v_period_start;

  for v_index in 1..p_installment_count loop
    v_installment_amount := v_base_amount + case when v_index <= v_remainder then 1 else 0 end;
    if v_index > 1 then
      v_period_start := v_period_end + 1;
      v_month := (date_trunc('month', v_period_end) + interval '1 month')::date;
      v_last_day := extract(day from (v_month + interval '1 month - 1 day'))::smallint;
      v_period_end := v_month + (least(v_card.closing_day, v_last_day) - 1) * interval '1 day';
    end if;
    v_due_on := (date_trunc('month', v_period_end) + interval '1 month' + (least(v_card.due_day, extract(day from (date_trunc('month', v_period_end) + interval '1 month - 1 day'))::smallint) - 1) * interval '1 day')::date;

    select * into v_invoice from finance.card_invoices where account_id = v_card.account_id and period_start = v_period_start and period_end = v_period_end for update;
    if found then
      if v_invoice.status <> 'open' then raise exception 'installment % belongs to a non-open invoice', v_index; end if;
    else
      insert into finance.card_invoices (account_id, period_start, period_end, due_on, total_cents, status)
      values (v_card.account_id, v_period_start, v_period_end, v_due_on, 0, 'open') returning * into v_invoice;
    end if;

    v_installment_key := p_operation_key || ':installment:' || v_index::text;
    v_installment_hash := md5(p_request_hash || ':' || v_index::text);
    select * into v_transaction from finance.create_transaction(v_card.account_id, p_category_id, 'expense', v_installment_amount, p_occurred_on::timestamptz, trim(p_description) || ' (' || v_index || '/' || p_installment_count || ')', v_installment_key, v_installment_hash, null);

    insert into finance.card_invoice_items (invoice_id, transaction_id, principal_cents, interest_cents, fee_cents, description, category_id, occurred_on, card_purchase_id, installment_number, installment_count)
    values (v_invoice.id, v_transaction.id, v_installment_amount, 0, 0, trim(p_description), p_category_id, p_occurred_on, v_purchase.id, v_index, p_installment_count)
    returning * into v_item;

    update finance.card_invoices set total_cents = total_cents + v_item.total_cents, updated_at = now() where id = v_invoice.id;
    return query select v_purchase.id, v_index, v_invoice.id, v_transaction.id, v_item.id, v_item.total_cents;
  end loop;
end;
$$;

revoke execute on function finance.register_card_purchase(uuid, uuid, uuid, text, bigint, date, smallint, text, text) from public, anon;
grant execute on function finance.register_card_purchase(uuid, uuid, uuid, text, bigint, date, smallint, text, text) to authenticated;

commit;
