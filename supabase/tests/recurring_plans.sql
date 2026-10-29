\set ON_ERROR_STOP on

-- Este arquivo deve ser executado somente em um PostgreSQL descartável/local.
-- Não contém INSERT de dados financeiros nem habilita a RPC.

DO $$
DECLARE
  v_rls boolean;
  v_security boolean;
  v_config text[];
  v_execute_count integer;
BEGIN
  SELECT relrowsecurity INTO v_rls
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'finance' AND c.relname = 'recurring_occurrences';
  IF coalesce(v_rls, false) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL: recurring_occurrences RLS is not enabled';
  END IF;

  SELECT p.prosecdef, p.proconfig
    INTO v_security, v_config
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'finance'
    AND p.proname = 'realize_recurring_occurrence';
  IF v_security IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL: RPC is not SECURITY INVOKER';
  END IF;
  IF position('search_path=' in replace(array_to_string(coalesce(v_config, ARRAY[]::text[]), ','), ' ', '')) = 0 THEN
    RAISE EXCEPTION 'FAIL: RPC does not pin search_path';
  END IF;
  IF position('finance_recurring_writes_enabled=false' in replace(array_to_string(coalesce(v_config, ARRAY[]::text[]), ','), ' ', '')) = 0 THEN
    RAISE EXCEPTION 'FAIL: RPC write gate is not false by default';
  END IF;

  SELECT count(*) INTO v_execute_count
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'finance'
    AND routine_name = 'realize_recurring_occurrence'
    AND lower(grantee) IN ('public', 'anon');
  IF v_execute_count <> 0 THEN
    RAISE EXCEPTION 'FAIL: RPC is executable by public or anon';
  END IF;

  SELECT count(*) INTO v_execute_count
  FROM information_schema.role_routine_grants
  WHERE routine_schema = 'finance'
    AND routine_name = 'realize_recurring_occurrence'
    AND lower(grantee) = 'authenticated'
    AND privilege_type = 'EXECUTE';
  IF v_execute_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: authenticated does not have exactly one EXECUTE grant';
  END IF;

  RAISE NOTICE 'PASS: RLS, SECURITY INVOKER, search_path, default gate and grants';
END;
$$;

DO $$
DECLARE
  v_policy_count integer;
  v_unique_count integer;
BEGIN
  SELECT count(*) INTO v_policy_count
  FROM pg_policies
  WHERE schemaname = 'finance'
    AND tablename in ('recurring_plans', 'recurring_occurrences')
    AND policyname like '%owner%';
  IF v_policy_count < 2 THEN
    RAISE EXCEPTION 'FAIL: owner RLS policies are incomplete';
  END IF;

  SELECT count(*) INTO v_unique_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'finance'
    AND t.relname = 'recurring_occurrences'
    AND c.conname = 'recurring_occurrences_plan_id_period_key';
  IF v_unique_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: occurrence uniqueness constraint is missing';
  END IF;

  SELECT count(*) INTO v_unique_count
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'finance'
    AND t.relname = 'idempotency_keys'
    AND c.contype = 'p';
  IF v_unique_count <> 1 THEN
    RAISE EXCEPTION 'FAIL: idempotency key primary key is missing';
  END IF;

  RAISE NOTICE 'PASS: RLS ownership, duplicate-period and idempotency constraints';
END;
$$;

-- Dynamic functional scenarios are intentionally opt-in in the shell harness:
-- concurrent realization, same-key replay, mismatched request hash, rollback,
-- cross-user access, trigger/audit effects and realized/cancelled immutability.
-- They must run only after an explicit isolated-database enablement step.
