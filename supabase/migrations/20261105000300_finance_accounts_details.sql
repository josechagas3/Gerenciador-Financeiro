-- Add descriptive account metadata and benefit account types without changing ledger history.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'finance' AND table_name = 'accounts' AND column_name = 'institution') THEN
    ALTER TABLE finance.accounts ADD COLUMN institution text;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'finance' AND table_name = 'accounts' AND column_name = 'description') THEN
    ALTER TABLE finance.accounts ADD COLUMN description text;
  END IF;
END $$;

ALTER TABLE finance.accounts DROP CONSTRAINT IF EXISTS accounts_account_type_check;
ALTER TABLE finance.accounts ADD CONSTRAINT accounts_account_type_check
  CHECK (account_type IN ('checking', 'savings', 'cash', 'meal_voucher', 'meal_allowance', 'benefits', 'credit_card', 'investment', 'other'));

CREATE INDEX IF NOT EXISTS accounts_user_active_name_idx ON finance.accounts (user_id, is_active, name);
