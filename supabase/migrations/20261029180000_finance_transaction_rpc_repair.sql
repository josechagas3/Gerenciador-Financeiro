-- Correção local do drift: finance_transaction_rpc foi registrada remotamente,
-- mas finance.create_transaction não existe no catálogo.
-- NÃO EXECUTAR REMOTAMENTE sem revisão e autorização específica.
-- Não sobrescreve uma função existente: aborta se a assinatura já estiver presente.

DO $$
BEGIN
  IF to_regprocedure('finance.create_transaction(uuid,uuid,text,bigint,timestamptz,text,text,text,uuid)') IS NOT NULL THEN
    RAISE EXCEPTION 'repair aborted: finance.create_transaction with the expected signature already exists';
  END IF;
END;
$$;

CREATE FUNCTION finance.create_transaction(
  p_account_id uuid,
  p_category_id uuid,
  p_transaction_type text,
  p_amount_cents bigint,
  p_occurred_at timestamptz,
  p_description text,
  p_operation_key text,
  p_request_hash text,
  p_original_transaction_id uuid DEFAULT NULL
)
RETURNS finance.transactions
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing finance.idempotency_keys;
  v_created finance.transactions;
  v_reserved text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'authentication required' USING errcode = '42501';
  END IF;
  IF p_amount_cents IS NULL OR p_amount_cents <= 0 THEN
    RAISE EXCEPTION 'amount must be positive';
  END IF;
  IF p_transaction_type NOT IN ('opening', 'income', 'expense') THEN
    RAISE EXCEPTION 'unsupported transaction type';
  END IF;
  IF p_original_transaction_id IS NOT NULL THEN
    RAISE EXCEPTION 'reversal and adjustment must use their dedicated server flow';
  END IF;
  IF p_operation_key IS NULL OR length(p_operation_key) NOT BETWEEN 16 AND 200 THEN
    RAISE EXCEPTION 'invalid operation key';
  END IF;
  IF p_request_hash IS NULL OR length(btrim(p_request_hash)) = 0 THEN
    RAISE EXCEPTION 'request hash is required';
  END IF;

  INSERT INTO finance.idempotency_keys (key, operation, request_hash, user_id)
  VALUES (p_operation_key, 'create_transaction', p_request_hash, v_user_id)
  ON CONFLICT (key) DO NOTHING
  RETURNING key INTO v_reserved;

  IF v_reserved IS NULL THEN
    SELECT * INTO v_existing
    FROM finance.idempotency_keys
    WHERE key = p_operation_key
    FOR UPDATE;

    IF v_existing.user_id IS DISTINCT FROM v_user_id
       OR v_existing.operation IS DISTINCT FROM 'create_transaction'
       OR v_existing.request_hash IS DISTINCT FROM p_request_hash THEN
      RAISE EXCEPTION 'idempotency key was already used with a different request';
    END IF;

    SELECT * INTO v_created
    FROM finance.transactions
    WHERE operation_key = p_operation_key
      AND user_id = v_user_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'idempotency reservation has no transaction';
    END IF;
    RETURN v_created;
  END IF;

  INSERT INTO finance.transactions (
    account_id,
    category_id,
    transaction_type,
    status,
    amount_cents,
    entry_sign,
    occurred_at,
    description,
    original_transaction_id,
    operation_key,
    user_id
  )
  VALUES (
    p_account_id,
    p_category_id,
    p_transaction_type,
    'posted',
    p_amount_cents,
    CASE WHEN p_transaction_type = 'expense' THEN -1 ELSE 1 END,
    p_occurred_at,
    p_description,
    p_original_transaction_id,
    p_operation_key,
    v_user_id
  )
  RETURNING * INTO v_created;

  RETURN v_created;
END;
$$;

GRANT EXECUTE ON FUNCTION finance.create_transaction(uuid, uuid, text, bigint, timestamptz, text, text, text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION finance.create_transaction(uuid, uuid, text, bigint, timestamptz, text, text, text, uuid) FROM public, anon;
