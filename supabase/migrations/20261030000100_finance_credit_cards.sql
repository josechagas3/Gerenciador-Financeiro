-- Preparação local; não aplicar remotamente nesta etapa.
-- O schema remoto já possui card_invoices, card_invoice_items e card_payments,
-- mas não possui o cadastro descritivo do cartão.
begin;

create table if not exists finance.credit_cards (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null unique,
  user_id uuid not null references auth.users(id) on delete cascade,
  constraint credit_cards_account_same_user_fk foreign key (account_id, user_id) references finance.accounts(id, user_id) on delete restrict,
  name text not null check (length(trim(name)) between 1 and 120),
  brand text not null check (length(trim(brand)) between 1 and 40),
  credit_limit_cents bigint not null check (credit_limit_cents > 0),
  closing_day smallint not null check (closing_day between 1 and 31),
  due_day smallint not null check (due_day between 1 and 31),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (account_id, user_id)
);

create index if not exists credit_cards_user_id_idx on finance.credit_cards (user_id);
create index if not exists credit_cards_account_id_idx on finance.credit_cards (account_id);
alter table finance.credit_cards enable row level security;
revoke all on finance.credit_cards from anon;
grant select, insert, update, delete on finance.credit_cards to authenticated;
drop policy if exists credit_cards_owner_all on finance.credit_cards;
create policy credit_cards_owner_all on finance.credit_cards
  for all to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

commit;
