# Etapa 2 — proposta de banco

## Escopo e identidade

Arquivos preparados apenas para revisão. Nenhum SQL foi executado e nenhuma migration foi aplicada. O único alvo declarado é `supabase-cyan-kite`, região `us-east-1`. A integração Supabase aparece como conectada, mas a consulta automática de schema falhou; portanto a identidade exata do Project Reference e as permissões efetivas continuam não comprovadas. Antes de executar, confirmar manualmente no painel que o Project Reference é o esperado e que a conexão da Vercel aponta para o mesmo hostname.

Não acessar `supabase-lime-house`.

## Ordem

1. `20261028000100_finance_schema.sql`: schema privado, contas, categorias, idempotência e log.
2. `20261028000200_finance_ledger.sql`: lançamentos, transferências, faturas, itens e pagamentos.
3. `20261028000300_finance_security.sql`: grants mínimos, default privileges e RLS deny-by-default.

## Decisões

- **Saldo inicial:** somente `finance.accounts.opening_balance_cents` + `opening_balance_as_of`. Não criar evento contábil de abertura que altere o saldo.
- **Centavos:** todos os valores monetários são `bigint`; no TypeScript devem ser recebidos como string ou convertidos para `bigint`, calculados apenas com `bigint`, e serializados como string. Não usar `number`, `parseFloat`, `toFixed` ou JSON com `bigint` nativo.
- **Compras no cartão:** a compra é uma despesa na data da compra; itens de fatura detalham principal/encargos. O pagamento parcial é um lançamento separado ligado à fatura. Encargos ficam separados de principal. O pagamento não duplica a despesa; altera caixa e obrigação.
- **Fluxo de caixa, resultado e patrimônio:** caixa é derivado de lançamentos `posted` nas contas de caixa; resultado é receitas menos despesas reconhecidas; patrimônio líquido é saldo inicial + resultado acumulado + ajustes. Transferências não alteram resultado; apenas movem caixa/obrigações. A implementação de relatórios fica fora desta etapa.
- **Estornos/correções:** nunca apagar lançamento postado; criar `reversal` ou `adjustment` ligado a `original_transaction_id`, com idempotência e evento auditável.
- **Acesso:** como não haverá Supabase Auth, `anon` e `authenticated` não recebem acesso. `service_role` fica exclusivamente no servidor e contorna RLS. Não há autorização baseada em cabeçalho arbitrário neste pacote.

## Verificações pendentes antes de execução

- Confirmar no Dashboard o Project Reference exato e compará-lo ao hostname configurado na aplicação, sem expor chaves.
- Confirmar versão PostgreSQL/Supabase, privilégios do executor, extensão disponível para `gen_random_uuid()` e política de exposição da Data API.
- Revisar se o schema `finance` será mantido fora dos schemas expostos.
- Definir e testar no servidor a autorização externa da Vercel antes de liberar qualquer rota mutável; a API direta do Supabase continuará bloqueada para clientes.
- Adicionar testes pgTAP para negar `anon`/`authenticated`, garantir idempotência, estornos, transferências balanceadas e ausência de dupla contagem do saldo inicial.
- Validar atomicamente totais de fatura e pagamentos parciais; os checks de soma exigem trigger/procedure transacional ou camada de serviço, ainda não incluídos.
- Revisar limites de `bigint` e o contrato JSON da API TypeScript.

## Bloqueios preservados

Nenhuma alteração de interface, variável, configuração remota, deployment, publicação, SQL remoto ou consulta financeira foi realizada.
