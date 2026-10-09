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

### 7. Permissões por ação

Além das telas (`permissoes`), cada usuário tem `acoes`: o que pode fazer dentro delas
(cancelar venda, sangria, desconto alto, alterar preço, ajustar estoque, excluir registros).
`null` usa o padrão do papel, uma lista vale como está, e ADMIN sempre pode tudo. A fonte é
`server/src/config/acoes.ts`; as rotas usam `requerirAcao('...')` e o front esconde o botão
(`src/utils/acoes.ts`), mas quem decide é sempre o servidor.

### 8. Balcão (fase C)

- **Pagamento dividido:** uma venda tem várias formas (`PagamentoVenda`). Crédito em até 3x é sem
  juros; de 4x a 12x o servidor soma 5% sobre a parte paga no crédito (`server/src/config/pdv.ts`).
  O front só mostra o valor, quem calcula é o servidor.
- **Cancelar venda:** nada é apagado. A venda ganha `cancelada`, motivo e autor, o estoque volta
  e ela sai de todos os relatórios (`VENDA_VALIDA` em `server/src/lib/vendas.ts`).
- **Sangria e suprimento:** `MovimentoCaixa`, entram no valor esperado do fechamento.
- **Venda em espera:** guardada no navegador (por loja e caixa), não no servidor.
- **Código de barras:** campo `codigoBarras` no produto; no PDV, digitar/ler e dar Enter adiciona.

### 9. Operação (fase D)

- **Logs e Sentry:** `server/src/lib/observabilidade.ts`. Cada requisição recebe `X-Request-Id`
  (vem também no corpo dos erros 500). Defina `SENTRY_DSN` para enviar erros; sem ele nada sai.
- **Sessões:** `GET/DELETE /api/auth/sessoes` (tela Minha conta).
- **Receita:** `GET /api/admin/receita` (MRR, churn, conversão do teste), no topo do painel admin.
- **Transferência de estoque** entre lojas da empresa: `POST /api/estoque/transferir` (Enterprise).
- O que ficou só preparado (cookie httpOnly, CSP, offline, captcha...) está em `docs/FASE_D.md`.

### 10. PDV offline

- **O que funciona sem internet:** abrir o app (service worker `public/sw.js` + última sessão confirmada), buscar produto por nome, SKU ou código de barras (catálogo guardado no aparelho, IndexedDB), escolher cliente e vendedor, vender e imprimir o comprovante. As vendas vão para uma fila no aparelho (`src/lib/offline.ts`) e são enviadas sozinhas quando a internet volta, na ordem em que aconteceram, com o horário real da venda.
- **O que precisa de internet:** abrir e fechar caixa, sangria, suprimento, cancelar venda. Fechar o caixa também espera a fila esvaziar.
- **Sem duplicar:** cada venda tem um `idLocal` e o servidor devolve a venda existente se receber o mesmo id de novo (`Transacao.idLocal`, único por loja).
- **Estoque divergente:** se na hora do envio o saldo já não cobre a venda (outra loja ou aparelho vendeu antes), a venda é registrada mesmo assim, o estoque vai a zero (nunca negativo), e o aviso aparece na tela e na auditoria. A mercadoria já saiu do balcão, então recusar a venda só desorganizaria o caixa.
- **Vendas recusadas:** se o servidor recusa (ex.: caixa já fechado por outro aparelho), a venda fica parada num aviso vermelho no PDV com "Tentar de novo" e "Descartar". Nada some sozinho.
- **Só funciona no build de produção** (`npm run build && npm run preview`); em `npm run dev` o service worker fica desligado.
- **Roteiro de teste:** build, `preview`, entre, abra o caixa e a tela do PDV (uma vez com internet); no DevTools, aba Network, marque "Offline"; recarregue (deve abrir), venda 2 itens (aparece "venda guardada"), desmarque "Offline" (deve enviar sozinho em segundos) e confira a venda nos relatórios.

### 11. Cadastro: e-mail confirmado e captcha

- O cadastro self-service **não entra direto**: cria a conta com `emailPendente` e manda um link (vale 24 h, uso único, guardado só como hash). O login responde `EMAIL_NAO_VERIFICADO` (só depois de acertar a senha, para não revelar que a conta existe) e a tela oferece o reenvio (1 por minuto).
- Usuários criados por um gestor, por convite ou pelo admin já nascem confirmados.
- Cadastro que **nunca confirma** é apagado depois de 7 dias (faxina que roda a cada 6 h). Isso libera o CNPJ e o e-mail e impede que alguém "reserve" o CNPJ de terceiros.
- **Captcha:** Cloudflare Turnstile no cadastro. Com `TURNSTILE_SECRET_KEY` definida o servidor exige e confere o token na Cloudflare (se ela estiver fora do ar, recusa com 503 em vez de deixar passar). Sem a variável o captcha fica desligado. Chaves de teste que sempre passam estão no `server/.env.example`.
