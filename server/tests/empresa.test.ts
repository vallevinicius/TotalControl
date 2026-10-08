import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, cnpjValidoUnico, criarEmpresa, criarProduto, criarUsuario, entrar, prisma, request, SENHA } from './helpers/index.js';
import { iniciarMercadoPagoFalso } from './helpers/mp-mock.js';
import { caixaDeSaidaDeTeste } from '../src/lib/email.js';

const mp = iniciarMercadoPagoFalso();
beforeAll(() => mp.abrir());
afterAll(() => mp.fechar());

const dadosValidos = (extra: object = {}) => ({
  nomeFantasia: 'Nome Novo',
  razaoSocial: 'Razão Nova LTDA',
  cnpj: cnpjValidoUnico(),
  telefone: '(22) 99999-0000',
  cidade: 'Saquarema',
  uf: 'RJ',
  ...extra,
});

describe('dados da empresa (qualquer plano)', () => {
  it('a conta principal edita os dados mesmo num plano de uma loja só', async () => {
    const { loja, dono } = await criarEmpresa({ plano: 'STARTER' });
    const { auth } = await entrar(dono.email);
    const dados = dadosValidos();
    expect((await request(app).put('/api/tenant/dados').set(auth).send(dados)).status).toBe(200);
    const salva = await prisma.tenant.findUniqueOrThrow({ where: { id: loja.id } });
    expect(salva).toMatchObject({ nomeFantasia: 'Nome Novo', razaoSocial: 'Razão Nova LTDA', cidade: 'Saquarema', uf: 'RJ', cnpj: dados.cnpj });
    expect((await request(app).get('/api/auth/me').set(auth)).body.tenant.endereco.cidade).toBe('Saquarema');
  });

  it('recusa CNPJ inválido ou de outra empresa e deixa apagar um campo opcional', async () => {
    const a = await criarEmpresa({ plano: 'STARTER' });
    const b = await criarEmpresa({ plano: 'STARTER' });
    const { auth } = await entrar(a.dono.email);
    expect((await request(app).put('/api/tenant/dados').set(auth).send(dadosValidos({ cnpj: '11.111.111/1111-11' }))).status).toBe(400);
    expect((await request(app).put('/api/tenant/dados').set(auth).send(dadosValidos({ cnpj: b.loja.cnpj }))).status).toBe(409);

    await request(app).put('/api/tenant/dados').set(auth).send(dadosValidos({ telefone: '(22) 99999-0000' }));
    await request(app).put('/api/tenant/dados').set(auth).send(dadosValidos({ cnpj: (await prisma.tenant.findUniqueOrThrow({ where: { id: a.loja.id } })).cnpj, telefone: '' }));
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: a.loja.id } })).telefone).toBeNull();
  });

  it('quem não é a conta principal não edita', async () => {
    const { loja } = await criarEmpresa();
    const adm = await criarUsuario(loja.id, 'ADMIN');
    const { auth } = await entrar(adm.email);
    expect((await request(app).put('/api/tenant/dados').set(auth).send(dadosValidos())).status).toBe(403);
  });
});

describe('exportar os dados (LGPD)', () => {
  it('baixa um JSON com os dados da empresa, sem senhas, e só a conta principal pode', async () => {
    const { loja, dono } = await criarEmpresa();
    await criarProduto(loja.id, { nome: 'Produto exportado' });
    await prisma.cliente.create({ data: { tenantId: loja.id, nome: 'Cliente exportado', cpfCnpj: '52998224725' } });
    const { auth } = await entrar(dono.email);

    const r = await request(app).get('/api/tenant/exportar').set(auth);
    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toMatch(/attachment; filename="total-control-dados-/);
    const texto = r.text;
    expect(texto).toContain('Produto exportado');
    expect(texto).toContain('Cliente exportado');
    expect(texto).not.toMatch(/senhaHash|tokenHash|\$2[aby]\$/);
    const json = JSON.parse(texto);
    expect(json.lojas).toHaveLength(1);
    expect(json.lojas[0].usuarios[0].email).toBe(dono.email);

    const gerente = await criarUsuario(loja.id, 'GERENTE');
    expect((await request(app).get('/api/tenant/exportar').set((await entrar(gerente.email)).auth)).status).toBe(403);
  });
});

describe('excluir a própria conta (LGPD)', () => {
  it('exige senha e CNPJ da loja principal', async () => {
    const { loja, dono } = await criarEmpresa();
    const { auth } = await entrar(dono.email);
    expect((await request(app).delete('/api/tenant/conta').set(auth).send({ senha: 'errada', cnpj: loja.cnpj })).status).toBe(403);
    expect((await request(app).delete('/api/tenant/conta').set(auth).send({ senha: SENHA, cnpj: cnpjValidoUnico() })).status).toBe(400);
    expect(await prisma.empresa.count({ where: { id: loja.empresaId } })).toBe(1);
  });

  it('cancela a assinatura no Mercado Pago, apaga tudo (todas as lojas) e avisa por e-mail', async () => {
    const e = await criarEmpresa({ plano: 'ENTERPRISE' });
    const sessao = await entrar(e.dono.email);
    const filial = await request(app).post('/api/lojas').set(sessao.auth).send({ nomeFantasia: 'Filial', razaoSocial: 'Filial LTDA', cnpj: cnpjValidoUnico() });
    expect(filial.status).toBe(201);
    await criarProduto(filial.body.id);

    // Assinatura ativa no Mercado Pago.
    const checkout = await request(app).post('/api/assinatura/checkout').set(sessao.auth).send({ plano: 'PRO' });
    const idMp = checkout.body.url.split('/').pop() as string;
    mp.pagar(idMp);
    await request(app).post('/api/assinatura/sincronizar').set(sessao.auth);
    expect(mp.assinaturas.get(idMp)!.status).toBe('authorized');

    const r = await request(app).delete('/api/tenant/conta').set(sessao.auth).send({ senha: SENHA, cnpj: e.loja.cnpj });
    expect(r.status).toBe(204);

    expect(mp.assinaturas.get(idMp)!.status).toBe('cancelled'); // sem cobrança depois da exclusão
    expect(await prisma.empresa.findUnique({ where: { id: e.empresa.id } })).toBeNull();
    expect(await prisma.tenant.count({ where: { empresaId: e.empresa.id } })).toBe(0);
    expect(await prisma.usuario.findUnique({ where: { id: e.dono.id } })).toBeNull();
    expect(await prisma.produto.count({ where: { tenantId: filial.body.id } })).toBe(0);
    await new Promise((ok) => setTimeout(ok, 100));
    expect(caixaDeSaidaDeTeste.some((m) => m.para === e.dono.email && /excluída/.test(m.assunto))).toBe(true);
  });

  it('se o cancelamento no Mercado Pago falhar, nada é apagado', async () => {
    const e = await criarEmpresa({ plano: 'PRO' });
    const { auth } = await entrar(e.dono.email);
    await prisma.empresa.update({ where: { id: e.empresa.id }, data: { assinaturaStatus: 'ATIVA', mpAssinaturaId: 'sub_que_da_erro' } });
    const antes = process.env.MERCADOPAGO_ACCESS_TOKEN;
    process.env.MERCADOPAGO_ACCESS_TOKEN = 'token-errado'; // o Mercado Pago falso responde 401
    try {
      const r = await request(app).delete('/api/tenant/conta').set(auth).send({ senha: SENHA, cnpj: e.loja.cnpj });
      expect(r.status).toBe(502);
    } finally {
      process.env.MERCADOPAGO_ACCESS_TOKEN = antes;
    }
    expect(await prisma.empresa.findUnique({ where: { id: e.empresa.id } })).not.toBeNull();
  });
});

describe('faturas da assinatura', () => {
  it('lista as cobranças do Mercado Pago, da mais recente para a mais antiga', async () => {
    const e = await criarEmpresa({ plano: 'FREE', trialExpiraEm: new Date(Date.now() + 86_400_000) });
    const { auth } = await entrar(e.dono.email);
    expect((await request(app).get('/api/assinatura/cobrancas').set(auth)).body).toEqual([]);

    const checkout = await request(app).post('/api/assinatura/checkout').set(auth).send({ plano: 'PRO' });
    const idMp = checkout.body.url.split('/').pop() as string;
    mp.pagar(idMp);
    await request(app).post('/api/assinatura/sincronizar').set(auth);
    mp.cobrancas.set(idMp, [
      { id: 1, status: 'processed', transaction_amount: 129.9, debit_date: '2026-08-07T10:00:00.000-03:00', payment: { status: 'approved' } },
      { id: 2, status: 'processed', transaction_amount: 129.9, debit_date: '2026-09-07T10:00:00.000-03:00', payment: { status: 'rejected' } },
    ]);
    const r = await request(app).get('/api/assinatura/cobrancas').set(auth);
    expect(r.body.map((c: { id: string }) => c.id)).toEqual(['2', '1']);
    expect(r.body[0]).toMatchObject({ valor: 129.9, statusDoPagamento: 'rejected' });
  });
});
