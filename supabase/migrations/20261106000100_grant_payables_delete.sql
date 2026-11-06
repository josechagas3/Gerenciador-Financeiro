-- The delete_payable RPC is SECURITY INVOKER and deletes only rows owned by auth.uid().
-- Keep this table privilege explicit so authenticated callers can reach the RLS policy.
grant delete on table finance.payables to authenticated;
