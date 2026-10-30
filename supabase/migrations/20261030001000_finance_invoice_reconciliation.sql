begin;

create table if not exists finance.card_invoice_adjustments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  kind text not null check (kind in ('opening_balance','interest','iof','annual_fee','fee','other_charge','credit','refund')),
  description text not null check (length(trim(description)) between 1 and 240),
  occurred_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  operation_key text not null,
  request_hash text not null,
  created_at timestamptz not null default now(),
  unique (user_id, operation_key)
);

create table if not exists finance.card_invoice_reconciliations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  invoice_id uuid not null,
  operation_key text not null,
  request_hash text not null,
  opening_balance_cents bigint not null default 0 check (opening_balance_cents >= 0),
  purchases_cents bigint not null default 0 check (purchases_cents >= 0),
  charges_cents bigint not null default 0 check (charges_cents >= 0),
  credits_cents bigint not null default 0 check (credits_cents >= 0),
  payments_cents bigint not null default 0 check (payments_cents >= 0),
  final_balance_cents bigint not null,
  created_at timestamptz not null default now(),
  unique (user_id, operation_key)
);

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid='finance.card_invoice_adjustments'::regclass and conname='card_invoice_adjustments_invoice_user_fk') then
    alter table finance.card_invoice_adjustments add constraint card_invoice_adjustments_invoice_user_fk foreign key (invoice_id,user_id) references finance.card_invoices(id,user_id) on delete restrict;
  end if;
  if not exists (select 1 from pg_constraint where conrelid='finance.card_invoice_reconciliations'::regclass and conname='card_invoice_reconciliations_invoice_user_fk') then
    alter table finance.card_invoice_reconciliations add constraint card_invoice_reconciliations_invoice_user_fk foreign key (invoice_id,user_id) references finance.card_invoices(id,user_id) on delete restrict;
  end if;
end
$$;

alter table finance.card_invoice_adjustments enable row level security;
alter table finance.card_invoice_reconciliations enable row level security;
grant select on finance.card_invoice_adjustments, finance.card_invoice_reconciliations to authenticated;
revoke all on finance.card_invoice_adjustments, finance.card_invoice_reconciliations from anon;
drop policy if exists card_invoice_adjustments_owner_select on finance.card_invoice_adjustments;
drop policy if exists card_invoice_reconciliations_owner_select on finance.card_invoice_reconciliations;
create policy card_invoice_adjustments_owner_select on finance.card_invoice_adjustments for select to authenticated using ((select auth.uid()) = user_id);
create policy card_invoice_reconciliations_owner_select on finance.card_invoice_reconciliations for select to authenticated using ((select auth.uid()) = user_id);
create index if not exists card_invoice_adjustments_invoice_idx on finance.card_invoice_adjustments(invoice_id,occurred_on);
create index if not exists card_invoice_reconciliations_invoice_idx on finance.card_invoice_reconciliations(invoice_id,created_at desc);

create or replace function finance.validate_invoice_totals()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_invoice_id uuid := case when tg_table_name = 'card_invoices' then case when tg_op='DELETE' then old.id else new.id end else case when tg_op='DELETE' then old.invoice_id else new.invoice_id end end;
  v_declared bigint;
  v_pending boolean;
  v_item_total bigint;
  v_paid_total bigint;
  v_historical_paid bigint;
  v_charges bigint;
  v_credits bigint;
  v_reconciled boolean;
begin
  select ci.total_cents,ci.historical_import_pending,ci.historical_paid_cents into v_declared,v_pending,v_historical_paid from finance.card_invoices ci where ci.id=v_invoice_id for update;
  if not found then raise exception 'invoice not found while validating totals'; end if;
  select coalesce(sum(ii.total_cents),0) into v_item_total from finance.card_invoice_items ii where ii.invoice_id=v_invoice_id;
  select coalesce(sum(cp.paid_cents),0) into v_paid_total from finance.card_payments cp where cp.invoice_id=v_invoice_id;
  select coalesce(sum(case when a.kind in ('credit','refund') then a.amount_cents else 0 end),0),coalesce(sum(case when a.kind not in ('credit','refund') then a.amount_cents else 0 end),0) into v_credits,v_charges from finance.card_invoice_adjustments a where a.invoice_id=v_invoice_id;
  select exists(select 1 from finance.card_invoice_reconciliations r where r.invoice_id=v_invoice_id) into v_reconciled;
  if v_pending then return case when tg_op='DELETE' then old else new end; end if;
  if v_reconciled then
    if v_declared <> v_item_total + v_charges - v_credits - v_paid_total - coalesce(v_historical_paid,0) then raise exception 'invoice reconciliation total mismatch'; end if;
  elsif v_declared <> v_item_total then
    raise exception 'invoice total must equal the sum of its items';
  end if;
  return case when tg_op='DELETE' then old else new end;
end;
$$;

create or replace function finance.reconcile_historical_card_invoice(
  p_invoice_id uuid,
  p_operation_key text,
  p_request_hash text,
  p_opening_balance_cents bigint,
  p_items jsonb,
  p_payments jsonb
)
returns table (reconciliation_id uuid, final_balance_cents bigint)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_invoice finance.card_invoices%rowtype;
  v_card finance.credit_cards%rowtype;
  v_existing finance.card_invoice_reconciliations%rowtype;
  v_item jsonb;
  v_payment jsonb;
  v_kind text;
  v_amount bigint;
  v_purchase_total bigint := 0;
  v_charge_total bigint := 0;
  v_credit_total bigint := 0;
  v_payment_total bigint := 0;
  v_existing_items bigint := 0;
  v_existing_adjustments bigint := 0;
  v_existing_credits bigint := 0;
  v_existing_payments bigint := 0;
  v_final bigint;
  v_index integer := 0;
  v_item_key text;
  v_item_hash text;
  v_transaction_id uuid;
  v_reconciliation_id uuid;
  v_description text;
  v_occurred_on date;
  v_category_id uuid;
  v_installments integer;
begin
  if v_user_id is null then raise exception 'authentication required'; end if;
  if p_opening_balance_cents is null or p_opening_balance_cents < 0 then raise exception 'invalid opening balance'; end if;
  if p_operation_key is null or length(trim(p_operation_key)) not between 16 and 200 then raise exception 'invalid operation key'; end if;
  if p_request_hash is null or length(trim(p_request_hash)) = 0 then raise exception 'request hash is required'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 500 then raise exception 'invalid reconciliation items'; end if;
  if jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) > 100 then raise exception 'invalid reconciliation payments'; end if;

  select ci.* into v_invoice from finance.card_invoices ci where ci.id=p_invoice_id and ci.user_id=v_user_id for update;
  if not found then raise exception 'invoice not found'; end if;
  if v_invoice.status <> 'closed' then raise exception 'reconciliation requires a closed invoice'; end if;
  select cpi.* into v_existing from finance.card_invoice_reconciliations cpi where cpi.user_id=v_user_id and cpi.operation_key=p_operation_key for update;
  if found then
    if v_existing.request_hash <> p_request_hash then raise exception 'operation key was already used with a different request'; end if;
    return query select v_existing.id,v_existing.final_balance_cents;
    return;
  end if;
  select cc.* into v_card from finance.credit_cards cc where cc.account_id=v_invoice.account_id and cc.user_id=v_user_id for update limit 1;
  if not found then raise exception 'card not found for invoice account'; end if;

  select coalesce(sum(ii.total_cents),0) into v_existing_items from finance.card_invoice_items ii where ii.invoice_id=v_invoice.id and ii.user_id=v_user_id;
  select coalesce(sum(case when a.kind in ('credit','refund') then a.amount_cents else 0 end),0), coalesce(sum(case when a.kind not in ('credit','refund') then a.amount_cents else 0 end),0) into v_existing_credits,v_existing_adjustments from finance.card_invoice_adjustments a where a.invoice_id=v_invoice.id and a.user_id=v_user_id;
  select coalesce(sum(cp.paid_cents),0) into v_existing_payments from finance.card_payments cp where cp.invoice_id=v_invoice.id and cp.user_id=v_user_id;

  if p_opening_balance_cents > 0 then
    insert into finance.card_invoice_adjustments(user_id,invoice_id,kind,description,occurred_on,amount_cents,operation_key,request_hash) values(v_user_id,v_invoice.id,'opening_balance','Saldo anterior',v_invoice.period_start,p_opening_balance_cents,p_operation_key||':opening',p_request_hash);
    v_existing_adjustments := v_existing_adjustments + p_opening_balance_cents;
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_index := v_index + 1;
    v_kind := coalesce(v_item->>'kind','purchase');
    v_amount := (v_item->>'amountCents')::bigint;
    v_description := trim(v_item->>'description');
    v_occurred_on := (v_item->>'occurredOn')::date;
    v_category_id := nullif(v_item->>'categoryId','')::uuid;
    v_installments := coalesce((v_item->>'installmentCount')::integer,1);
    if v_amount is null or v_amount <= 0 or v_description is null or length(v_description) not between 1 and 240 or v_occurred_on is null or v_occurred_on < v_invoice.period_start or v_occurred_on > v_invoice.period_end then raise exception 'invalid reconciliation item %',v_index; end if;
    if v_kind='purchase' then
      if v_category_id is null or not exists(select 1 from finance.categories c where c.id=v_category_id and c.user_id=v_user_id) then raise exception 'purchase item % category not found',v_index; end if;
      if v_installments < 1 or v_installments > 120 then raise exception 'invalid installment count'; end if;
      v_item_key := p_operation_key||':purchase:'||v_index::text;
      v_item_hash := md5(p_request_hash||':'||v_index::text);
      select t.id into v_transaction_id from finance.create_transaction(v_invoice.account_id,v_category_id,'expense',v_amount,v_occurred_on::timestamptz,v_description,v_item_key,v_item_hash,null) t;
      insert into finance.card_purchases(user_id,card_id,account_id,category_id,operation_key,request_hash,description,occurred_on,total_cents,installment_count,purchase_kind) values(v_user_id,v_card.id,v_invoice.account_id,v_category_id,v_item_key,v_item_hash,v_description,v_occurred_on,v_amount,v_installments,'historical_import');
      insert into finance.card_invoice_items(invoice_id,transaction_id,principal_cents,interest_cents,fee_cents,total_cents,user_id,description,category_id,occurred_on,installment_number,installment_count) values(v_invoice.id,v_transaction_id,v_amount,0,0,v_amount,v_user_id,v_description,v_category_id,v_occurred_on,1,v_installments);
      v_purchase_total := v_purchase_total + v_amount;
    elsif v_kind in ('credit','refund') then
      insert into finance.card_invoice_adjustments(user_id,invoice_id,kind,description,occurred_on,amount_cents,operation_key,request_hash) values(v_user_id,v_invoice.id,v_kind,v_description,v_occurred_on,v_amount,p_operation_key||':adjustment:'||v_index::text,p_request_hash);
      v_credit_total := v_credit_total + v_amount;
    elsif v_kind in ('interest','iof','annual_fee','fee','other_charge') then
      insert into finance.card_invoice_adjustments(user_id,invoice_id,kind,description,occurred_on,amount_cents,operation_key,request_hash) values(v_user_id,v_invoice.id,v_kind,v_description,v_occurred_on,v_amount,p_operation_key||':adjustment:'||v_index::text,p_request_hash);
      v_charge_total := v_charge_total + v_amount;
    else raise exception 'unsupported reconciliation item kind %',v_kind;
    end if;
  end loop;

  for v_payment in select * from jsonb_array_elements(p_payments) loop
    v_amount := (v_payment->>'amountCents')::bigint;
    if v_amount is null or v_amount <= 0 or (v_payment->>'transactionId') is null then raise exception 'invalid reconciliation payment'; end if;
    insert into finance.card_payments(invoice_id,payment_transaction_id,paid_cents,paid_at,operation_key,user_id) values(v_invoice.id,(v_payment->>'transactionId')::uuid,v_amount,coalesce((v_payment->>'paidAt')::timestamptz,now()),p_operation_key||':payment:'||v_index::text,v_user_id);
    v_payment_total := v_payment_total + v_amount;
    v_index := v_index + 1;
  end loop;

  v_final := v_existing_items + v_purchase_total + v_existing_adjustments + v_charge_total - v_existing_credits - v_credit_total + v_invoice.historical_paid_cents + v_existing_payments + v_payment_total;
  if v_final <> v_invoice.total_cents then raise exception 'reconciliation mismatch: calculated %, expected %',v_final,v_invoice.total_cents; end if;

  insert into finance.card_invoice_reconciliations(user_id,invoice_id,operation_key,request_hash,opening_balance_cents,purchases_cents,charges_cents,credits_cents,payments_cents,final_balance_cents) values(v_user_id,v_invoice.id,p_operation_key,p_request_hash,p_opening_balance_cents,v_purchase_total,v_charge_total,v_credit_total,v_payment_total,v_final) returning id into v_reconciliation_id;
  update finance.card_invoices set historical_import_pending=false,updated_at=now() where id=v_invoice.id and user_id=v_user_id;
  return query select v_reconciliation_id,v_final;
end;
$$;

revoke execute on function finance.reconcile_historical_card_invoice(uuid,text,text,bigint,jsonb,jsonb) from public,anon;
grant execute on function finance.reconcile_historical_card_invoice(uuid,text,text,bigint,jsonb,jsonb) to authenticated;

commit;
