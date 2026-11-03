# Subindo o Total Control (passo a passo)

Caminho mais curto: uma máquina (VPS) com Docker. O compose sobe MySQL, API e site; o nginx do site repassa `/api` para a API, então site e API ficam no **mesmo endereço** (sem CORS).

## 1. Preparar
1. Servidor Linux com Docker e Docker Compose, e um domínio apontando para ele.
2. `cp deploy/.env.production.example deploy/.env.production` e preencher (segredos com `openssl rand -hex 48`).
3. Conferir a configuração (copie os valores para um `server/.env` temporário, com `NODE_ENV=production`, ou exporte as variáveis) e rode:
   `cd server && npm run verificar:producao`. **Erros** impedem de subir; **avisos** deixam um recurso desligado (e-mail, pagamento, captcha).
4. Preencher `src/config/empresa.ts` (razão social, CNPJ, e-mails de contato e do encarregado de dados).

## 2. Subir
```
docker compose -f docker-compose.prod.yml --env-file deploy/.env.production up -d --build
```
A API aplica as migrations sozinha ao iniciar. O site responde na porta 8080.

## 3. HTTPS
Coloque um proxy na frente da porta 8080 que termine o HTTPS. O mais simples é o Caddy:
```
app.seudominio.com.br {
  reverse_proxy localhost:8080
}
```

## 4. Depois de subir
- `GET https://app.seudominio.com.br/api/health/ready` deve responder `ok`.
- Entrar em `/login` com `ADMIN_EMAIL`/`ADMIN_SENHA` e ativar a verificação em duas etapas (botão "Segurança").
- Mercado Pago: cadastrar o webhook `https://app.seudominio.com.br/api/assinatura/webhook` e copiar a chave secreta para `MERCADOPAGO_WEBHOOK_SECRET`; reiniciar a API.
- Backup diário com `server/scripts/backup-mysql.sh` (ver `docs/PRODUCAO.md`) e teste de restauração.

## Atualizar para uma versão nova
```
git pull && docker compose -f docker-compose.prod.yml --env-file deploy/.env.production up -d --build
```
