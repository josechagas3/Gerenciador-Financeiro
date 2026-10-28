-- Fase 2 — proposta documental; NÃO EXECUTAR nesta etapa.
-- Dependência: 20261028000100_finance_schema.sql.
-- Dinheiro: bigint positivo + entry_sign (-1/+1); nunca numeric/float.

create table finance.transfer_operations (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique references finance.idempotency_keys(key) on delete restrict,
  from_account_id uuid not null references finance.accounts(id) on delete restrict,
  to_account_id uuid not null references finance.accounts(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'pending' check (status in ('pending', 'posted', 'cancelled')),
  occurred_at timestamptz not null,
  description text not null check (length(trim(description)) > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_account_id <> to_account_id)
);

create table finance.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references finance.accounts(id) on delete restrict,
  category_id uuid references finance.categories(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('opening', 'income', 'expense', 'transfer', 'adjustment', 'reversal')),
  status text not null default 'pending' check (status in ('pending', 'posted', 'cancelled')),
  amount_cents bigint not null check (amount_cents > 0),
  entry_sign smallint not null check (entry_sign in (-1, 1)),
  occurred_at timestamptz not null,
  description text not null check (length(trim(description)) > 0),
  external_reference text,
  transfer_group_id uuid references finance.transfer_operations(id) on delete restrict,
  original_transaction_id uuid references finance.transactions(id) on delete restrict,
  operation_key text not null references finance.idempotency_keys(key) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((transaction_type = 'transfer') = (transfer_group_id is not null)),
  check ((transaction_type in ('reversal', 'adjustment')) = (original_transaction_id is not null)),
  check (transaction_type <> 'income' or category_id is not null),
  check (transaction_type <> 'expense' or category_id is not null),
  check (transaction_type <> 'opening' or (category_id is null and original_transaction_id is null and transfer_group_id is null)),
  check (transaction_type <> 'transfer' or entry_sign in (-1, 1))
);

create unique index transactions_non_transfer_operation_unique
  on finance.transactions (operation_key)
  where transfer_group_id is null;
create unique index transactions_one_opening_per_account on finance.transactions (account_id)
  where transaction_type = 'opening';
create unique index transfer_one_leg_per_account
  on finance.transactions (transfer_group_id, account_id)
  where transfer_group_id is not null;
create index transactions_account_date_idx on finance.transactions (account_id, occurred_at desc);
create index transactions_status_idx on finance.transactions (status, occurred_at desc);
create index transactions_category_idx on finance.transactions (category_id, occurred_at desc);
create index transactions_transfer_idx on finance.transactions (transfer_group_id) where transfer_group_id is not null;
create index transactions_original_idx on finance.transactions (original_transaction_id) where original_transaction_id is not null;

-- Valida a operação inteira no commit: exatamente duas pernas, contas distintas,
-- mesma quantia, uma saída e uma entrada. A operação usa uma única idempotency_key.
create or replace function finance.validate_transfer_operation()
returns trigger language plpgsql as $$
declare
  op finance.transfer_operations;
  operation_id uuid;
  leg_count integer;
  total_signed bigint;
  distinct_accounts integer;
begin
  if tg_table_name = 'transfer_operations' then
    operation_id := new.id;
  else
    operation_id := new.transfer_group_id;
  end if;
  select * into op from finance.transfer_operations where id = operation_id for update;
  select count(*), coalesce(sum(amount_cents * entry_sign), 0), count(distinct account_id)
    into leg_count, total_signed, distinct_accounts
    from finance.transactions
    where transfer_group_id = operation_id and status = 'posted';
  if op.status = 'posted' and (leg_count <> 2 or total_signed <> 0 or distinct_accounts <> 2) then
    raise exception 'transfer operation must have two posted opposite legs';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create constraint trigger transfer_operation_integrity
  after insert or update on finance.transactions
  deferrable initially deferred
  for each row execute function finance.validate_transfer_operation();
create constraint trigger transfer_operation_status_integrity
  after insert or update on finance.transfer_operations
  deferrable initially deferred
  for each row execute function finance.validate_transfer_operation();

-- Compras no cartão são despesas na data da compra; o pagamento da fatura é
-- separado e não duplica o resultado financeiro.
create table finance.card_invoices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references finance.accounts(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  due_on date not null,
  total_cents bigint not null default 0 check (total_cents >= 0),
  status text not null default 'open' check (status in ('open', 'closed', 'paid', 'overdue', 'cancelled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, period_start, period_end),
  check (period_end >= period_start)
);

create table finance.card_invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references finance.card_invoices(id) on delete restrict,
  transaction_id uuid not null unique references finance.transactions(id) on delete restrict,
  principal_cents bigint not null check (principal_cents >= 0),
  interest_cents bigint not null default 0 check (interest_cents >= 0),
  fee_cents bigint not null default 0 check (fee_cents >= 0),
  total_cents bigint generated always as (principal_cents + interest_cents + fee_cents) stored,
  unique (invoice_id, transaction_id)
);

create table finance.card_payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references finance.card_invoices(id) on delete restrict,
  payment_transaction_id uuid not null unique references finance.transactions(id) on delete restrict,
  paid_cents bigint not null check (paid_cents > 0),
  paid_at timestamptz not null,
  operation_key text not null unique references finance.idempotency_keys(key) on delete restrict
);

create index card_invoices_account_due_idx on finance.card_invoices (account_id, due_on);
create index invoice_items_invoice_idx on finance.card_invoice_items (invoice_id);
create index card_payments_invoice_idx on finance.card_payments (invoice_id, paid_at);

-- Soma e limite de pagamentos são verificados sob lock da fatura; isso cobre
-- pagamentos concorrentes e alterações concorrentes de encargos.
create or replace function finance.validate_invoice_totals()
returns trigger language plpgsql as $$
declare
  invoice_id_value uuid := coalesce(new.invoice_id, old.invoice_id);
  item_total bigint;
  paid_total bigint;
  declared_total bigint;
begin
  select total_cents into declared_total from finance.card_invoices where id = invoice_id_value for update;
  select coalesce(sum(total_cents), 0) into item_total from finance.card_invoice_items where invoice_id = invoice_id_value;
  select coalesce(sum(paid_cents), 0) into paid_total from finance.card_payments where invoice_id = invoice_id_value;
  if tg_table_name = 'card_invoice_items' and declared_total <> item_total then
    raise exception 'invoice total must equal the sum of its items';
  end if;
  if paid_total > item_total then
    raise exception 'invoice payments cannot exceed the amount due';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create constraint trigger invoice_items_integrity
  after insert or update or delete on finance.card_invoice_items
  deferrable initially deferred for each row execute function finance.validate_invoice_totals();
create constraint trigger invoice_payments_integrity
  after insert or update or delete on finance.card_payments
  deferrable initially deferred for each row execute function finance.validate_invoice_totals();
