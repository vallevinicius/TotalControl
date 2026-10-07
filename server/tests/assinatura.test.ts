import crypto from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, criarEmpresa, criarUsuario, entrar, prisma, request } from './helpers/index.js';
import { iniciarMercadoPagoFalso } from './helpers/mp-mock.js';

const mp = iniciarMercadoPagoFalso();
beforeAll(() => mp.abrir());
afterAll(() => mp.fechar());

async function empresaEmTeste() {
  const e = await criarEmpresa({ plano: 'FREE', trialExpiraEm: new Date(Date.now() + 10 * 86_400_000) });
  return { ...e, ...(await entrar(e.dono.email)) };
}

const estado = async (auth: object) => (await request(app).get('/api/assinatura').set(auth)).body;

describe('assinatura pelo Mercado Pago', () => {
  it('só planos vendidos online são contratáveis; Enterprise é com a equipe', async () => {
    const e = await empresaEmTeste();
    expect((await request(app).post('/api/assinatura/checkout').set(e.auth).send({ plano: 'ENTERPRISE' })).status).toBe(400);
    expect((await request(app).post('/api/assinatura/checkout').set(e.auth).send({ plano: 'GRATIS' })).status).toBe(400);
  });

  it('só a conta principal contrata', async () => {
    const e = await empresaEmTeste();
    const outro = await criarUsuario(e.loja.id, 'ADMIN');
    const { auth } = await entrar(outro.email);
    expect((await request(app).post('/api/assinatura/checkout').set(auth).send({ plano: 'PRO' })).status).toBe(403);
  });

  it('o plano só muda quando o pagamento é autorizado', async () => {
    const e = await empresaEmTeste();
    const r = await request(app).post('/api/assinatura/checkout').set(e.auth).send({ plano: 'PRO' });
    expect(r.status).toBe(200);
    expect(r.body.url).toMatch(/^https:\/\/mp\.test\/checkout\/sub_/);

    let s = await estado(e.auth);
    expect(s.plano).toBe('FREE');
    expect(s.planoPendente).toBe('PRO');

    const idMp = r.body.url.split('/').pop();
    mp.pagar(idMp);
    // O Mercado Pago avisa por webhook; o servidor confirma na API deles.
    expect((await request(app).post('/api/assinatura/webhook').send({ type: 'subscription_preapproval', data: { id: idMp } })).status).toBe(200);

    s = await estado(e.auth);
    expect(s).toMatchObject({ plano: 'PRO', status: 'ATIVA', planoPendente: null, trialExpiraEm: null });
    expect(s.acessoAte).toBeTruthy();
  });

  it('webhook com id desconhecido não altera nada e não dá erro', async () => {
    const e = await empresaEmTeste();
    const antes = await estado(e.auth);
    expect((await request(app).post('/api/assinatura/webhook').send({ type: 'subscription_preapproval', data: { id: 'sub_inexistente' } })).status).toBe(200);
    expect(await estado(e.auth)).toEqual(antes);
  });

  it('trocar de plano cancela a assinatura anterior (ninguém paga duas)', async () => {
    const e = await empresaEmTeste();
    const a = await request(app).post('/api/assinatura/checkout').set(e.auth).send({ plano: 'PRO' });
    const idPro = a.body.url.split('/').pop();
    mp.pagar(idPro);
    await request(app).post('/api/assinatura/sincronizar').set(e.auth);

    const b = await request(app).post('/api/assinatura/checkout').set(e.auth).send({ plano: 'STARTER' });
    const idStarter = b.body.url.split('/').pop();
    mp.pagar(idStarter);
    await request(app).post('/api/assinatura/sincronizar').set(e.auth);

    expect((await estado(e.auth)).plano).toBe('STARTER');
    expect(mp.assinaturas.get(idPro)!.status).toBe('cancelled');
    expect(mp.assinaturas.get(idStarter)!.status).toBe('authorized');
  });

  it('já estar no plano escolhido é recusado', async () => {
    const e = await empresaEmTeste();
    const a = await request(app).post('/api/assinatura/checkout').set(e.auth).send({ plano: 'PRO' });
    mp.pagar(a.body.url.split('/').pop());
    await request(app).post('/api/assinatura/sincronizar').set(e.auth);
    expect((await request(app).post('/api/assinatura/checkout').set(e.auth).send({ plano: 'PRO' })).status).toBe(409);
  });

  it('cancelar mantém o acesso até o fim do período pago e depois bloqueia só a tela do plano fica aberta', async () => {
    const e = await empresaEmTeste();
    const a = await request(app).post('/api/assinatura/checkout').set(e.auth).send({ plano: 'PRO' });
    const idMp = a.body.url.split('/').pop();
    mp.pagar(idMp);
    await request(app).post('/api/assinatura/sincronizar').set(e.auth);

    const c = await request(app).post('/api/assinatura/cancelar').set(e.auth);
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: 'CANCELADA', acessoExpirado: null });
    expect(mp.assinaturas.get(idMp)!.status).toBe('cancelled');
    // Ainda dentro do período pago: tudo funciona.
    expect((await request(app).get('/api/produtos').set(e.auth)).status).toBe(200);
    // Cancelar de novo não faz sentido.
    expect((await request(app).post('/api/assinatura/cancelar').set(e.auth)).status).toBe(409);

    // O período pago acaba.
    await prisma.empresa.update({ where: { id: e.empresa.id }, data: { acessoAte: new Date(Date.now() - 1000) } });
    const bloqueado = await request(app).get('/api/produtos').set(e.auth);
    expect(bloqueado.status).toBe(402);
    expect(bloqueado.body.codigo).toBe('ACESSO_EXPIRADO');
    // Sessão e tela do plano continuam abertas, e dá pra assinar de novo.
    expect((await request(app).get('/api/auth/me').set(e.auth)).body.tenant.acessoExpirado).toBe('ASSINATURA');
    expect((await request(app).get('/api/assinatura').set(e.auth)).status).toBe(200);
    const nova = await request(app).post('/api/assinatura/checkout').set(e.auth).send({ plano: 'PRO' });
    mp.pagar(nova.body.url.split('/').pop());
    await request(app).post('/api/assinatura/sincronizar').set(e.auth);
    expect((await request(app).get('/api/produtos').set(e.auth)).status).toBe(200);
  });

  it('teste grátis vencido bloqueia a API, mas o login e o plano seguem abertos', async () => {
    const e = await empresaEmTeste();
    await prisma.empresa.update({ where: { id: e.empresa.id }, data: { trialExpiraEm: new Date(Date.now() - 1000) } });
    expect((await request(app).get('/api/produtos').set(e.auth)).status).toBe(402);
    expect((await request(app).post('/api/auth/login').send({ email: e.dono.email, senha: e.donoSenha })).status).toBe(200);
    expect((await request(app).get('/api/assinatura').set(e.auth)).body.acessoExpirado).toBe('TRIAL');
  });
});

describe('assinatura do webhook', () => {
  it('com o segredo configurado, recusa notificação sem assinatura ou com assinatura errada e aceita a certa', async () => {
    process.env.MERCADOPAGO_WEBHOOK_SECRET = 'segredo-do-webhook';
    try {
      const e = await empresaEmTeste();
      const r = await request(app).post('/api/assinatura/checkout').set(e.auth).send({ plano: 'PRO' });
      const id = r.body.url.split('/').pop() as string;
      mp.pagar(id);

      const corpo = { type: 'subscription_preapproval', data: { id } };
      expect((await request(app).post('/api/assinatura/webhook').send(corpo)).status).toBe(401);
      expect((await request(app).post('/api/assinatura/webhook').set('x-signature', 'ts=1,v1=abcd').set('x-request-id', 'r1').send(corpo)).status).toBe(401);
      expect((await estado(e.auth)).plano).toBe('FREE'); // nada mudou

      const ts = String(Date.now());
      const v1 = crypto.createHmac('sha256', 'segredo-do-webhook').update(`id:${id};request-id:req-1;ts:${ts};`).digest('hex');
      const ok = await request(app).post('/api/assinatura/webhook').set('x-signature', `ts=${ts},v1=${v1}`).set('x-request-id', 'req-1').send(corpo);
      expect(ok.status).toBe(200);
      expect((await estado(e.auth)).plano).toBe('PRO');
    } finally {
      delete process.env.MERCADOPAGO_WEBHOOK_SECRET;
    }
  });
});
