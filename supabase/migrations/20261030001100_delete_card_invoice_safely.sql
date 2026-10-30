begin;

create or replace function finance.delete_card_invoice_safely(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_invoice finance.card_invoices%rowtype;
  v_items bigint;
  v_payments bigint;
  v_adjustments bigint;
  v_reconciliations bigint;
begin
  if v_user_id is null then
    raise exception 'authentication required';
  end if;

  select ci.* into v_invoice
  from finance.card_invoices ci
  where ci.id = p_invoice_id
    and ci.user_id = v_user_id
  for update;

  if not found then
    raise exception 'invoice not found';
  end if;

  if v_invoice.status <> 'open' then
    raise exception 'only open invoices without financial records can be deleted';
  end if;

  select count(*) into v_items
  from finance.card_invoice_items
  where invoice_id = v_invoice.id and user_id = v_user_id;

  select count(*) into v_payments
  from finance.card_payments
  where invoice_id = v_invoice.id and user_id = v_user_id;

  select count(*) into v_adjustments
  from finance.card_invoice_adjustments
  where invoice_id = v_invoice.id and user_id = v_user_id;

  select count(*) into v_reconciliations
  from finance.card_invoice_reconciliations
  where invoice_id = v_invoice.id and user_id = v_user_id;

  if v_items > 0 or v_payments > 0 or v_adjustments > 0 or v_reconciliations > 0 or coalesce(v_invoice.historical_paid_cents, 0) > 0 then
    raise exception 'invoice has financial records and cannot be deleted';
  end if;

  delete from finance.card_invoices
  where id = v_invoice.id and user_id = v_user_id;
end;
$$;

revoke execute on function finance.delete_card_invoice_safely(uuid) from public, anon;
grant execute on function finance.delete_card_invoice_safely(uuid) to authenticated;

commit;
