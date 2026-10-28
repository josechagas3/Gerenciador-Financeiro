-- Fase 2 — proposta documental; NÃO EXECUTAR nesta etapa.
-- Segurança deny-by-default e auditoria transacional.

revoke all on schema finance from public, anon, authenticated;
revoke all on all tables in schema finance from public, anon, authenticated;
revoke all on all sequences in schema finance from public, anon, authenticated;
revoke all on all functions in schema finance from public, anon, authenticated;

grant usage on schema finance to service_role;
grant select, insert, update, delete on all tables in schema finance to service_role;
grant usage, select, update on all sequences in schema finance to service_role;
grant execute on all functions in schema finance to service_role;

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
alter default privileges in schema finance
  grant execute on functions to service_role;

alter table finance.accounts enable row level security;
alter table finance.categories enable row level security;
alter table finance.idempotency_keys enable row level security;
alter table finance.event_log enable row level security;
alter table finance.transfer_operations enable row level security;
alter table finance.transactions enable row level security;
alter table finance.card_invoices enable row level security;
alter table finance.card_invoice_items enable row level security;
alter table finance.card_payments enable row level security;

-- Sem Supabase Auth não existe identidade de usuário para uma policy segura.
-- A ausência de policies para anon/authenticated é intencional: acesso negado.
-- Não há autorização baseada em cabeçalho da Vercel neste pacote.

create or replace function finance.audit_financial_change()
returns trigger language plpgsql as $$
declare
  entity uuid;
  event_name text;
begin
  entity := coalesce(new.id, old.id);
  event_name := lower(tg_table_name) || '.' || lower(tg_op);
  if tg_table_name = 'transactions' and coalesce(new.status, old.status) <> 'posted' then
    if tg_op = 'DELETE' then
      return old;
    end if;
    return new;
  end if;
  insert into finance.event_log(entity_type, entity_id, event_type, payload)
  values (tg_table_name, entity, event_name,
          jsonb_build_object('operation', tg_op, 'new', to_jsonb(new), 'old', to_jsonb(old)));
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

-- Eventos de lançamento confirmado e de seus vínculos são criados no mesmo
-- commit da operação. A aplicação não deve escrever event_log diretamente.
create trigger transactions_audit
  after insert or update on finance.transactions
  for each row execute function finance.audit_financial_change();
create trigger transfer_operations_audit
  after insert or update on finance.transfer_operations
  for each row execute function finance.audit_financial_change();
create trigger card_invoices_audit
  after insert or update on finance.card_invoices
  for each row execute function finance.audit_financial_change();
create trigger invoice_items_audit
  after insert or update on finance.card_invoice_items
  for each row execute function finance.audit_financial_change();
create trigger card_payments_audit
  after insert or update on finance.card_payments
  for each row execute function finance.audit_financial_change();

create or replace function finance.prevent_event_log_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'finance.event_log is append-only';
end;
$$;
create trigger event_log_append_only
  before update or delete on finance.event_log
  for each row execute function finance.prevent_event_log_mutation();

comment on schema finance is 'Dados financeiros internos; não expor diretamente pela Data API.';
comment on table finance.transactions is 'O lançamento opening, único por conta, é a fonte oficial do saldo inicial.';
comment on table finance.event_log is 'Histórico append-only; alterações e exclusões são rejeitadas por trigger.';
