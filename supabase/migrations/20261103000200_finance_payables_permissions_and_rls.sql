grant select, insert, update on finance.payables to authenticated;
alter table finance.payables enable row level security;
drop policy if exists payables_select_own on finance.payables;
drop policy if exists payables_insert_own on finance.payables;
drop policy if exists payables_update_own on finance.payables;
create policy payables_select_own on finance.payables for select to authenticated using (auth.uid() = user_id);
create policy payables_insert_own on finance.payables for insert to authenticated with check (auth.uid() = user_id);
create policy payables_update_own on finance.payables for update to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);
