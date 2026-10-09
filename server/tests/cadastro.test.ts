import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, cnpjValidoUnico, emailUnico, prisma, request } from './helpers/index.js';
import { caixaDeSaidaDeTeste } from '../src/lib/email.js';
import { limparCadastrosNaoConfirmados } from '../src/lib/verificacaoEmail.js';

process.env.LIMITE_CADASTRO_HORA = '1000';

const corpo = (extra: object = {}) => ({
  nomeFantasia: 'Loja Nova',
  razaoSocial: 'Loja Nova LTDA',
  cnpj: cnpjValidoUnico(),
  nomeAdmin: 'Fulana',
  email: emailUnico(),
  senha: 'Teste@123',
  aceitouTermos: true,
  ...extra,
});

async function esperar(condicao: () => boolean, ms = 3000) {
  const limite = Date.now() + ms;
  while (!condicao() && Date.now() < limite) await new Promise((r) => setTimeout(r, 25));
  if (!condicao()) throw new Error('condição não ocorreu a tempo');
}

const linkDe = (email: string) => {
  const msg = [...caixaDeSaidaDeTeste].reverse().find((e) => e.para === email && e.assunto.includes('Confirme'));
  return msg?.texto.match(/token=([\w-]+)/)?.[1];
};

describe('confirmação de e-mail no cadastro', () => {
  it('cadastra sem entrar, manda o link, login bloqueado até confirmar, depois entra', async () => {
    const dados = corpo();
    expect((await request(app).post('/api/auth/register').send(dados)).status).toBe(201);
    await esperar(() => Boolean(linkDe(dados.email)));

    // Senha certa, mas e-mail não confirmado.
    const antes = await request(app).post('/api/auth/login').send({ email: dados.email, senha: dados.senha });
    expect(antes.status).toBe(403);
    expect(antes.body.codigo).toBe('EMAIL_NAO_VERIFICADO');
    // Senha errada não revela nada sobre a conta.
    expect((await request(app).post('/api/auth/login').send({ email: dados.email, senha: 'Errada@123' })).status).toBe(401);

    const token = linkDe(dados.email)!;
    expect((await request(app).post('/api/auth/verificar-email').send({ token })).status).toBe(204);
    // Link de uso único.
    expect((await request(app).post('/api/auth/verificar-email').send({ token })).status).toBe(400);

    const depois = await request(app).post('/api/auth/login').send({ email: dados.email, senha: dados.senha });
    expect(depois.status).toBe(200);
    expect(depois.body.refreshToken).toBeTruthy();
  });

  it('reenvio: gera link novo (o antigo deixa de valer), respeita o intervalo e não revela se a conta existe', async () => {
    const dados = corpo();
    await request(app).post('/api/auth/register').send(dados);
    await esperar(() => Boolean(linkDe(dados.email)));
    const primeiro = linkDe(dados.email)!;

    // Logo depois do primeiro e-mail: dentro do intervalo, não manda outro.
    const r = await request(app).post('/api/auth/reenviar-verificacao').send({ email: dados.email });
    expect(r.status).toBe(200);
    await new Promise((ok) => setTimeout(ok, 150));
    expect(caixaDeSaidaDeTeste.filter((e) => e.para === dados.email && e.assunto.includes('Confirme'))).toHaveLength(1);

    // Passado o intervalo, manda um novo e o antigo morre.
    await prisma.tokenVerificacaoEmail.updateMany({ data: { criadoEm: new Date(Date.now() - 120_000) }, where: { usuario: { email: dados.email } } });
    await request(app).post('/api/auth/reenviar-verificacao').send({ email: dados.email });
    await esperar(() => caixaDeSaidaDeTeste.filter((e) => e.para === dados.email && e.assunto.includes('Confirme')).length === 2);
    expect((await request(app).post('/api/auth/verificar-email').send({ token: primeiro })).status).toBe(400);
    expect((await request(app).post('/api/auth/verificar-email').send({ token: linkDe(dados.email)! })).status).toBe(204);

    // Conta inexistente: mesma resposta.
    expect((await request(app).post('/api/auth/reenviar-verificacao').send({ email: emailUnico() })).status).toBe(200);
  });

  it('link vencido não confirma', async () => {
    const dados = corpo();
    await request(app).post('/api/auth/register').send(dados);
    await esperar(() => Boolean(linkDe(dados.email)));
    await prisma.tokenVerificacaoEmail.updateMany({ data: { expiraEm: new Date(Date.now() - 1000) }, where: { usuario: { email: dados.email } } });
    expect((await request(app).post('/api/auth/verificar-email').send({ token: linkDe(dados.email)! })).status).toBe(400);
  });

  it('apaga cadastro nunca confirmado depois de 7 dias (libera o CNPJ), mas não o confirmado nem o recente', async () => {
    const velho = corpo();
    const recente = corpo();
    const confirmado = corpo();
    for (const d of [velho, recente, confirmado]) await request(app).post('/api/auth/register').send(d);
    const antigo = new Date(Date.now() - 8 * 86_400_000);
    await prisma.usuario.updateMany({ where: { email: { in: [velho.email, confirmado.email] } }, data: { criadoEm: antigo } });
    await prisma.usuario.update({ where: { email: confirmado.email }, data: { emailPendente: false } });

    await limparCadastrosNaoConfirmados();
    expect(await prisma.usuario.count({ where: { email: velho.email } })).toBe(0);
    expect(await prisma.tenant.count({ where: { cnpj: velho.cnpj.replace(/\D/g, '') } })).toBe(0);
    expect(await prisma.usuario.count({ where: { email: recente.email } })).toBe(1);
    expect(await prisma.usuario.count({ where: { email: confirmado.email } })).toBe(1);
  });
});

describe('captcha no cadastro', () => {
  let servidor: http.Server;
  let respostaCloudflare = { success: true };
  const tokensRecebidos: string[] = [];

  beforeAll(async () => {
    servidor = http.createServer((req, res) => {
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        tokensRecebidos.push(new URLSearchParams(b).get('response') ?? '');
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(respostaCloudflare));
      });
    });
    await new Promise<void>((ok) => servidor.listen(4996, ok));
    process.env.TURNSTILE_SECRET_KEY = 'segredo-de-teste';
    process.env.TURNSTILE_VERIFY_URL = 'http://localhost:4996/siteverify';
  });
  afterAll(() => {
    delete process.env.TURNSTILE_SECRET_KEY;
    delete process.env.TURNSTILE_VERIFY_URL;
    servidor.close();
  });

  it('sem token ou com token recusado não cria a conta; com token válido cria', async () => {
    const semToken = corpo();
    expect((await request(app).post('/api/auth/register').send(semToken)).status).toBe(400);
    expect(await prisma.usuario.count({ where: { email: semToken.email } })).toBe(0);

    respostaCloudflare = { success: false };
    const recusado = corpo({ captchaToken: 'token-ruim' });
    const r = await request(app).post('/api/auth/register').send(recusado);
    expect(r.status).toBe(400);
    expect(r.body.codigo).toBe('CAPTCHA_INVALIDO');

    respostaCloudflare = { success: true };
    const ok = corpo({ captchaToken: 'token-bom' });
    expect((await request(app).post('/api/auth/register').send(ok)).status).toBe(201);
    expect(tokensRecebidos).toContain('token-bom');
  });

  it('Cloudflare fora do ar: recusa com 503 (não deixa passar sem conferir)', async () => {
    process.env.TURNSTILE_VERIFY_URL = 'http://localhost:1/siteverify';
    const r = await request(app).post('/api/auth/register').send(corpo({ captchaToken: 'qualquer' }));
    expect(r.status).toBe(503);
    process.env.TURNSTILE_VERIFY_URL = 'http://localhost:4996/siteverify';
  });
});
