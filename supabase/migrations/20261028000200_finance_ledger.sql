-- Fase 2 — proposta documental; NÃO EXECUTAR nesta etapa.
-- Dependência: 20261028000100_finance_schema.sql.
-- Valores monetários são centavos inteiros (bigint), nunca numeric/float.

create table finance.transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references finance.accounts(id) on delete restrict,
  category_id uuid references finance.categories(id) on delete restrict,
  transaction_type text not null check (transaction_type in ('opening', 'income', 'expense', 'transfer', 'adjustment', 'reversal')),
  status text not null default 'pending' check (status in ('pending', 'posted', 'cancelled')),
  amount_cents bigint not null check (amount_cents > 0),
  occurred_at timestamptz not null,
  description text not null check (length(trim(description)) > 0),
  external_reference text,
  transfer_group_id uuid,
  original_transaction_id uuid references finance.transactions(id) on delete restrict,
  idempotency_key text not null references finance.idempotency_keys(key) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((transaction_type = 'transfer') = (transfer_group_id is not null)),
  check ((transaction_type in ('reversal', 'adjustment')) = (original_transaction_id is not null)),
  check (transaction_type <> 'income' or category_id is not null),
  check (transaction_type <> 'expense' or category_id is not null),
  check (transaction_type <> 'opening' or (category_id is null and original_transaction_id is null and transfer_group_id is null))
);

create unique index transactions_idempotency_unique on finance.transactions (idempotency_key);
create unique index transactions_one_opening_per_account on finance.transactions (account_id)
  where transaction_type = 'opening';
create index transactions_account_date_idx on finance.transactions (account_id, occurred_at desc);
create index transactions_status_idx on finance.transactions (status, occurred_at desc);
create index transactions_category_idx on finance.transactions (category_id, occurred_at desc);
create index transactions_transfer_idx on finance.transactions (transfer_group_id) where transfer_group_id is not null;
create index transactions_original_idx on finance.transactions (original_transaction_id) where original_transaction_id is not null;

-- Compras no cartão representam resultado financeiro na data da compra.
-- O pagamento da fatura é um lançamento separado, normalmente transferindo
-- caixa para a conta do cartão; não se registra a compra duas vezes como despesa.
create table finance.card_invoices (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references finance.accounts(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  due_on date not null,
  total_cents bigint not null default 0 check (total_cents >= 0),
  status text not null default 'open' check (status in ('open', 'closed', 'paid', 'overdue', 'cancelled')),
  created_at timestamptz not null default now(),
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
  idempotency_key text not null unique references finance.idempotency_keys(key) on delete restrict
);

create index card_invoices_account_due_idx on finance.card_invoices (account_id, due_on);
create index invoice_items_invoice_idx on finance.card_invoice_items (invoice_id);
create index card_payments_invoice_idx on finance.card_payments (invoice_id, paid_at);

-- A aplicação deve validar que transferências tenham exatamente dois lançamentos
-- de mesma quantia, contas distintas e sinais opostos antes de confirmar.
