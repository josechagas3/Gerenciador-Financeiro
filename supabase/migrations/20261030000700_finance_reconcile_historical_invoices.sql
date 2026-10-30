begin;

-- Reconcilia somente objetos ausentes. Não remove histórico nem reescreve dados existentes.
alter table finance.card_invoices
  add column if not exists historical_import_pending boolean not null default false,
  add column if not exists historical_paid_cents bigint not null default 0;

alter table finance.card_purchases
  add column if not exists purchase_kind text not null default 'regular',
  add column if not exists historical_import_id uuid;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'finance.card_invoices'::regclass and conname = 'card_invoices_historical_paid_check') then
    alter table finance.card_invoices add constraint card_invoices_historical_paid_check
      check (historical_paid_cents >= 0 and historical_paid_cents <= total_cents);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'finance.card_purchases'::regclass and conname = 'card_purchases_kind_check') then
    alter table finance.card_purchases add constraint card_purchases_kind_check
      check (purchase_kind in ('regular', 'historical_import'));
  end if;
end
$$;

create table if not exists finance.card_purchase_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  operation_key text not null,
  request_hash text not null,
  expected_total_cents bigint not null check (expected_total_cents >= 0),
  imported_total_cents bigint not null check (imported_total_cents >= 0),
  item_count integer not null check (item_count > 0),
  created_at timestamptz not null default now(),
  unique (user_id, operation_key),
  unique (id, user_id),
  foreign key (invoice_id, user_id) references finance.card_invoices(id, user_id) on delete restrict
);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'finance.card_purchases'::regclass and conname = 'card_purchases_historical_import_fk') then
    alter table finance.card_purchases add constraint card_purchases_historical_import_fk
      foreign key (historical_import_id) references finance.card_purchase_imports(id) on delete restrict;
  end if;
end
$$;

alter table finance.card_invoices enable row level security;
alter table finance.card_purchases enable row level security;
alter table finance.card_purchase_imports enable row level security;
grant select on finance.card_purchase_imports to authenticated;
revoke all on finance.card_purchase_imports from anon;
drop policy if exists card_purchase_imports_owner_select on finance.card_purchase_imports;
create policy card_purchase_imports_owner_select on finance.card_purchase_imports
  for select to authenticated using ((select auth.uid()) = user_id);

create index if not exists card_purchase_imports_invoice_idx on finance.card_purchase_imports (invoice_id, created_at desc);
create index if not exists card_purchases_historical_import_idx on finance.card_purchases (historical_import_id);

create or replace function finance.validate_invoice_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  invoice_id_value uuid;
  item_total bigint;
  paid_total bigint;
  declared_total bigint;
  historical_paid bigint;
  pending_import boolean;
begin
  invoice_id_value := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  select ci.total_cents, ci.historical_import_pending, ci.historical_paid_cents
    into declared_total, pending_import, historical_paid
    from finance.card_invoices ci where ci.id = invoice_id_value for update;
  select coalesce(sum(ii.total_cents), 0) into item_total
    from finance.card_invoice_items ii where ii.invoice_id = invoice_id_value;
  select coalesce(sum(cp.paid_cents), 0) into paid_total
    from finance.card_payments cp where cp.invoice_id = invoice_id_value;
  if not (pending_import and item_total = 0) and declared_total <> item_total then
    raise exception 'invoice total must equal the sum of its items';
  end if;
  if paid_total + historical_paid > declared_total then
    raise exception 'invoice payments cannot exceed the amount due';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

do $$
begin
  if not exists (select 1 from pg_trigger where tgrelid = 'finance.card_invoice_items'::regclass and tgname = 'card_invoice_items_validate_totals') then
    create trigger card_invoice_items_validate_totals
      after insert or update or delete on finance.card_invoice_items
      for each row execute function finance.validate_invoice_totals();
  end if;
  if not exists (select 1 from pg_trigger where tgrelid = 'finance.card_payments'::regclass and tgname = 'card_payments_validate_totals') then
    create trigger card_payments_validate_totals
      after insert or update or delete on finance.card_payments
      for each row execute function finance.validate_invoice_totals();
  end if;
end
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
set search_path = ''
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
  select ik.request_hash, ik.response_body into v_existing_hash, v_existing_body
    from finance.idempotency_keys ik where ik.key = p_operation_key for update;
  if v_existing_hash <> p_request_hash then raise exception 'operation key was already used with a different request'; end if;
  if v_existing_body is not null and v_existing_body ? 'invoice_id' then
    return query select (v_existing_body->>'invoice_id')::uuid;
    return;
  end if;
  select cc.* into v_card from finance.credit_cards cc where cc.id = p_card_id and cc.user_id = v_user_id for update;
  if not found then raise exception 'card not found'; end if;
  select ci.* into v_invoice from finance.card_invoices ci
    where ci.account_id = v_card.account_id and ci.user_id = v_user_id
      and ci.period_start = p_period_start and ci.period_end = p_period_end for update;
  if found then raise exception 'invoice already exists for this card and period'; end if;
  insert into finance.card_invoices (account_id, user_id, period_start, period_end, due_on, total_cents, status, historical_import_pending, historical_paid_cents)
    values (v_card.account_id, v_user_id, p_period_start, p_period_end, p_due_on, p_total_cents, 'closed', true, p_historical_paid_cents)
    returning * into v_invoice;
  update finance.idempotency_keys set response_status = 201, response_body = jsonb_build_object('invoice_id', v_invoice.id), completed_at = now() where key = p_operation_key;
  return query select v_invoice.id;
end;
$$;

create or replace function finance.register_historical_card_purchase_import(
  p_invoice_id uuid,
  p_operation_key text,
  p_request_hash text,
  p_items jsonb
)
returns table (import_id uuid, item_count integer, imported_total_cents bigint)
language plpgsql
security definer
set search_path = ''
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
  v_item_key text;
  v_item_hash text;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_operation_key is null or length(trim(p_operation_key)) not between 16 and 200 then raise exception 'invalid operation key'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 or jsonb_array_length(p_items) > 500 then raise exception 'historical import requires 1 to 500 items'; end if;
  select ci.* into v_invoice from finance.card_invoices ci where ci.id = p_invoice_id and ci.user_id = v_user_id for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_invoice.status <> 'closed' then raise exception 'historical import requires a closed invoice'; end if;
  select coalesce(sum(ii.total_cents), 0) into v_existing_total from finance.card_invoice_items ii where ii.invoice_id = v_invoice.id;
  select cpi.* into v_import from finance.card_purchase_imports cpi where cpi.user_id = v_user_id and cpi.operation_key = p_operation_key for update;
  if found then
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
    if v_amount is null or v_amount <= 0 or v_description is null or length(v_description) not between 1 and 240 or v_occurred_on is null or v_occurred_on < v_invoice.period_start or v_occurred_on > v_invoice.period_end then raise exception 'invalid historical item %', v_index; end if;
    if not exists (select 1 from finance.categories c where c.id = v_category_id and c.user_id = v_user_id) then raise exception 'historical item % category not found', v_index; end if;
    v_imported_total := v_imported_total + v_amount;
  end loop;
  if v_existing_total + v_imported_total <> v_invoice.total_cents then raise exception 'historical import total mismatch'; end if;
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
        from finance.credit_cards cc where cc.account_id = v_invoice.account_id and cc.user_id = v_user_id limit 1;
    if not found then raise exception 'card not found for invoice account'; end if;
    select t.* into v_transaction from finance.create_transaction(v_invoice.account_id, v_category_id, 'expense', v_amount, v_occurred_on::timestamptz, v_description, v_item_key, v_item_hash, null) t;
    insert into finance.card_invoice_items (invoice_id, transaction_id, principal_cents, interest_cents, fee_cents, user_id, description, category_id, occurred_on, card_purchase_id, installment_number, installment_count)
      values (v_invoice.id, v_transaction.id, v_amount, 0, 0, v_user_id, v_description, v_category_id, v_occurred_on, (select cp.id from finance.card_purchases cp where cp.operation_key = v_item_key and cp.user_id = v_user_id), 1, 1);
  end loop;
  update finance.card_invoices set historical_import_pending = false, updated_at = now() where id = v_invoice.id and user_id = v_user_id;
  return query select v_import.id, v_import.item_count, v_import.imported_total_cents;
end;
$$;

revoke execute on function finance.register_existing_card_invoice(uuid, date, date, date, bigint, bigint, text, text) from public, anon;
revoke execute on function finance.register_historical_card_purchase_import(uuid, text, text, jsonb) from public, anon;
grant execute on function finance.register_existing_card_invoice(uuid, date, date, date, bigint, bigint, text, text) to authenticated;
grant execute on function finance.register_historical_card_purchase_import(uuid, text, text, jsonb) to authenticated;

commit;
