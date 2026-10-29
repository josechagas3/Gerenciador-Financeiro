-- Preparação local; não aplicar remotamente nesta etapa.
begin;

create table if not exists finance.debts (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  creditor text not null check (length(trim(creditor)) between 1 and 160), description text not null check (length(trim(description)) between 1 and 240),
  original_cents bigint not null check (original_cents > 0), balance_cents bigint not null check (balance_cents >= 0 and balance_cents <= original_cents),
  due_on date, installments_total integer not null default 1 check (installments_total > 0), installments_paid integer not null default 0 check (installments_paid between 0 and installments_total), status text not null default 'open' check (status in ('open','paid','cancelled')),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists debts_user_idx on finance.debts(user_id, status, due_on);
create table if not exists finance.debt_payments (
  id uuid primary key default gen_random_uuid(), debt_id uuid not null references finance.debts(id) on delete restrict, user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0), paid_on date not null, operation_key text not null, transaction_id uuid references finance.transactions(id) on delete restrict,
  created_at timestamptz not null default now(), unique(user_id, operation_key)
);
create index if not exists debt_payments_debt_idx on finance.debt_payments(user_id, debt_id, paid_on desc);

create table if not exists finance.investments (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160), investment_type text not null check (length(trim(investment_type)) between 1 and 80), institution text not null check (length(trim(institution)) between 1 and 160), applied_cents bigint not null check (applied_cents >= 0), invested_on date not null,
  status text not null default 'active' check (status in ('active','closed')), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists investments_user_idx on finance.investments(user_id, status, invested_on desc);
create table if not exists finance.investment_movements (
  id uuid primary key default gen_random_uuid(), investment_id uuid not null references finance.investments(id) on delete restrict, user_id uuid not null references auth.users(id) on delete cascade,
  movement_type text not null check (movement_type in ('contribution','withdrawal')), amount_cents bigint not null check (amount_cents > 0), occurred_on date not null, operation_key text not null, transaction_id uuid references finance.transactions(id) on delete restrict,
  created_at timestamptz not null default now(), unique(user_id, operation_key)
);

create table if not exists finance.goals (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 160), target_cents bigint not null check (target_cents > 0), deadline date, status text not null default 'active' check (status in ('active','completed','cancelled')), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists finance.goal_contributions (
  id uuid primary key default gen_random_uuid(), goal_id uuid not null references finance.goals(id) on delete restrict, user_id uuid not null references auth.users(id) on delete cascade,
  amount_cents bigint not null check (amount_cents > 0), contributed_on date not null, operation_key text not null, transaction_id uuid references finance.transactions(id) on delete restrict, created_at timestamptz not null default now(), unique(user_id, operation_key)
);

create index if not exists investment_movements_user_idx on finance.investment_movements(user_id, investment_id, occurred_on desc);
create index if not exists goals_user_idx on finance.goals(user_id, status, deadline);
create index if not exists goal_contributions_user_idx on finance.goal_contributions(user_id, goal_id, contributed_on desc);

alter table finance.debts enable row level security; alter table finance.debt_payments enable row level security; alter table finance.investments enable row level security; alter table finance.investment_movements enable row level security; alter table finance.goals enable row level security; alter table finance.goal_contributions enable row level security;
grant select, insert, update, delete on finance.debts, finance.debt_payments, finance.investments, finance.investment_movements, finance.goals, finance.goal_contributions to authenticated;
drop policy if exists debts_owner_all on finance.debts;
create policy debts_owner_all on finance.debts for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists debt_payments_owner_all on finance.debt_payments;
create policy debt_payments_owner_all on finance.debt_payments for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists investments_owner_all on finance.investments;
create policy investments_owner_all on finance.investments for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists investment_movements_owner_all on finance.investment_movements;
create policy investment_movements_owner_all on finance.investment_movements for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists goals_owner_all on finance.goals;
create policy goals_owner_all on finance.goals for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists goal_contributions_owner_all on finance.goal_contributions;
create policy goal_contributions_owner_all on finance.goal_contributions for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);

create or replace function finance.apply_debt_payment() returns trigger language plpgsql as $$
declare current_balance bigint;
begin
  select balance_cents into current_balance from finance.debts where id = new.debt_id and user_id = new.user_id for update;
  if current_balance is null then raise exception 'debt not found'; end if;
  if new.amount_cents > current_balance then raise exception 'debt payment exceeds remaining balance'; end if;
  update finance.debts set balance_cents = current_balance - new.amount_cents, installments_paid = least(installments_total, installments_paid + 1), status = case when current_balance = new.amount_cents then 'paid' else status end, updated_at = now() where id = new.debt_id;
  return new;
end; $$;
drop trigger if exists debt_payment_balance_trigger on finance.debt_payments;
create trigger debt_payment_balance_trigger before insert on finance.debt_payments for each row execute function finance.apply_debt_payment();

commit;
