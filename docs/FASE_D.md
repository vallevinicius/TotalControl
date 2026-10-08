# Fase D: o que foi feito e o que ficou preparado

## Feito e testado
- Sessões ativas (listar e encerrar aparelhos), em Minha conta.
- Receita no painel admin: MRR, ARR, churn de 30 dias, conversão do teste, cobranças que falharam.
- Transferência de estoque entre lojas (plano com multi-loja), com livro-razão nas duas pontas.
- Logs estruturados, `X-Request-Id`, envio de erros ao Sentry (via `SENTRY_DSN`).
- Front dividido em arquivos por tela (carga inicial de ~600 KB para ~177 KB) e bibliotecas em cache próprio.
- `sitemap.xml` e `robots.txt` (trocar `SEU-DOMINIO.com.br`).

## Preparado, depende de decisão ou de infraestrutura

(O PDV offline saiu desta lista: está feito.)

### Token em cookie httpOnly
Hoje o token fica no `localStorage` (um XSS o roubaria). Para trocar:
1. Site e API no mesmo domínio (ex.: `app.seudominio.com.br` e `app.seudominio.com.br/api`), ou subdomínios com `Domain=.seudominio.com.br`.
2. `/auth/login` e `/auth/refresh` passam a responder `Set-Cookie: refresh=...; HttpOnly; Secure; SameSite=Lax; Path=/api/auth`.
3. O token de acesso fica só em memória no front (`src/services/apiService.ts`, `getToken/setToken`).
4. Com cookie, `/auth/refresh` precisa de proteção CSRF (SameSite=Lax já cobre a maioria; some um cabeçalho `X-Requested-With` checado no servidor).
Ponto de partida: `server/src/lib/sessao.ts` (emissão/renovação) e `apiService.ts` (função de renovação).

### CSP (Content-Security-Policy) no front
Servir `index.html` com:
`default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self'; connect-src 'self' <URL da API>; frame-ancestors 'none'`
(`'unsafe-inline'` no estilo existe por causa das cores do tema). Configurar no servidor estático/CDN; o `vite build` não usa script inline.

### PDV offline (feito, ver README seção 10)
Falta só validar num aparelho real (veja o roteiro de teste no README).

### Verificação de e-mail e captcha no cadastro
Contra criação em massa de testes grátis. Passos: campo `emailVerificadoEm` no `Usuario`, link de uso único (mesmo modelo do `TokenSenha`), bloquear o 1º login pago até verificar; captcha (Cloudflare Turnstile) validado no `POST /auth/register` antes de criar a empresa.

### Preços e limites dos planos no banco
Hoje em `server/src/config/planos.ts`, `src/utils/planos.ts` e na landing. Tabela `Plano` (chave, preço, limites, features) + `GET /api/planos` público que alimenta o front e a landing; `PRECOS_MENSAIS` passa a ler do banco.

### Cobrança automática por loja adicional (Enterprise)
Depende da política de preço (decisão sua). Modelo sugerido: valor base + valor por loja ativa acima de N, recalculado no `PUT` do Mercado Pago (`/preapproval`) quando uma loja é criada ou removida.

### "Entrar como" o cliente (suporte)
Rota `POST /api/admin/empresas/:id/entrar-como` que emite um token de loja curto (15 min) com marca `viaSuporte`, grava na auditoria da loja ("Suporte da plataforma acessou") e mostra uma faixa fixa no app. Só fazer com 2FA do admin ligado.

### Rate limit compartilhado
Só necessário com mais de uma instância da API: trocar o store do `express-rate-limit` por Redis (`rate-limit-redis`) em `server/src/middleware/seguranca.ts`.

### Alerta de indisponibilidade
Apontar o UptimeRobot (ou similar) para `/api/health/ready` (já confere o banco).
