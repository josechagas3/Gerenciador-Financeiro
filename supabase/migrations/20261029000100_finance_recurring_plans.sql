-- Proposta local para revisão. NÃO EXECUTAR nesta etapa.
-- Não cria dados, não altera o banco remoto e depende das migrations financeiras anteriores.

begin;

create table finance.recurring_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id uuid not null,
  category_id uuid not null,
  description text not null check (length(trim(description)) > 0),
  plan_type text not null check (plan_type in ('income', 'expense')),
  amount_cents bigint not null check (amount_cents > 0),
  frequency text not null default 'monthly' check (frequency = 'monthly'),
  due_day smallint not null check (due_day between 1 and 31),
  starts_on date not null,
  ends_on date,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_plans_account_same_user_fk
    foreign key (account_id, user_id) references finance.accounts(id, user_id),
  constraint recurring_plans_category_same_user_fk
    foreign key (category_id, user_id) references finance.categories(id, user_id),
  constraint recurring_plans_date_range_check
    check (ends_on is null or ends_on >= starts_on),
  unique (id, user_id)
);

create table finance.recurring_occurrences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  plan_id uuid not null,
  period date not null check (period = date_trunc('month', period)::date),
  due_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  status text not null default 'planned' check (status in ('planned', 'realized', 'cancelled')),
  transaction_id uuid,
  realized_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint recurring_occurrences_plan_same_user_fk
    foreign key (plan_id, user_id) references finance.recurring_plans(id, user_id) on delete restrict,
  constraint recurring_occurrences_transaction_same_user_fk
    foreign key (transaction_id, user_id) references finance.transactions(id, user_id) on delete restrict,
  constraint recurring_occurrences_realized_link_check
    check ((status = 'realized') = (transaction_id is not null and realized_at is not null)),
  constraint recurring_occurrences_planned_link_check
    check (status <> 'planned' or (transaction_id is null and realized_at is null)),
  unique (id, user_id),
  unique (plan_id, period)
);

create index recurring_plans_user_active_idx on finance.recurring_plans(user_id, is_active, starts_on);
create index recurring_occurrences_user_period_idx on finance.recurring_occurrences(user_id, period, status);
create index recurring_occurrences_plan_due_idx on finance.recurring_occurrences(plan_id, due_on);

create trigger recurring_plans_touch_updated_at
before update on finance.recurring_plans
for each row execute function finance.touch_updated_at();

create trigger recurring_occurrences_touch_updated_at
before update on finance.recurring_occurrences
for each row execute function finance.touch_updated_at();

create trigger recurring_plans_audit
after insert or update on finance.recurring_plans
for each row execute function finance.audit_financial_change();

create trigger recurring_occurrences_audit
after insert or update on finance.recurring_occurrences
for each row execute function finance.audit_financial_change();

alter table finance.recurring_plans enable row level security;
alter table finance.recurring_occurrences enable row level security;

revoke all on finance.recurring_plans from public, anon, authenticated;
revoke all on finance.recurring_occurrences from public, anon, authenticated;
grant select, insert, update, delete on finance.recurring_plans to authenticated;
grant select, insert, update, delete on finance.recurring_occurrences to authenticated;

create policy recurring_plans_owner_all
on finance.recurring_plans
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

create policy recurring_occurrences_owner_all
on finance.recurring_occurrences
for all to authenticated
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);

revoke execute on function finance.audit_financial_change() from public, anon, authenticated;
revoke execute on function finance.touch_updated_at() from public, anon, authenticated;

commit;
