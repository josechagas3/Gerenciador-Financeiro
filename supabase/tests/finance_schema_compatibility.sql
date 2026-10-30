-- Auditoria somente leitura. Este arquivo não insere, atualiza, remove nem executa RPCs de negócio.

with required_tables(table_name) as (
  values
    ('accounts'), ('categories'), ('transactions'), ('idempotency_keys'),
    ('card_invoices'), ('card_invoice_items'), ('card_payments'),
    ('credit_cards'), ('card_purchases'), ('card_purchase_imports'),
    ('debts'), ('debt_payments'), ('investments'), ('investment_movements'),
    ('goals'), ('goal_contributions'), ('recurring_plans'), ('recurring_occurrences')
), missing_tables as (
  select r.table_name
  from required_tables r
  left join information_schema.tables t
    on t.table_schema = 'finance'
   and t.table_name = r.table_name
   and t.table_type = 'BASE TABLE'
  where t.table_name is null
), required_functions(name, identity_args) as (
  values
    ('create_transaction', 'uuid, uuid, text, bigint, timestamp with time zone, text, text, text, uuid'),
    ('register_card_purchase', 'uuid, uuid, uuid, text, bigint, date, integer, text, text'),
    ('register_existing_card_invoice', 'uuid, date, date, date, bigint, bigint, text, text'),
    ('register_historical_card_purchase_import', 'uuid, text, text, jsonb'),
    ('realize_recurring_occurrence', 'uuid, text, text')
), missing_functions as (
  select rf.name, rf.identity_args
  from required_functions rf
  left join pg_proc p
    on p.proname = rf.name
   and p.pronamespace = 'finance'::regnamespace
   and pg_get_function_identity_arguments(p.oid) = rf.identity_args
  where p.oid is null
), missing_columns(table_name, column_name) as (
  values
    ('card_invoices', 'historical_import_pending'),
    ('card_invoices', 'historical_paid_cents'),
    ('card_purchases', 'purchase_kind'),
    ('card_purchases', 'historical_import_id')
), absent_columns as (
  select mc.table_name, mc.column_name
  from missing_columns mc
  left join information_schema.columns c
    on c.table_schema = 'finance'
   and c.table_name = mc.table_name
   and c.column_name = mc.column_name
  where c.column_name is null
), security_gaps as (
  select c.relname as table_name
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'finance'
    and c.relkind = 'r'
    and not c.relrowsecurity
), result as (
  select 'missing_table' as issue_type, table_name as object_name, null::text as detail from missing_tables
  union all
  select 'missing_function', name, identity_args from missing_functions
  union all
  select 'missing_column', table_name || '.' || column_name, null from absent_columns
  union all
  select 'rls_disabled', table_name, null from security_gaps
)
select issue_type, object_name, detail
from result
order by issue_type, object_name;

-- Deve retornar zero linhas depois da migration corretiva e da revisão de grants/policies.
select
  p.proname,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  p.prosecdef as security_definer,
  p.proconfig
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'finance'
  and p.proname in (
    'register_existing_card_invoice',
    'register_historical_card_purchase_import',
    'create_transaction',
    'register_card_purchase'
  )
order by p.proname, identity_args;

select
  routine_name,
  specific_name,
  grantee,
  privilege_type
from information_schema.routine_privileges
where routine_schema = 'finance'
  and routine_name in (
    'register_existing_card_invoice',
    'register_historical_card_purchase_import',
    'create_transaction',
    'register_card_purchase'
  )
order by routine_name, specific_name, grantee;
