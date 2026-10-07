# Colocando o Total Control no ar: checklist

Marque cada item antes de abrir para clientes. O que depende de uma decisão sua está indicado.

## 1. Servidor da API (`server/`)

1. **Banco MySQL 8** com usuário próprio (sem poderes de administrador do servidor) e conexão por rede privada ou TLS.
2. **Variáveis** (`server/.env`, veja `server/.env.example`):

   | Variável | O que é |
   |---|---|
   | `DATABASE_URL` | conexão com o MySQL |
   | `JWT_SECRET` | segredo longo e aleatório (`openssl rand -hex 48`). Trocar derruba todas as sessões |
   | `NODE_ENV=production` | também bloqueia o seed de demonstração |
   | `APP_URL` | endereço público do site (ex: `https://app.seudominio.com.br`): CORS, links de e-mail e retorno do pagamento |
   | `CORS_ORIGINS` | outros sites autorizados a chamar a API (opcional) |
   | `TRUST_PROXY` | `1` se houver proxy/balanceador na frente (senão o limite de tentativas vale para o proxy todo) |
   | `API_PUBLIC_URL` | endereço público da API: o Mercado Pago avisa pagamentos em `.../api/assinatura/webhook` |
   | `MERCADOPAGO_ACCESS_TOKEN` | token da aplicação (use o de **produção** só depois do teste no sandbox) |
   | `MERCADOPAGO_WEBHOOK_SECRET` | chave secreta do webhook, para recusar notificações sem assinatura |
   | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM` | e-mail (recuperação de senha). Qualquer provedor SMTP serve. **Decisão sua: qual provedor** |
   | `ADMIN_EMAIL`, `ADMIN_SENHA` | login do painel `/admin` (criado ou atualizado a cada subida) |

3. **Subir**: `npm ci`, `npx prisma migrate deploy`, `npx prisma generate`, `npm run build`, `npm start`. Use um gerenciador de processo (systemd, pm2 ou contêiner) para reiniciar sozinho.
4. **HTTPS** obrigatório, terminado no proxy (o `helmet` já envia HSTS).

## 2. Site (raiz)

1. `VITE_SITE_URL` com o endereço público (canonical, imagem de compartilhamento e dados estruturados).
2. `npm ci && npm run build`; sirva a pasta `dist/` com fallback para `index.html` (o site usa rotas no navegador, ex: `/login`).
3. Se o site e a API ficarem em endereços diferentes, defina `VITE_API_URL` com o endereço da API e libere o site em `CORS_ORIGINS`.
4. Preencha `src/config/empresa.ts` (razão social, CNPJ, e-mails de contato e do encarregado de dados). O build avisa enquanto estiver em branco. **Os textos precisam de revisão jurídica.**

## 3. Mercado Pago

1. Crie a aplicação e teste **no ambiente de testes**: assinar, receber o aviso, trocar de plano, cancelar.
2. Cadastre o webhook em `API_PUBLIC_URL/api/assinatura/webhook` (eventos de assinatura e de pagamento recorrente) e copie a chave secreta para `MERCADOPAGO_WEBHOOK_SECRET`.
3. Só então troque para as credenciais de produção.

## 4. Segurança

- [ ] Entrar em `/admin` e ativar a **verificação em duas etapas** (botão "Segurança").
- [ ] `JWT_SECRET` e `ADMIN_SENHA` fortes e guardados fora do repositório.
- [ ] Nenhum usuário de demonstração em produção (não rode `prisma db seed`).
- [ ] Site antigo de administração (`admin-totalsoftware`): já não faz parte deste sistema. Para cortar o acesso dele à API, ative o 2FA do admin (ele entra só com senha, então passa a ser recusado) e/ou troque `ADMIN_SENHA` e reinicie a API. No projeto dele, apague `TOTALCONTROL_API_URL`, `TOTALCONTROL_ADMIN_EMAIL` e `TOTALCONTROL_ADMIN_SENHA` do `.env`.

## 5. Backup e monitoramento

1. Agende o backup diário e guarde uma cópia **fora do servidor**:

   ```
   0 3 * * * cd /caminho/do/projeto/server && ./scripts/backup-mysql.sh /var/backups/totalcontrol 30
   ```

2. **Teste a restauração** num banco temporário (veja o README). Backup nunca restaurado não conta.
3. Aponte um monitor de disponibilidade (UptimeRobot ou similar) para `GET /api/health/ready`: ele falha se o banco não responder.

## 6. Antes de cada versão nova

`npm run verificar` na raiz roda o type-check e o build do site, o type-check da API e todos os testes automatizados (os testes usam um banco próprio, `<nome>_test`, e nunca tocam o de desenvolvimento). O mesmo roda no GitHub a cada push (`.github/workflows/ci.yml`).
