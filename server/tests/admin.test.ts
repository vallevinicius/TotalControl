import { beforeAll, describe, expect, it } from 'vitest';
import { app, criarEmpresa, criarProduto, entrar, prisma, request } from './helpers/index.js';
import { garantirAdminPlataforma } from '../src/lib/adminBootstrap.js';
import { codigoAtual } from '../src/lib/totp.js';

const EMAIL = process.env.ADMIN_EMAIL!;
const SENHA_ADMIN = process.env.ADMIN_SENHA!;

async function loginAdmin() {
  const r = await request(app).post('/api/admin/login').send({ email: EMAIL, senha: SENHA_ADMIN });
  return { r, auth: { Authorization: `Bearer ${r.body.token}` } };
}

beforeAll(async () => {
  await garantirAdminPlataforma();
});

describe('painel admin da plataforma', () => {
  it('login do admin não vira sessão de loja, nem o contrário', async () => {
    const { r, auth } = await loginAdmin();
    expect(r.status).toBe(200);
    expect((await request(app).get('/api/produtos').set(auth)).status).toBe(403);
    const { dono } = await criarEmpresa();
    const loja = await entrar(dono.email);
    expect((await request(app).get('/api/admin/empresas').set(loja.auth)).status).toBe(403);
  });

  it('lista as empresas com lojas, usuários e indicadores', async () => {
    const { empresa, loja } = await criarEmpresa();
    await criarProduto(loja.id);
    const { auth } = await loginAdmin();
    const r = await request(app).get('/api/admin/empresas').set(auth);
    const minha = r.body.find((e: { id: string }) => e.id === empresa.id);
    expect(minha.lojas[0]).toMatchObject({ id: loja.id, ativo: true, indicadores: { produtos: 1 } });
    expect(minha.assinatura.status).toBe('NENHUMA');
  });

  it('resetar a senha derruba as sessões do usuário', async () => {
    const { dono } = await criarEmpresa();
    const sessao = await entrar(dono.email);
    const { auth } = await loginAdmin();
    const r = await request(app).post(`/api/admin/usuarios/${dono.id}/resetar-senha`).set(auth);
    expect(r.status).toBe(200);
    expect(r.body.senhaTemporaria).toBeTruthy();
    expect((await request(app).get('/api/auth/me').set(sessao.auth)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: dono.email, senha: r.body.senhaTemporaria })).status).toBe(200);
  });

  it('excluir a empresa apaga lojas, usuários, vendas e caixas sem erro de integridade', async () => {
    const { empresa, loja, dono } = await criarEmpresa();
    const p = await criarProduto(loja.id);
    const sessao = await entrar(dono.email);
    await prisma.caixa.create({ data: { tenantId: loja.id, abertoPorId: dono.id, valorAbertura: 0 } });
    expect((await request(app).post('/api/vendas').set(sessao.auth).send({ itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'PIX' })).status).toBe(201);

    const { auth } = await loginAdmin();
    expect((await request(app).delete(`/api/admin/empresas/${empresa.id}`).set(auth)).status).toBe(204);
    expect(await prisma.empresa.findUnique({ where: { id: empresa.id } })).toBeNull();
    expect(await prisma.usuario.count({ where: { tenantId: loja.id } })).toBe(0);
    expect(await prisma.transacao.count({ where: { tenantId: loja.id } })).toBe(0);
    expect(await prisma.caixa.count({ where: { tenantId: loja.id } })).toBe(0);
  });

  it('senha fraca ao criar empresa é recusada com a explicação', async () => {
    const { auth } = await loginAdmin();
    const r = await request(app).post('/api/admin/empresas').set(auth).send({
      nomeFantasia: 'Fraca', cnpj: '11.222.333/0001-81', nomeAdmin: 'Fulano', emailAdmin: 'fraca@teste.local', senhaAdmin: 'abc123',
    });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/8 caracteres/);
  });
});

describe('verificação em duas etapas do admin', () => {
  it('com 2FA ativo a senha sozinha não entra; o código vale uma vez; desligar exige senha e código', async () => {
    const { auth } = await loginAdmin();
    const iniciar = await request(app).post('/api/admin/2fa/iniciar').set(auth);
    expect(iniciar.status).toBe(200);
    const segredo = iniciar.body.segredo as string;
    expect(iniciar.body.qrCode).toMatch(/^data:image\/png;base64,/);

    expect((await request(app).post('/api/admin/2fa/ativar').set(auth).send({ codigo: '000000' })).status).toBe(400);
    const codigo = codigoAtual(segredo);
    expect((await request(app).post('/api/admin/2fa/ativar').set(auth).send({ codigo })).status).toBe(200);

    // Agora o login pede o código.
    const semCodigo = await request(app).post('/api/admin/login').send({ email: EMAIL, senha: SENHA_ADMIN });
    expect(semCodigo.body.precisaCodigo).toBe(true);
    expect(semCodigo.body.token).toBeUndefined();
    const desafio = semCodigo.body.desafio as string;

    // O desafio não serve como sessão de admin nem de loja.
    expect((await request(app).get('/api/admin/empresas').set({ Authorization: `Bearer ${desafio}` })).status).toBe(403);
    expect((await request(app).get('/api/produtos').set({ Authorization: `Bearer ${desafio}` })).status).toBe(403);

    // O código usado na ativação não vale de novo (replay).
    expect((await request(app).post('/api/admin/login/2fa').send({ desafio, codigo })).status).toBe(401);
    expect((await request(app).post('/api/admin/login/2fa').send({ desafio, codigo: '123456' })).status).toBe(401);

    // Desligar: precisa de senha E código; deixa o admin como estava.
    const ok = await request(app).post('/api/admin/2fa/desativar').set(auth).send({ senha: 'errada', codigo: codigoAtual(segredo) });
    expect(ok.status).toBe(400);
    await prisma.adminPlataforma.updateMany({ data: { totpAtivo: false, totpSegredo: null } });
    expect((await request(app).post('/api/admin/login').send({ email: EMAIL, senha: SENHA_ADMIN })).body.token).toBeTruthy();
  });

  it('receita: MRR soma só assinaturas ativas Starter e Pro; Enterprise fica como contagem', async () => {
    const { auth } = await loginAdmin();
    const antes = (await request(app).get('/api/admin/receita').set(auth)).body;
    const a = await criarEmpresa({ plano: 'STARTER' });
    const b = await criarEmpresa({ plano: 'PRO' });
    const c = await criarEmpresa({ plano: 'ENTERPRISE' });
    for (const x of [a, b, c]) await prisma.empresa.update({ where: { id: x.empresa.id }, data: { assinaturaStatus: 'ATIVA' } });
    const depois = (await request(app).get('/api/admin/receita').set(auth)).body;
    expect(depois.mrr - antes.mrr).toBeCloseTo(59.9 + 129.9, 2);
    expect(depois.assinantesAtivos - antes.assinantesAtivos).toBe(3);
    expect(depois.assinantesPorPlano.ENTERPRISE - antes.assinantesPorPlano.ENTERPRISE).toBe(1);
    const loja = await entrar(a.dono.email);
    expect((await request(app).get('/api/admin/receita').set(loja.auth)).status).toBe(403);
  });
});
