begin;

-- Avoid direct OLD/NEW.field references across tables with different row shapes.
-- JSON conversion keeps the shared trigger function safe for card_invoices (id)
-- and child tables (invoice_id).
create or replace function finance.validate_invoice_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_invoice_id uuid := case
    when tg_table_name = 'card_invoices' then
      (case when tg_op = 'DELETE' then to_jsonb(old)->>'id' else to_jsonb(new)->>'id' end)::uuid
    when tg_table_name in ('card_invoice_items', 'card_payments') then
      (case when tg_op = 'DELETE' then to_jsonb(old)->>'invoice_id' else to_jsonb(new)->>'invoice_id' end)::uuid
    else null
  end;
  v_declared bigint;
  v_pending boolean;
  v_item_total bigint;
  v_paid_total bigint;
  v_historical_paid bigint;
  v_charges bigint;
  v_credits bigint;
  v_reconciled boolean;
begin
  if v_invoice_id is null then
    raise exception 'validate_invoice_totals attached to unexpected table %', tg_table_name;
  end if;

  select ci.total_cents, ci.historical_import_pending, ci.historical_paid_cents
    into v_declared, v_pending, v_historical_paid
    from finance.card_invoices ci
   where ci.id = v_invoice_id
   for update;

  if not found then
    raise exception 'invoice % not found while validating totals', v_invoice_id;
  end if;

  select coalesce(sum(ii.total_cents), 0)
    into v_item_total
    from finance.card_invoice_items ii
   where ii.invoice_id = v_invoice_id;

  select coalesce(sum(cp.paid_cents), 0)
    into v_paid_total
    from finance.card_payments cp
   where cp.invoice_id = v_invoice_id;

  select coalesce(sum(case when a.kind in ('credit', 'refund') then a.amount_cents else 0 end), 0),
         coalesce(sum(case when a.kind not in ('credit', 'refund') then a.amount_cents else 0 end), 0)
    into v_credits, v_charges
    from finance.card_invoice_adjustments a
   where a.invoice_id = v_invoice_id;

  select exists(select 1 from finance.card_invoice_reconciliations r where r.invoice_id = v_invoice_id)
    into v_reconciled;

  if v_pending then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if v_reconciled then
    if v_declared <> v_item_total + v_charges - v_credits - v_paid_total - coalesce(v_historical_paid, 0) then
      raise exception 'invoice reconciliation total mismatch';
    end if;
  elsif v_declared <> v_item_total then
    raise exception 'invoice total must equal the sum of its items';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

commit;
