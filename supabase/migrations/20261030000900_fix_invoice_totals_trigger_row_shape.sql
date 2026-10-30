begin;

-- O trigger é compartilhado por três tabelas, mas somente duas expõem invoice_id.
-- Aborta em qualquer estrutura inesperada para evitar corrigir o objeto errado.
do $$
begin
  if to_regclass('finance.card_invoices') is null
     or to_regclass('finance.card_invoice_items') is null
     or to_regclass('finance.card_payments') is null then
    raise exception 'expected finance invoice trigger tables are missing';
  end if;
  if not exists (
    select 1 from pg_trigger t
    where t.tgname = 'invoice_header_integrity'
      and t.tgrelid = 'finance.card_invoices'::regclass
      and t.tgfoid = 'finance.validate_invoice_totals()'::regprocedure
  ) then
    raise exception 'unexpected invoice_header_integrity trigger structure';
  end if;
end
$$;

create or replace function finance.validate_invoice_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  invoice_id_value uuid;
  item_total bigint;
  paid_total bigint;
  declared_total bigint;
  historical_paid bigint;
  pending_import boolean;
begin
  -- card_invoices has id; card_invoice_items and card_payments have invoice_id.
  if tg_table_name = 'card_invoices' then
    invoice_id_value := case when tg_op = 'DELETE' then old.id else new.id end;
  elsif tg_table_name in ('card_invoice_items', 'card_payments') then
    invoice_id_value := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  else
    raise exception 'validate_invoice_totals attached to unexpected table %', tg_table_name;
  end if;

  select ci.total_cents, ci.historical_import_pending, ci.historical_paid_cents
    into declared_total, pending_import, historical_paid
    from finance.card_invoices ci
   where ci.id = invoice_id_value
   for update;

  if not found then
    raise exception 'invoice % not found while validating totals', invoice_id_value;
  end if;

  select coalesce(sum(ii.total_cents), 0)
    into item_total
    from finance.card_invoice_items ii
   where ii.invoice_id = invoice_id_value;

  select coalesce(sum(cp.paid_cents), 0)
    into paid_total
    from finance.card_payments cp
   where cp.invoice_id = invoice_id_value;

  if not (pending_import and item_total = 0) and declared_total <> item_total then
    raise exception 'invoice total must equal the sum of its items';
  end if;
  if paid_total + historical_paid > declared_total then
    raise exception 'invoice payments cannot exceed the amount due';
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

commit;
