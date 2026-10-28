# Etapa 2 — proposta documental de banco

## Escopo e identidade

Estes arquivos são uma proposta local para revisão. Nenhum SQL foi executado, nenhuma migration foi aplicada e nenhum recurso remoto foi modificado. O único alvo autorizado é `supabase-cyan-kite`, região `us-east-1`; `supabase-lime-house` não foi acessado.

A identidade efetiva do banco e as permissões ainda precisam ser verificadas antes de qualquer execução: confirmar no Dashboard o Project Reference e comparar o hostname configurado na aplicação, sem expor chaves. A integração disponível não deve ser tratada como prova de identidade quando os metadados do schema permanecem indisponíveis.

## Ordem de dependência

1. `20261028000100_finance_schema.sql`: schema privado, contas, categorias, idempotência e log.
2. `20261028000200_finance_ledger.sql`: operações de transferência, lançamentos, faturas, itens e pagamentos, incluindo triggers de integridade.
3. `20261028000300_finance_security.sql`: grants mínimos, RLS deny-by-default e auditoria append-only.

## Decisões técnicas

- **Saldo inicial:** a única fonte oficial é um lançamento `transactions` com `transaction_type = 'opening'`, `status = 'posted'`, `amount_cents` e `entry_sign`. Há no máximo um por conta. Não existe saldo inicial paralelo em `accounts`.
- **Valores:** valores são `bigint` em centavos, positivos, com `entry_sign` em `-1/+1`. TypeScript deve receber como string ou converter para `bigint`, calcular apenas com `bigint` e serializar como string. Nunca usar `number`, `parseFloat`, `toFixed` ou JSON com `bigint` nativo.
- **Transferências:** `transfer_operations` é a operação idempotente; suas duas pernas usam a mesma chave de operação, contas distintas, mesma quantia e sinais opostos. Índices e constraint trigger adiado verificam exatamente duas pernas postadas e soma assinada zero no commit. A criação das pernas e a mudança para `posted` devem ocorrer na mesma transação.
- **Faturas:** `card_invoice_items.total_cents` é gerado a partir de principal, juros e tarifas. Trigger adiado bloqueia total divergente e pagamentos acima do total devido, usando lock da fatura para serializar pagamentos e alterações de encargos.
- **Contabilidade:** compra no cartão é uma despesa na data da compra; encargos permanecem separados nos itens; pagamento de fatura é lançamento separado e não duplica despesa. Fluxo de caixa deriva dos lançamentos postados nas contas de caixa; resultado é receitas menos despesas; patrimônio é saldo inicial + resultado acumulado + ajustes. Transferências apenas deslocam saldo. `entry_sign` permite saldos negativos quando o tipo de conta permitir.
- **Estornos/correções:** lançamento postado não é apagado; `reversal` ou `adjustment` referencia `original_transaction_id`, usa chave idempotente própria e registra efeito compensatório.
- **Auditoria:** triggers inserem `event_log` no mesmo commit das operações confirmadas. `event_log` é append-only: UPDATE/DELETE são rejeitados. O acesso direto ao histórico pela API deve permanecer bloqueado.
- **Segurança:** schema `finance` é revogado de `public`, `anon` e `authenticated`; não há policies permissivas nem endpoint público. `service_role` recebe grants apenas para uso server-side e continua sendo segredo, pois contorna RLS. A proposta não inventa validação de headers da Vercel.

## Testes propostos

### Sem conexão com banco

- Revisão estática de ordem, FKs, checks, índices, grants e ausência de `opening_balance_*`.
- Lint/parse SQL com uma versão PostgreSQL compatível, sem aplicar migrations.
- Testes TypeScript do contrato `bigint`/string e rejeição de `number`.

### Em ambiente isolado, após autorização

- Duas transações concorrentes para a mesma transferência: uma operação, duas pernas, sem soma líquida.
- Repetição da mesma idempotency key e chaves diferentes com o mesmo payload.
- Pagamentos parciais concorrentes e atualização simultânea de juros/tarifas; nunca exceder o devido.
- Estorno repetido, correção encadeada e preservação do original.
- Abertura única e ausência de dupla contagem no saldo.
- Tentativas anon/authenticated de SELECT/INSERT/UPDATE/DELETE negadas.
- Auditoria criada no mesmo commit e falha integral da transação quando a auditoria falhar.

## Riscos e verificações pendentes

- A execução depende de confirmar versão PostgreSQL, `gen_random_uuid()`, privilégios do executor e exposição da Data API.
- O `service_role` é deliberadamente amplo para o servidor; não deve ser usado no navegador nem em rotas sem autorização externa já validada.
- Views públicas, se necessárias no futuro, devem ser criadas separadamente com `security_invoker`, grants explícitos e dados não sensíveis.
- A aplicação server-side precisa implementar a transação completa de cada operação; as migrations não criam login próprio nem presumem uma autorização Vercel inexistente.

## Bloqueios preservados

Não houve execução SQL, conexão ou alteração remota, alteração de variáveis/configurações, criação de tabelas no banco, deployment ou publicação. A interface existente não foi alterada.
