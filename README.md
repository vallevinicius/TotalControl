# Total Control | Controle de Estoque e Vendas

SaaS multi-tenant de PDV (Ponto de Venda) e controle de estoque, construído
em **React + TypeScript + Vite + TailwindCSS** no frontend e
**Express + Prisma + MySQL** no backend.

---

## Como rodar

Pré-requisitos: Node.js 18+ e um servidor MySQL acessível.

### 1. Configurar o banco de dados

Edite `server/.env` com a string de conexão do seu MySQL:

```
DATABASE_URL="mysql://usuario:senha@localhost:3306/nome_do_banco"
JWT_SECRET="troque-por-um-valor-aleatorio-longo"
PORT=4000

# Login do painel interno da Total Software em /admin (separado do login
# das lojas). Troque esses valores e reinicie a API para criar/atualizar
# essa conta.
ADMIN_EMAIL="admin@totalsoftware.com"
ADMIN_SENHA="troque-por-uma-senha-forte"
```

Depois, dentro de `server/`:

```bash
cd server
npm install
npx prisma migrate deploy             # cria as tabelas no banco
npx prisma db seed                   # cria uma loja + usuário de teste
```

O seed cria uma empresa de demonstração (plano Pro) com um administrador. A senha
**não é fixa**: sai aleatória e aparece uma única vez no terminal (para escolher,
use `SEED_EMAIL` e `SEED_SENHA`). Ele se recusa a rodar com `NODE_ENV=production`.
Você também pode criar uma loja nova pela tela de registro do app.

### 1.1. Painel interno da Total Software

Entre pela mesma tela de login do app (`/login`) com o `ADMIN_EMAIL`/`ADMIN_SENHA`
definidos no `server/.env`: quem não é usuário de nenhuma loja cai direto em
`/admin`. Esse login é de uso exclusivo da equipe da Total Software e reúne, em
um só painel (o antigo site de administração do Total Control foi descontinuado):

- indicadores gerais (empresas, lojas, usuários, testes grátis, vendas e faturamento do mês);
- lista de empresas com busca e filtros por situação e plano;
- por empresa: trocar o plano, suspender/reativar e excluir (com confirmação digitada);
- por loja: dados cadastrais completos (razão social, inscrições, regime, contato, endereço), indicadores de uso, desativar/reativar e excluir (LGPD);
- por usuário: ativar/desativar e resetar a senha (gera uma senha temporária);
- criar uma nova empresa já com todos os dados cadastrais.

Não há link para essa tela em nenhum menu do app de loja: o acesso é só pelo login.

### 1.2. Assinaturas e pagamento (Mercado Pago)

A tela **Meu plano** deixa a conta principal assinar (Starter ou Pro), fazer
upgrade, mudar de plano e cancelar. A cobrança é uma assinatura recorrente
mensal no Mercado Pago (`server/src/lib/mercadopago.ts`, rotas em
`server/src/routes/assinatura.routes.ts`). O Enterprise é combinado com a equipe.

Configure no `server/.env` (veja `server/.env.example`):

- `MERCADOPAGO_ACCESS_TOKEN`: token da aplicação no painel de desenvolvedores;
- `APP_URL`: endereço do site (pra onde o Mercado Pago devolve a pessoa);
- `API_PUBLIC_URL`: endereço público da API, usado no aviso automático
  (`POST /api/assinatura/webhook`). Local pode ficar vazio: ao voltar do
  checkout a tela consulta o Mercado Pago diretamente.

Regras: o plano só muda quando o Mercado Pago autoriza o pagamento; ao trocar de
plano a assinatura anterior é cancelada; cancelar mantém o acesso até o fim do
período já pago (`Empresa.acessoAte`). Com o teste grátis ou a assinatura
vencidos, o login funciona mas só a tela do plano abre (a API responde 402
`ACESSO_EXPIRADO` nas demais rotas).

### 1.3. Segurança e operação

- **Permissões no servidor**: cada rota confere a tela liberada ao usuário
  (`server/src/middleware/permissao.ts`), não só o menu. Papel e permissões são
  lidos do banco a cada requisição, então mudanças valem na hora.
- **PDV**: desconto máximo e troca de preço por papel (`POLITICA_PDV` em
  `server/src/config/planos.ts`): operador 5% e sem alterar preço, gerente 20%,
  admin livre. Ajustes ficam na auditoria (`venda.ajuste`). A baixa de estoque é
  condicional, então vendas simultâneas não deixam o saldo negativo.
- **Sessão**: o token de acesso dura 30 min (`ACCESS_TOKEN_TTL`) e é renovado em
  silêncio com um token de renovação de 30 dias, guardado só como hash e trocado a
  cada uso. Reusar um token de renovação já usado derruba todas as sessões da
  pessoa. Redefinir a senha também derruba as sessões (`Usuario.tokenVersion`).
- **Senhas**: 8+ caracteres com letra e número (cadastro, novo usuário, nova empresa).
  O aceite dos Termos é exigido e gravado com data e versão (`Usuario.aceiteTermos*`).
- **Admin da plataforma**: sessão de 2 h e verificação em duas etapas (TOTP) em
  *Segurança*, no painel `/admin`. Desligar exige senha e código.
- **Limites e proteção HTTP**: limite de tentativas no login, cadastro, código 2FA e
  webhook; CORS só para `APP_URL`/`CORS_ORIGINS`; `helmet`. Atrás de proxy, defina
  `TRUST_PROXY`.
- **Monitoramento**: `GET /api/health` (vivo) e `GET /api/health/ready` (vivo + banco
  respondendo) para um monitor de disponibilidade.
- **Backup**: `server/scripts/backup-mysql.sh [destino] [dias]` faz `mysqldump`
  compactado com rotação. Agende no cron e guarde uma cópia fora do servidor.

**Restaurar** (teste isto ao menos uma vez, backup sem restauração testada não conta):

```bash
gunzip -c totalcontrol_db_AAAAMMDD_HHMMSS.sql.gz | mysql -u USUARIO -p NOME_DO_BANCO
```

### 1.4. O que o dono da loja encontra no sistema

- **Empresa**: editar os dados cadastrais (qualquer plano), exportar tudo em JSON e excluir a conta (LGPD), e ligar ou desligar os avisos por e-mail.
- **Estoque**: editar produto, ajuste de inventário com motivo, histórico de movimentações por produto, categorias (criar, renomear, excluir), produtos excluídos (reativar), exportar produtos e importar clientes em CSV.
- **Financeiro**: contas a pagar e a receber (com parcelas mensais e baixa) e o resultado do período (DRE simplificada, com custo estimado pelo preço de custo atual).
- **Relatórios e dashboard**: gráfico de vendas por dia, curva ABC, estoque parado e impressão em PDF.
- **Equipe**: convite por e-mail (a pessoa cria a própria senha) e redefinição de senha pelo administrador.
- **Plano**: histórico de cobranças do Mercado Pago e aviso na tela quando o pagamento falha ou o teste acaba.
- **Avisos por e-mail** (precisam do SMTP configurado): teste grátis acabando ou acabado, assinatura cancelada chegando ao fim, pagamento recusado, resumo semanal de estoque baixo e contas atrasadas ou vencendo. O servidor verifica de hora em hora entre 8h e 20h, e cada aviso sai uma vez só.

### 2. Rodar o frontend + backend juntos

Na raiz do projeto:

```bash
npm install
npm run dev:full
```

Isso sobe o frontend em **http://localhost:3099** e a API em
**http://localhost:4000**. Se preferir rodar cada parte em um terminal
separado: `npm run dev` (frontend) e `npm --prefix server run dev` (API).

```bash
npm run build     # build de produção do frontend (roda o type-check do TS antes)
npm run preview   # serve o build de produção localmente
```

> Antes de subir/commitar qualquer alteração, faça login, cadastre um
> produto, dê entrada de estoque e finalize uma venda no PDV (com desconto)
> para garantir que o fluxo ponta a ponta continua funcionando.

---

## Arquitetura

```
src/
  types/                  Modelos de dados (Tenant, Produto, Transacao...)
  services/
    apiService.ts           Cliente HTTP da API real (fetch + JWT)
  contexts/
    TenantContext.tsx      Sessão ativa (tenant + usuário) resolvida via JWT
  utils/
    formatters.ts          Formatação de moeda/data sensível ao tenant
  components/
    Auth/                    Login e registro de loja
    Layout/                  Sidebar, Header, AppLayout
    PDV/                     Frente de Caixa
    Estoque/                 Gestão de Estoque
    Clientes/                Cadastro de clientes
    Relatorios/              Relatórios de vendas por período
    Financeiro/              Fluxo de caixa e lançamentos avulsos
    Admin/                   Painel interno da Total Software (/admin)
    Dashboard/               Visão Geral
    Common/                  Componentes visuais reutilizáveis
  App.tsx                  Rotas (com guard de autenticação de loja e de admin)
  main.tsx                 Bootstrap da aplicação

server/
  prisma/schema.prisma     Modelo de dados (MySQL)
  src/routes/               Endpoints da API (auth, produtos, categorias,
                             clientes, vendas, estoque, dashboard, relatórios,
                             financeiro, admin)
  src/middleware/auth.ts    JWT: assina e valida o token de sessão de loja e
                             o token do painel admin (tipo PLATAFORMA)
  src/lib/adminBootstrap.ts Cria/atualiza a conta de admin a partir do .env
```

### 1. Multi-tenancy

Nenhum dado visual da loja (nome, logo, cor do tema, CNPJ, fuso horário) está
hardcoded em componente algum. Tudo vem do `TenantContext`
(`src/contexts/TenantContext.tsx`), que resolve a sessão ativa a partir do
JWT retornado no login/registro e expõe `useTenant()` para qualquer
componente consumir `tenant`, `usuarioAtual`, `login`, `registrar` e
`logout`.

### 2. Isolamento de dados

Toda rota da API (`server/src/routes/*.ts`) exige autenticação
(`requireAuth`) e filtra qualquer consulta pelo `tenantId` extraído do JWT —
nenhuma tela do frontend nunca vê dados de outra loja.

### 3. Segmento agnóstico

Não existem tabelas fixas de "Tamanho" ou "Placa". A entidade `Categoria` é
criada dinamicamente pelo tenant e pode carregar `atributosCustomizados`
livres (chave + tipo), atribuídos por produto.

### 4. Transações — a espinha dorsal

Toda entrada (`ENTRADA`) e saída (`SAIDA`) de estoque é registrada como uma
`Transacao`, com `timestamp` exato, itens com snapshot de preço praticado,
forma de pagamento, desconto e usuário responsável. É a partir dela que o
Dashboard e os Relatórios calculam faturamento, ticket médio e produtos mais
vendidos.

### 5. Financeiro

A tela Financeiro combina a receita de vendas e o custo de entradas de
estoque (já existentes como `Transacao`) com lançamentos manuais de
receita/despesa avulsa (`LancamentoFinanceiro` — aluguel, salário etc.),
calculando o saldo do período.

### 6. Painel admin — uma segunda identidade, de propósito

O admin da Total Software não é um `Usuario` de loja — ele é modelado como
`AdminPlataforma`, uma entidade própria sem `tenantId`, com login e JWT
próprios (`tipo: 'PLATAFORMA'`). O middleware `requireAuth` (rotas de loja) e
`requirePlatformAdmin` (rotas `/api/admin`) se rejeitam mutuamente, então um
token de loja nunca funciona no painel admin e vice-versa.
