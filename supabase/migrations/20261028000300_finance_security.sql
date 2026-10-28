-- Fase 2 — proposta documental; NÃO EXECUTAR nesta etapa.
-- Dependência: 20261028000100_finance_schema.sql e 20261028000200_finance_ledger.sql.
-- Esta aplicação não terá Supabase Auth nesta fase.
-- Portanto anon/authenticated não recebem grants e não há políticas que finjam
-- autorização de usuário. service_role é privilegiado e deve permanecer somente
-- no servidor; ele contorna RLS e não pode ser enviado ao navegador.

revoke all on schema finance from public, anon, authenticated;
revoke all on all tables in schema finance from public, anon, authenticated;
revoke all on all sequences in schema finance from public, anon, authenticated;
revoke all on all functions in schema finance from public, anon, authenticated;

grant usage on schema finance to service_role;
grant select, insert, update, delete on all tables in schema finance to service_role;
grant usage, select, update on all sequences in schema finance to service_role;

alter default privileges in schema finance
  revoke all on tables from public, anon, authenticated;
alter default privileges in schema finance
  revoke all on sequences from public, anon, authenticated;
alter default privileges in schema finance
  revoke all on functions from public, anon, authenticated;

alter default privileges in schema finance
  grant select, insert, update, delete on tables to service_role;
alter default privileges in schema finance
  grant usage, select, update on sequences to service_role;

alter table finance.accounts enable row level security;
alter table finance.categories enable row level security;
alter table finance.idempotency_keys enable row level security;
alter table finance.event_log enable row level security;
alter table finance.transactions enable row level security;
alter table finance.card_invoices enable row level security;
alter table finance.card_invoice_items enable row level security;
alter table finance.card_payments enable row level security;

-- Sem Supabase Auth não existe identidade de usuário para uma policy segura.
-- Ausência de policy para anon/authenticated é intencional: acesso negado.
-- Nenhum endpoint público é criado nesta migration. Se no futuro houver leitura
-- pública, ela deverá usar uma view dedicada, security_invoker, grant SELECT
-- explícito e policy explícita apenas para dados não sensíveis.

comment on schema finance is 'Dados financeiros internos; não expor diretamente pela Data API.';
comment on column finance.accounts.opening_balance_cents is 'Fonte oficial única do saldo inicial; não duplicar em evento de abertura.';
