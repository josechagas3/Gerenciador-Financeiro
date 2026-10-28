# Etapa 2 — proposta documental de banco

## Escopo e identidade

Estes arquivos são uma proposta local para revisão. Nenhum SQL foi executado, nenhuma migration foi aplicada e nenhum recurso remoto foi modificado. O único alvo autorizado é `supabase-cyan-kite`, região `us-east-1`; `supabase-lime-house` não foi acessado.

A identidade efetiva do banco e as permissões ainda precisam ser verificadas antes de qualquer execução: confirmar no Dashboard o Project Reference e comparar o hostname configurado na aplicação, sem expor chaves. A integração disponível não é prova de identidade quando os metadados do schema permanecem indisponíveis.

## Ordem de dependência

1. `20261028000100_finance_schema.sql`: schema privado, contas, categorias, idempotência e log.
2. `20261028000200_finance_ledger.sql`: transferências, lançamentos, faturas, itens, pagamentos e validações transacionais.
3. `20261028000300_finance_security.sql`: grants mínimos, RLS deny-by-default, `updated_at` e auditoria append-only.

## Decisões técnicas e regras de integridade

- **Saldo inicial:** a única fonte oficial é um lançamento `transactions` com `transaction_type = 'opening'`, `status = 'posted'`, `amount_cents` e `entry_sign`. O índice único permite no máximo um por conta. Não existe saldo inicial paralelo em `accounts`.
- **Valores:** valores são `bigint` em centavos, positivos, com `entry_sign` em `-1/+1`. TypeScript deve receber como string ou converter para `bigint`, calcular apenas com `bigint` e serializar como string. Nunca usar `number`, `parseFloat`, `toFixed` ou JSON com `bigint` nativo.
- **Transferências:** `transfer_operations` é a unidade idempotente. As pernas têm contas distintas, mesma quantia e sinais opostos; a saída deve ser exatamente `from_account_id` com `entry_sign = -1`, e a entrada exatamente `to_account_id` com `entry_sign = 1`. O trigger adiado verifica no commit duas pernas, contas corretas e soma líquida zero.
- **Estados de transferência:** `pending -> posted` e `pending -> cancelled` são as únicas transições. `posted` e `cancelled` são terminais. As pernas não podem ser postadas ou canceladas isoladamente; a aplicação deve atualizar operação e as duas pernas na mesma transação. Cancelamento exige duas pernas canceladas e nenhuma postada. Falha em qualquer validação desfaz o commit inteiro.
- **Idempotência:** `transfer_operations.idempotency_key` é única; lançamentos não-transferência têm chave única; repetições devem devolver a resposta persistida em `idempotency_keys` sem criar novos efeitos.
- **Faturas:** `card_invoice_items.total_cents` é gerado de principal, juros e tarifas. Triggers adiados validam o cabeçalho, inclusão/alteração/remoção de itens e inclusão/alteração/remoção de pagamentos. O total declarado deve igualar os itens; pagamentos não podem exceder o total. O cabeçalho é bloqueado com `FOR UPDATE`; o servidor deve adquirir esse lock antes de mutações concorrentes e usar uma transação apropriada, preferencialmente `SERIALIZABLE` quando houver escritores concorrentes.
- **Contabilidade:** compra no cartão é despesa na data da compra; encargos permanecem separados nos itens; pagamento de fatura é lançamento separado e não duplica despesa. Fluxo de caixa deriva dos lançamentos postados nas contas de caixa; resultado é receitas menos despesas; patrimônio é saldo inicial + resultado acumulado + ajustes. Transferências apenas deslocam saldo.
- **Estornos/correções:** lançamento postado não é apagado; `reversal` ou `adjustment` referencia `original_transaction_id`, usa chave idempotente própria e registra efeito compensatório.
- **`updated_at`:** trigger comum substitui o valor por `now()` em atualizações de contas, transferências, lançamentos e faturas. `event_log` não tem `updated_at` e permanece append-only.
- **Auditoria:** triggers inserem `event_log` na mesma transação das alterações financeiras. UPDATE/DELETE do histórico são rejeitados. O acesso direto pela Data API permanece bloqueado.
- **Segurança:** schema `finance` é revogado de `public`, `anon` e `authenticated`; não há policies permissivas nem endpoint público. `service_role` recebe grants server-side e continua segredo, pois contorna RLS. Não é inventada validação de cabeçalhos da Vercel.

## Arquivos preparados

- `20261028000100_finance_schema.sql`
- `20261028000200_finance_ledger.sql`
- `20261028000300_finance_security.sql`

## Testes ainda necessários em PostgreSQL isolado

1. Parse/lint com a versão PostgreSQL compatível; aplicar as três migrations somente em banco descartável autorizado.
2. Testar transferência pendente, postagem atômica, cancelamento atômico, rollback, tentativa de perna isolada, sinais, contas, quantias e status terminais.
3. Testar repetição de idempotency key, payload divergente, retry após falha e ausência de duplicidade.
4. Testar atualização direta de `card_invoices.total_cents`, inclusão/alteração/remoção de itens, encargos e pagamentos parciais concorrentes sob `FOR UPDATE`/`SERIALIZABLE`.
5. Testar `updated_at` e confirmar que `event_log` rejeita UPDATE/DELETE e registra eventos no mesmo commit.
6. Testar opening único e ausência de dupla contagem do saldo inicial.
7. Testar SELECT/INSERT/UPDATE/DELETE como `anon` e `authenticated`, grants efetivos e exposição da Data API.
8. Testar o contrato TypeScript que transporta `bigint` como string e rejeita `number`.

## Bloqueios preservados

Não houve execução SQL, conexão ou alteração remota, alteração de variáveis/configurações, criação de tabelas no banco, deployment ou publicação. A interface existente não foi alterada.
