-- Revisão obrigatória antes da execução.
-- Esta migration não foi aplicada remotamente.
-- As tabelas existentes não têm user_id; a falha deliberada com dados existentes
-- evita atribuir registros financeiros a um usuário incorreto.

begin;

DO $$
DECLARE
  table_name text;
  has_rows boolean;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'accounts', 'categories', 'transactions', 'transfer_operations',
    'card_invoices', 'card_invoice_items', 'card_payments',
    'event_log', 'idempotency_keys'
  ] LOOP
    EXECUTE format('select exists (select 1 from finance.%I)', table_name) INTO has_rows;
    IF has_rows THEN
      RAISE EXCEPTION 'finance.% já contém dados; atribuição de ownership exige decisão explícita', table_name;
    END IF;
  END LOOP;
END $$;

ALTER TABLE finance.accounts ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE finance.categories ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE finance.transactions ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE finance.transfer_operations ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE finance.card_invoices ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE finance.card_invoice_items ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE finance.card_payments ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE finance.event_log ADD COLUMN user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE finance.idempotency_keys ADD COLUMN user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE;

ALTER TABLE finance.accounts ADD CONSTRAINT accounts_id_user_id_key UNIQUE (id, user_id);
ALTER TABLE finance.categories ADD CONSTRAINT categories_id_user_id_key UNIQUE (id, user_id);
ALTER TABLE finance.transactions ADD CONSTRAINT transactions_id_user_id_key UNIQUE (id, user_id);
ALTER TABLE finance.transfer_operations ADD CONSTRAINT transfer_operations_id_user_id_key UNIQUE (id, user_id);
ALTER TABLE finance.card_invoices ADD CONSTRAINT card_invoices_id_user_id_key UNIQUE (id, user_id);
ALTER TABLE finance.idempotency_keys ADD CONSTRAINT idempotency_keys_key_user_id_key UNIQUE (key, user_id);

CREATE INDEX accounts_user_id_idx ON finance.accounts (user_id);
CREATE INDEX categories_user_id_idx ON finance.categories (user_id);
CREATE INDEX transactions_user_id_occurred_at_idx ON finance.transactions (user_id, occurred_at DESC);
CREATE INDEX transfer_operations_user_id_occurred_at_idx ON finance.transfer_operations (user_id, occurred_at DESC);
CREATE INDEX card_invoices_user_id_due_on_idx ON finance.card_invoices (user_id, due_on);
CREATE INDEX card_invoice_items_user_id_idx ON finance.card_invoice_items (user_id);
CREATE INDEX card_payments_user_id_paid_at_idx ON finance.card_payments (user_id, paid_at DESC);
CREATE INDEX event_log_user_id_occurred_at_idx ON finance.event_log (user_id, occurred_at DESC);
CREATE INDEX idempotency_keys_user_id_created_at_idx ON finance.idempotency_keys (user_id, created_at DESC);

-- Parent/child integrity is enforced in addition to row ownership.
ALTER TABLE finance.categories ADD CONSTRAINT categories_parent_same_user_fk
  FOREIGN KEY (parent_id, user_id) REFERENCES finance.categories (id, user_id);
ALTER TABLE finance.transactions ADD CONSTRAINT transactions_account_same_user_fk
  FOREIGN KEY (account_id, user_id) REFERENCES finance.accounts (id, user_id);
ALTER TABLE finance.transactions ADD CONSTRAINT transactions_category_same_user_fk
  FOREIGN KEY (category_id, user_id) REFERENCES finance.categories (id, user_id);
ALTER TABLE finance.transfer_operations ADD CONSTRAINT transfer_from_account_same_user_fk
  FOREIGN KEY (from_account_id, user_id) REFERENCES finance.accounts (id, user_id);
ALTER TABLE finance.transfer_operations ADD CONSTRAINT transfer_to_account_same_user_fk
  FOREIGN KEY (to_account_id, user_id) REFERENCES finance.accounts (id, user_id);
ALTER TABLE finance.card_invoices ADD CONSTRAINT card_invoice_account_same_user_fk
  FOREIGN KEY (account_id, user_id) REFERENCES finance.accounts (id, user_id);
ALTER TABLE finance.card_invoice_items ADD CONSTRAINT card_item_invoice_same_user_fk
  FOREIGN KEY (invoice_id, user_id) REFERENCES finance.card_invoices (id, user_id);
ALTER TABLE finance.card_invoice_items ADD CONSTRAINT card_item_transaction_same_user_fk
  FOREIGN KEY (transaction_id, user_id) REFERENCES finance.transactions (id, user_id);
ALTER TABLE finance.card_payments ADD CONSTRAINT card_payment_invoice_same_user_fk
  FOREIGN KEY (invoice_id, user_id) REFERENCES finance.card_invoices (id, user_id);
ALTER TABLE finance.card_payments ADD CONSTRAINT card_payment_transaction_same_user_fk
  FOREIGN KEY (payment_transaction_id, user_id) REFERENCES finance.transactions (id, user_id);
ALTER TABLE finance.transactions ADD CONSTRAINT transactions_operation_same_user_fk
  FOREIGN KEY (operation_key, user_id) REFERENCES finance.idempotency_keys (key, user_id);
ALTER TABLE finance.transfer_operations ADD CONSTRAINT transfer_operation_key_same_user_fk
  FOREIGN KEY (idempotency_key, user_id) REFERENCES finance.idempotency_keys (key, user_id);
ALTER TABLE finance.card_payments ADD CONSTRAINT card_payment_operation_key_same_user_fk
  FOREIGN KEY (operation_key, user_id) REFERENCES finance.idempotency_keys (key, user_id);
ALTER TABLE finance.transactions ADD CONSTRAINT transactions_original_same_user_fk
  FOREIGN KEY (original_transaction_id, user_id) REFERENCES finance.transactions (id, user_id);
ALTER TABLE finance.transactions ADD CONSTRAINT transactions_transfer_same_user_fk
  FOREIGN KEY (transfer_group_id, user_id) REFERENCES finance.transfer_operations (id, user_id);

DO $$
DECLARE
  table_name text;
BEGIN
  GRANT USAGE ON SCHEMA finance TO authenticated;

  FOREACH table_name IN ARRAY ARRAY[
    'accounts', 'categories', 'transactions', 'transfer_operations',
    'card_invoices', 'card_invoice_items', 'card_payments',
    'event_log', 'idempotency_keys'
  ] LOOP
    EXECUTE format('alter table finance.%I enable row level security', table_name);
    EXECUTE format('revoke all on finance.%I from anon', table_name);
    EXECUTE format('revoke all on finance.%I from authenticated', table_name);
    EXECUTE format('grant select, insert, update, delete on finance.%I to authenticated', table_name);
    EXECUTE format('create policy %I on finance.%I for all to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id)', table_name || '_owner_all', table_name);
  END LOOP;
END $$;

-- These are trigger helpers, not a public RPC surface.
REVOKE EXECUTE ON FUNCTION finance.audit_financial_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION finance.prevent_event_log_mutation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION finance.prevent_partial_transfer_leg_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION finance.touch_updated_at() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION finance.validate_invoice_totals() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION finance.validate_transfer_operation() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION finance.validate_transfer_status_transition() FROM PUBLIC, anon, authenticated;

commit;
