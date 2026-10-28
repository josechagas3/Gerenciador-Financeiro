-- Fase 2 — proposta documental; NÃO EXECUTAR nesta etapa.
-- Projeto-alvo declarado: supabase-cyan-kite / us-east-1.
-- A identidade efetiva e as permissões ainda precisam ser verificadas.
-- Dependência: nenhuma. Esta migration cria o schema privado e os tipos-base.

create schema if not exists finance;

-- O saldo inicial oficial vive exclusivamente em finance.accounts.opening_balance_cents.
-- Não existe evento de abertura que também altere o saldo; isso evita dupla contagem.

create table finance.accounts (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  account_type text not null check (account_type in ('checking', 'savings', 'cash', 'credit_card', 'investment', 'other')),
  currency_code char(3) not null default 'BRL' check (currency_code ~ '^[A-Z]{3}$'),
  opening_balance_cents bigint not null default 0,
  opening_balance_as_of date not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (name)
);

create table finance.categories (
  id uuid primary key default gen_random_uuid(),
  parent_id uuid references finance.categories(id) on delete restrict,
  name text not null,
  category_type text not null check (category_type in ('income', 'expense', 'both')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (parent_id, name),
  check (parent_id is null or parent_id <> id)
);

create table finance.idempotency_keys (
  key text primary key check (length(key) between 16 and 200),
  operation text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table finance.event_log (
  id bigint generated always as identity primary key,
  event_id uuid not null default gen_random_uuid() unique,
  entity_type text not null,
  entity_id uuid not null,
  event_type text not null,
  actor text not null default 'server',
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

create index accounts_active_idx on finance.accounts (is_active);
create index categories_parent_idx on finance.categories (parent_id);
create index event_log_entity_idx on finance.event_log (entity_type, entity_id, occurred_at desc);
create index event_log_type_idx on finance.event_log (event_type, occurred_at desc);
