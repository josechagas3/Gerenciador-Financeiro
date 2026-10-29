#!/usr/bin/env bash
set -euo pipefail

: "${RECURRING_TEST_DATABASE_URL:?Defina RECURRING_TEST_DATABASE_URL para um PostgreSQL isolado/local}"
: "${RECURRING_TEST_DATABASE_ISOLATED_CONFIRMATION:?Confirme o banco descartável com RECURRING_TEST_DATABASE_ISOLATED_CONFIRMATION=I_UNDERSTAND_THIS_IS_DISPOSABLE}"
if [[ "$RECURRING_TEST_DATABASE_ISOLATED_CONFIRMATION" != "I_UNDERSTAND_THIS_IS_DISPOSABLE" ]]; then
  echo "Recusando execução sem confirmação explícita de banco descartável exclusivo para testes." >&2
  exit 2
fi

case "$RECURRING_TEST_DATABASE_URL" in
  *supabase*|*lime-house*|*production*|*vercel*|*postgres-prisma*|*postgres-url*)
    echo "Refusando uma URL que aparenta ser compartilhada, Supabase ou Production." >&2
    exit 2
    ;;
esac

command -v psql >/dev/null || { echo "psql não está instalado; nenhum teste foi executado." >&2; exit 3; }

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
unset PGDATABASE

on_exit() {
  local status=$?
  if [[ "$status" -ne 0 ]]; then
    echo "Harness interrompido; descarte o banco de teste antes de qualquer nova execução." >&2
  fi
  exit "$status"
}
trap on_exit EXIT

migrations=(
  "$root_dir/supabase/migrations/20261028000100_finance_schema.sql"
  "$root_dir/supabase/migrations/20261028000200_finance_ledger.sql"
  "$root_dir/supabase/migrations/20261028000300_finance_security.sql"
  "$root_dir/supabase/migrations/20261028000400_finance_ownership_rls.sql"
  "$root_dir/supabase/migrations/20261029000100_finance_recurring_plans.sql"
  "$root_dir/supabase/migrations/20261029000200_finance_transaction_rpc.sql"
)

for migration in "${migrations[@]}"; do
  echo "Aplicando somente no banco isolado: $(basename "$migration")"
  psql "$RECURRING_TEST_DATABASE_URL" --set ON_ERROR_STOP=1 --file "$migration"
done

psql "$RECURRING_TEST_DATABASE_URL" --set ON_ERROR_STOP=1 --file "$root_dir/supabase/tests/recurring_plans.sql"

echo "Teste estrutural concluído."
echo "Os cenários de escrita continuam opt-in e exigem um fixture isolado explícito."
echo "Nenhuma etapa deste script habilita a RPC; a função permanece bloqueada por padrão."
