-- Fase 2 — proposta documental; NÃO EXECUTAR nesta etapa.
-- Impede alterações diretas no lançamento original depois que um estorno existe.
-- Continua SECURITY INVOKER e deixa RLS/auth.uid() governarem a operação.

create or replace function finance.prevent_editing_reversed_transaction()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if exists (
    select 1
    from finance.transactions child
    where child.original_transaction_id = old.id
      and child.user_id = old.user_id
  ) then
    raise exception 'reversed transactions are immutable';
  end if;
  return new;
end;
$$;

create trigger transactions_reversed_immutable
before update on finance.transactions
for each row
execute function finance.prevent_editing_reversed_transaction();
