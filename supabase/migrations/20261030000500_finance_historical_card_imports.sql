begin;

alter table finance.card_purchases
  add column if not exists purchase_kind text not null default 'regular',
  add column if not exists historical_import_id uuid;

do $$ begin
  if not exists (select 1 from pg_constraint where conrelid = 'finance.card_purchases'::regclass and conname = 'card_purchases_kind_check') then
    alter table finance.card_purchases add constraint card_purchases_kind_check check (purchase_kind in ('regular', 'historical_import'));
  end if;
end $$;

create table if not exists finance.card_purchase_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  operation_key text not null unique,
  request_hash text not null,
  expected_total_cents bigint not null check (expected_total_cents >= 0),
  imported_total_cents bigint not null check (imported_total_cents >= 0),
  item_count integer not null check (item_count > 0),
  created_at timestamptz not null default now(),
  unique (id, user_id),
  foreign key (invoice_id, user_id) references finance.card_invoices(id, user_id) on delete restrict
);

alter table finance.card_purchases
  add constraint card_purchases_historical_import_fk foreign key (historical_import_id) references finance.card_purchase_imports(id) on delete restrict;

alter table finance.card_purchases enable row level security;
alter table finance.card_purchase_imports enable row level security;
grant select on finance.card_purchase_imports to authenticated;
revoke all on finance.card_purchase_imports from anon;
drop policy if exists card_purchase_imports_owner_select on finance.card_purchase_imports;
create policy card_purchase_imports_owner_select on finance.card_purchase_imports for select to authenticated using ((select auth.uid()) = user_id);

create index if not exists card_purchase_imports_invoice_idx on finance.card_purchase_imports (invoice_id, created_at desc);
create index if not exists card_purchases_historical_import_idx on finance.card_purchases (historical_import_id);

create or replace function finance.register_historical_card_purchase_import(
  p_invoice_id uuid,
  p_operation_key text,
  p_request_hash text,
  p_items jsonb
)
returns table (import_id uuid, item_count integer, imported_total_cents bigint)
language plpgsql
security invoker
set search_path = finance, pg_temp
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_invoice finance.card_invoices%rowtype;
  v_import finance.card_purchase_imports%rowtype;
  v_item jsonb;
  v_index integer := 0;
  v_amount bigint;
  v_imported_total bigint := 0;
  v_existing_total bigint := 0;
  v_description text;
  v_occurred_on date;
  v_category_id uuid;
  v_purchase finance.card_purchases%rowtype;
  v_transaction finance.transactions%rowtype;
  v_item_row finance.card_invoice_items%rowtype;
  v_item_key text;
  v_item_hash text;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_operation_key is null or length(trim(p_operation_key)) not between 16 and 200 then raise exception 'invalid operation key'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then raise exception 'historical import requires at least one item'; end if;

  select ci.* into v_invoice from finance.card_invoices ci where ci.id = p_invoice_id and ci.user_id = v_user_id for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_invoice.status <> 'closed' then raise exception 'historical import requires a closed invoice'; end if;

  select coalesce(sum(total_cents), 0) into v_existing_total from finance.card_invoice_items where invoice_id = v_invoice.id;
  if exists (select 1 from finance.card_purchase_imports where operation_key = p_operation_key and user_id = v_user_id) then
    select * into v_import from finance.card_purchase_imports where operation_key = p_operation_key and user_id = v_user_id for update;
    if v_import.request_hash <> p_request_hash then raise exception 'operation key was already used with a different request'; end if;
    return query select v_import.id, v_import.item_count, v_import.imported_total_cents;
    return;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_amount := (v_item->>'amountCents')::bigint;
    v_description := trim(v_item->>'description');
    v_occurred_on := (v_item->>'occurredOn')::date;
    v_category_id := (v_item->>'categoryId')::uuid;
    if v_amount is null or v_amount <= 0 then raise exception 'historical item % has invalid amount', v_index; end if;
    if v_description is null or length(v_description) not between 1 and 240 then raise exception 'historical item % has invalid description', v_index; end if;
    if v_occurred_on is null or v_occurred_on < v_invoice.period_start or v_occurred_on > v_invoice.period_end then raise exception 'historical item % is outside the invoice period', v_index; end if;
    if not exists (select 1 from finance.categories where id = v_category_id and user_id = v_user_id) then raise exception 'historical item % category not found', v_index; end if;
    v_imported_total := v_imported_total + v_amount;
  end loop;

  if v_existing_total + v_imported_total <> v_invoice.total_cents then
    raise exception 'historical import total mismatch: expected %, existing %, received %', v_invoice.total_cents, v_existing_total, v_imported_total;
  end if;

  insert into finance.card_purchase_imports (user_id, invoice_id, operation_key, request_hash, expected_total_cents, imported_total_cents, item_count)
  values (v_user_id, v_invoice.id, p_operation_key, p_request_hash, v_invoice.total_cents, v_imported_total, v_index)
  returning * into v_import;

  v_index := 0;
  for v_item in select * from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_amount := (v_item->>'amountCents')::bigint;
    v_description := trim(v_item->>'description');
    v_occurred_on := (v_item->>'occurredOn')::date;
    v_category_id := (v_item->>'categoryId')::uuid;
    v_item_key := p_operation_key || ':item:' || v_index::text;
    v_item_hash := md5(p_request_hash || ':' || v_index::text);
    insert into finance.card_purchases (user_id, card_id, account_id, category_id, operation_key, request_hash, description, occurred_on, total_cents, installment_count, purchase_kind, historical_import_id)
    select v_user_id, cc.id, v_invoice.account_id, v_category_id, v_item_key, v_item_hash, v_description, v_occurred_on, v_amount, 1, 'historical_import', v_import.id
      from finance.credit_cards cc where cc.account_id = v_invoice.account_id and cc.user_id = v_user_id limit 1
    returning * into v_purchase;
    if not found then raise exception 'card not found for invoice account'; end if;
    select * into v_transaction from finance.create_transaction(v_invoice.account_id, v_category_id, 'expense', v_amount, v_occurred_on::timestamptz, v_description, v_item_key, v_item_hash, null);
    insert into finance.card_invoice_items (invoice_id, transaction_id, principal_cents, interest_cents, fee_cents, user_id, description, category_id, occurred_on, card_purchase_id, installment_number, installment_count)
    values (v_invoice.id, v_transaction.id, v_amount, 0, 0, v_user_id, v_description, v_category_id, v_occurred_on, v_purchase.id, 1, 1)
    returning * into v_item_row;
  end loop;

  return query select v_import.id, v_import.item_count, v_import.imported_total_cents;
end;
$$;

revoke execute on function finance.register_historical_card_purchase_import(uuid, text, text, jsonb) from public, anon;
grant execute on function finance.register_historical_card_purchase_import(uuid, text, text, jsonb) to authenticated;

commit;
