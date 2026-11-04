<div align="center">
  <img src="public/brand-logo.png" alt="Logo Meu Financeiro" width="520" />
  <h1>Meu Financeiro</h1>
  <p>Aplicação web de gestão financeira pessoal para acompanhar receitas, despesas, pagamentos, contas e cartões de crédito.</p>
</div>

<p align="center">
  <a href="#sobre-o-projeto">Sobre</a> ·
  <a href="#funcionalidades">Funcionalidades</a> ·
  <a href="#arquitetura-e-segurança">Arquitetura</a> ·
  <a href="#tecnologias">Tecnologias</a> ·
  <a href="#instalação-e-execução">Instalação</a> ·
  <a href="#roadmap">Roadmap</a>
</p>

## Sobre o projeto

O **Meu Financeiro** é uma aplicação de gestão financeira pessoal criada para organizar a vida financeira em um único lugar. A plataforma separa o planejamento das movimentações efetivadas e permite acompanhar quanto entra, quanto sai, quais despesas ainda estão pendentes e como os lançamentos impactam as contas.

O projeto combina uma interface responsiva com regras de negócio executadas no servidor, persistência no Supabase e operações financeiras protegidas por transações, integridade referencial e idempotência.

## Funcionalidades

### Dashboard

- Visão consolidada do saldo das contas.
- Receitas do mês.
- Despesas do mês.
- Resultado mensal.
- Fluxo de caixa.
- Movimentações recentes.
- Navegação entre os módulos financeiros.

### Receitas e movimentações

- Cadastro de receitas, despesas e outros lançamentos.
- Associação com conta e categoria.
- Registro de valor, data, descrição e status.
- Histórico de movimentações persistidas.
- Atualização das movimentações por operações server-side.
- Valores tratados internamente em centavos inteiros.

### Despesas pendentes e pagas

- Cadastro de despesa pendente sem exigir uma conta bancária no momento do cadastro.
- Descrição, categoria, valor, vencimento e observações.
- Filtros por todas, pendentes e pagas.
- Edição de despesas pendentes.
- Edição de descrição, categoria, valor e data de pagamento em despesas pagas.
- Exclusão de despesas pendentes.
- Seleção da conta bancária somente no momento do pagamento.
- Registro da data efetiva do pagamento.
- Atualização do saldo por meio de uma movimentação financeira real.
- Estorno seguro para despesas pagas: o lançamento original é preservado e uma movimentação de estorno é criada.
- Proteção contra pagamento ou estorno duplicado.

### Contas e categorias

- Cadastro e gerenciamento de contas financeiras.
- Contas correntes, carteiras e contas de cartão de crédito.
- Categorias para receitas e despesas.
- Categorias com tipo de receita, despesa ou ambos.
- Controle de registros ativos e inativos.

### Cartões de crédito

- Cadastro de cartão associado a uma conta de crédito.
- Bandeira, limite, dia de fechamento e dia de vencimento.
- Cálculo de limite utilizado e disponível.
- Cadastro de compras associadas a faturas.
- Compras parceladas.
- Acompanhamento de faturas, valores pagos e valores em aberto.
- Exclusão protegida de cartões com validação de vínculos existentes.
- Importação histórica de dados de cartão quando o módulo e o schema correspondente estão disponíveis.

### Faturas

- Visualização de faturas por período e vencimento.
- Registro de compras em faturas abertas.
- Registro de parcelas.
- Registro de pagamentos de faturas a partir de transações de crédito publicadas.
- Ajustes e reconciliação de valores.
- Importação de fatura em PDF.
- Importação de pagamentos históricos.
- Proteção contra duplicidade em compras, parcelas e pagamentos.
- Exclusão restrita a faturas abertas sem vínculos que comprometam o histórico.

### Planejamento e recorrências

- Criação de receitas e despesas previstas.
- Filtro por mês, tipo e situação.
- Indicadores de receitas previstas, despesas previstas, pendências e valores realizados.
- Categorias e frequência mensal.
- Edição e cancelamento de previsões ainda não realizadas.
- Confirmação de uma previsão para transformá-la em movimentação persistida.
- Previsões não alteram o saldo antes da confirmação.

> As previsões exibidas no módulo de planejamento são rascunhos do fluxo de planejamento até sua efetivação. O saldo financeiro considera apenas movimentações publicadas.

### Dívidas, investimentos e objetivos

O projeto contém módulos dedicados para recursos financeiros adicionais, com ativação condicionada à disponibilidade das tabelas correspondentes no Supabase:

- Cadastro de dívidas, credor, valor original e vencimento.
- Registro de pagamentos parciais de dívidas.
- Consulta do histórico de pagamentos de uma dívida.
- Cadastro de investimentos, tipo, instituição e valor aplicado.
- Registro de aportes e resgates com validação do saldo disponível.
- Cadastro de objetivos financeiros e valor-alvo.
- Registro de contribuições para objetivos.
- Indicadores de progresso calculados a partir dos valores persistidos.

Quando o schema de um módulo não está instalado no ambiente, a interface informa que o recurso aguarda ativação e não tenta criar dados fictícios.

### Relatórios

- Indicadores de receitas do mês.
- Indicadores de despesas do mês.
- Resultado financeiro mensal.
- Quantidade de movimentações publicadas no período.
- Saldo atual de dívidas.
- Cálculos baseados nos lançamentos persistidos.

### Configurações e acesso

- Tela de configurações com indicação do estado de proteção dos dados.
- Login por usuário e senha.
- Sessão gerenciada pelo Supabase Auth.
- Proteção de rotas e acesso aos dados autenticados.
- Mensagens genéricas para falhas de autenticação, evitando expor detalhes sensíveis.

## Arquitetura e segurança

### Autenticação e propriedade dos dados

- Autenticação baseada em Supabase Auth.
- Sessão integrada ao App Router e aos cookies server-side.
- Rotas financeiras protegidas por autenticação.
- Registros associados ao usuário autenticado.
- Row Level Security (RLS) aplicada às tabelas financeiras.
- Consultas, atualizações e exclusões limitadas ao proprietário dos dados.

### Integridade financeira

- Operações críticas executadas por RPCs PostgreSQL.
- Pagamentos, edições e estornos realizados de forma atômica.
- Foreign keys entre movimentações, contas, categorias, faturas e registros de idempotência.
- Valores monetários tratados em centavos inteiros para evitar problemas de ponto flutuante.
- Despesas pendentes separadas de pagamentos efetivados.
- Exclusão de despesa paga feita por estorno, sem apagar a movimentação histórica original.
- Validação de contas ativas e pertencentes ao usuário antes de efetivar pagamentos.
- Controle de idempotência com hash da requisição para impedir repetição de operações financeiras.
- Chaves de operação reservadas antes da criação da movimentação relacionada.
- Histórico preservado em operações que alteram o estado financeiro.

## Tecnologias

As tecnologias abaixo foram confirmadas no manifesto e na estrutura do projeto:

| Tecnologia | Uso |
| --- | --- |
| Next.js 16 | Framework web e App Router |
| React 19 | Construção da interface e componentes client-side |
| TypeScript | Tipagem do código da aplicação |
| Supabase | Autenticação, banco de dados e acesso seguro aos dados |
| PostgreSQL | Persistência, constraints, RLS e RPCs financeiras |
| `@supabase/ssr` | Integração do Supabase com sessões server-side |
| `@supabase/supabase-js` | Cliente de acesso ao Supabase |
| Tailwind CSS 4 | Base de estilos utilitários e integração visual |
| Lucide React | Ícones da interface |
| SWR | Dependência disponível para cache e sincronização de dados |
| Zod | Dependência disponível para validação de dados |
| Vercel Analytics | Analytics em produção |
| pnpm | Gerenciamento de dependências |

A interface também utiliza componentes próprios e utilitários de `class-variance-authority`, `clsx`, `tailwind-merge` e `tw-animate-css`.

## Estrutura do projeto

```text
.
├── app/
│   ├── api/
│   │   ├── auth/login/       # Endpoint de autenticação
│   │   └── finance/          # API dos módulos financeiros
│   ├── auth/                 # Login e callback de autenticação
│   ├── globals.css           # Estilos globais e responsividade
│   ├── layout.tsx            # Layout e metadados da aplicação
│   └── page.tsx              # Entrada da aplicação
├── components/
│   ├── finance-dashboard.tsx # Dashboard e navegação principal
│   ├── finance-modules.tsx   # Dívidas, investimentos, objetivos e relatórios
│   ├── cards-and-invoices.tsx# Cartões, compras e faturas
│   ├── payables-manager.tsx  # Despesas pendentes, pagas e estornos
│   ├── recurring-plans.tsx   # Planejamento e recorrências
│   ├── invoice-pdf-import.tsx# Importação de faturas PDF
│   ├── historical-import-form.tsx
│   └── ui/                   # Componentes de interface reutilizáveis
├── lib/
│   ├── finance/              # Domínio, validações e repositories financeiros
│   └── supabase/             # Clientes server, browser e proxy de sessão
├── public/
│   └── brand-logo.png        # Logo oficial do Meu Financeiro
├── scripts/                  # Scripts de validação e testes de domínio
├── supabase/
│   ├── migrations/           # Schema, RPCs, RLS e evoluções do banco
│   └── tests/                # Testes SQL de compatibilidade
├── data/                     # Arquivo de dados utilizado pelo projeto
├── middleware.ts             # Proteção e atualização da sessão
├── next.config.mjs           # Configuração do Next.js
├── package.json              # Scripts e dependências
└── pnpm-lock.yaml            # Lockfile do pnpm
```

## Instalação e execução

### Pré-requisitos

- Node.js compatível com o Next.js 16.
- pnpm 12.3.4 ou versão compatível.
- Um projeto Supabase configurado.
- Usuário criado no Supabase Auth para realizar o login.

### Clonar o repositório

```bash
git clone https://github.com/josechagas3/Gerenciador-Financeiro.git
cd Gerenciador-Financeiro
```

### Instalar dependências

```bash
pnpm install
```

### Configurar variáveis de ambiente

Crie um arquivo `.env.local` na raiz do projeto. Nunca versione valores reais, senhas ou chaves privadas.

```env
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-chave-anon-ou-publishable
AUTH_USERNAME=seu-usuario-de-login
AUTH_LOGIN_EMAIL=seu-email-de-login
```

O projeto utiliza diretamente as seguintes variáveis:

| Variável | Finalidade |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | URL pública do projeto Supabase |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Chave pública utilizada pelo cliente e pelo servidor |
| `AUTH_USERNAME` | Nome de usuário aceito pela tela de login |
| `AUTH_LOGIN_EMAIL` | E-mail do usuário autenticado pelo Supabase |

O `AUTH_USERNAME` é usado como identificador de entrada da interface, enquanto a autenticação de senha é realizada pelo e-mail configurado em `AUTH_LOGIN_EMAIL` no Supabase Auth.

### Configurar o banco

A pasta `supabase/migrations` contém as evoluções do schema financeiro, incluindo tabelas, foreign keys, RLS, RPCs, idempotência, cartões, faturas, recorrências, despesas pendentes, estornos e módulos adicionais.

Aplique as migrations em ordem no projeto Supabase antes de utilizar os módulos correspondentes. O ambiente deve possuir um usuário no Supabase Auth para que as políticas RLS e as operações financeiras possam ser testadas corretamente.

As migrations mais recentes adicionam:

- Despesas pendentes e pagamentos atômicos.
- Reserva de operação antes da transaction de pagamento.
- Edição de despesas pendentes e pagas.
- Estorno seguro de despesas pagas.

### Executar em desenvolvimento

```bash
pnpm dev
```

Abra `http://localhost:3000` no navegador.

### Gerar build de produção

```bash
pnpm build
pnpm start
```

## Validação local

O projeto possui scripts e verificações relacionadas ao domínio financeiro:

```bash
pnpm exec tsc --noEmit
pnpm build
pnpm exec node scripts/test-transaction-idempotency.mjs
```

Também existem scripts específicos para o domínio de compras parceladas e recorrências. Consulte a pasta `scripts/` antes de executar cada arquivo para verificar seus pré-requisitos.

## Roadmap

### Implementado

- Autenticação e proteção de rotas.
- Dashboard financeiro.
- Contas, categorias e movimentações.
- Receitas e despesas.
- Despesas pendentes e pagamentos efetivados.
- Edição, exclusão e estorno seguro de despesas.
- Idempotência e operações financeiras atômicas.
- Cartões, compras parceladas e faturas.
- Importação de faturas em PDF e dados históricos.
- Planejamento mensal e previsões.
- Dívidas, investimentos e objetivos com ativação por schema.
- Relatórios financeiros básicos.
- Interface responsiva e identidade visual própria.

### Melhorias futuras sugeridas

- Adicionar testes automatizados de interface para os fluxos de pagamento, edição e estorno.
- Expandir os relatórios com gráficos históricos e comparativos por categoria.
- Permitir seleção explícita da conta ao efetivar previsões.
- Persistir previsões recorrentes diretamente no banco, caso o módulo de planejamento evolua para um fluxo multiusuário completo.
- Adicionar exportação de dados financeiros em formatos como CSV e PDF.
- Incluir preferências de usuário na tela de configurações.
- Adicionar screenshots reais da aplicação ao README.

## Screenshots

Ainda não há screenshots versionadas no repositório. Esta seção está reservada para imagens reais da aplicação, como:

- Dashboard principal.
- Gestão de despesas pendentes e pagas.
- Cartões e faturas.
- Relatórios financeiros.

## Licença

Este repositório não declara uma licença de código aberto no momento. Consulte o proprietário do projeto antes de reutilizar ou redistribuir o código.

## Autor

Desenvolvido por **Jose Chagas**.

- GitHub: [@josechagas3](https://github.com/josechagas3)
- Repositório: [Gerenciador-Financeiro](https://github.com/josechagas3/Gerenciador-Financeiro)
