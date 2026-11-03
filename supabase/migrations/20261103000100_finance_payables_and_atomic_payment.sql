create table if not exists finance.payables (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  category_id uuid references finance.categories(id) on delete set null, description text not null,
  amount_cents bigint not null check (amount_cents > 0), due_on date not null, notes text,
  status text not null default 'pending' check (status in ('pending','paid','cancelled')),
  paid_account_id uuid references finance.accounts(id) on delete restrict,
  paid_transaction_id uuid references finance.transactions(id) on delete restrict,
  paid_cents bigint check (paid_cents is null or paid_cents > 0), paid_on date,
  operation_key text not null unique, payment_operation_key text unique,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint payables_paid_fields_check check ((status = 'paid' and paid_account_id is not null and paid_transaction_id is not null and paid_cents is not null and paid_on is not null) or (status <> 'paid' and paid_account_id is null and paid_transaction_id is null and paid_cents is null and paid_on is null))
);
create index if not exists payables_user_status_due_idx on finance.payables(user_id, status, due_on);
grant select, insert, update on finance.payables to authenticated;
alter table finance.payables enable row level security;
create policy payables_select_own on finance.payables for select to authenticated using (auth.uid() = user_id);
create policy payables_insert_own on finance.payables for insert to authenticated with check (auth.uid() = user_id);
create policy payables_update_own on finance.payables for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function finance.create_payable(p_category_id uuid, p_amount_cents bigint, p_due_on date, p_description text, p_notes text, p_operation_key text, p_request_hash text) returns finance.payables language plpgsql security invoker set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_existing finance.payables; v_created finance.payables;
begin
 if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
 if p_amount_cents is null or p_amount_cents <= 0 or p_due_on is null or p_description is null or length(btrim(p_description)) = 0 then raise exception 'invalid payable'; end if;
 if p_operation_key is null or length(p_operation_key) not between 16 and 200 or p_request_hash is null then raise exception 'invalid idempotency data'; end if;
 select * into v_existing from finance.payables where operation_key = p_operation_key and user_id = v_user_id for update;
 if found then return v_existing; end if;
 insert into finance.payables(user_id,category_id,description,amount_cents,due_on,notes,operation_key) values(v_user_id,p_category_id,btrim(p_description),p_amount_cents,p_due_on,nullif(btrim(coalesce(p_notes,'')),''),p_operation_key) returning * into v_created;
 return v_created;
end; $$;
grant execute on function finance.create_payable(uuid,bigint,date,text,text,text,text) to authenticated;
revoke execute on function finance.create_payable(uuid,bigint,date,text,text,text,text) from public, anon;

create or replace function finance.pay_payable(p_payable_id uuid, p_account_id uuid, p_paid_cents bigint, p_paid_on date, p_operation_key text, p_request_hash text) returns finance.payables language plpgsql security invoker set search_path = '' as $$
declare v_user_id uuid := auth.uid(); v_payable finance.payables; v_transaction finance.transactions;
begin
 if v_user_id is null then raise exception 'authentication required' using errcode = '42501'; end if;
 select * into v_payable from finance.payables where id=p_payable_id and user_id=v_user_id for update;
 if not found then raise exception 'payable not found' using errcode = 'P0002'; end if;
 if v_payable.status='paid' then if v_payable.payment_operation_key=p_operation_key then return v_payable; end if; raise exception 'payable already paid'; end if;
 if v_payable.status <> 'pending' or p_paid_cents <> v_payable.amount_cents or p_paid_cents <= 0 then raise exception 'invalid payment'; end if;
 if not exists (select 1 from finance.accounts where id=p_account_id and user_id=v_user_id and is_active) then raise exception 'payment account not found'; end if;
 insert into finance.transactions(account_id,category_id,transaction_type,status,amount_cents,entry_sign,occurred_at,description,operation_key,user_id) values(p_account_id,v_payable.category_id,'expense','posted',p_paid_cents,-1,p_paid_on::timestamptz,v_payable.description,p_operation_key,v_user_id) returning * into v_transaction;
 update finance.payables set status='paid',paid_account_id=p_account_id,paid_transaction_id=v_transaction.id,paid_cents=p_paid_cents,paid_on=p_paid_on,payment_operation_key=p_operation_key,updated_at=now() where id=p_payable_id and user_id=v_user_id returning * into v_payable;
 return v_payable;
end; $$;
grant execute on function finance.pay_payable(uuid,uuid,bigint,date,text,text) to authenticated;
revoke execute on function finance.pay_payable(uuid,uuid,bigint,date,text,text) from public, anon;
