import { describe, expect, it } from 'vitest';
import { abrirCaixa, app, cnpjValidoUnico, criarEmpresa, criarProduto, criarUsuario, entrar, prisma, request, SENHA } from './helpers/index.js';
import { normalizarCnpj } from '../src/lib/documentos.js';

describe('excluir cliente (LGPD)', () => {
  it('apaga os dados pessoais e mantém as vendas, sem o vínculo', async () => {
    const { loja, dono } = await criarEmpresa();
    const caixa = await abrirCaixa(loja.id, dono.id);
    const produto = await criarProduto(loja.id);
    const cliente = await prisma.cliente.create({ data: { tenantId: loja.id, nome: 'Maria', telefone: '22999990000', cpfCnpj: '52998224725' } });
    const { auth } = await entrar(dono.email);
    const venda = await request(app).post('/api/vendas').set(auth).send({ itens: [{ productId: produto.id, quantidade: 1 }], formaPagamento: 'PIX', clienteId: cliente.id });
    expect(venda.status).toBe(201);

    expect((await request(app).delete(`/api/clientes/${cliente.id}`).set(auth)).status).toBe(204);
    expect(await prisma.cliente.findUnique({ where: { id: cliente.id } })).toBeNull();
    const t = await prisma.transacao.findUniqueOrThrow({ where: { id: venda.body.id } });
    expect(t.clienteId).toBeNull();
    expect(t.caixaId).toBe(caixa.id);
  });

  it('editar permite apagar um campo enviando vazio', async () => {
    const { loja, dono } = await criarEmpresa();
    const cliente = await prisma.cliente.create({ data: { tenantId: loja.id, nome: 'Ana', telefone: '22999990000', email: 'ana@x.com' } });
    const { auth } = await entrar(dono.email);
    const r = await request(app).put(`/api/clientes/${cliente.id}`).set(auth).send({ nome: 'Ana Souza', telefone: '', email: 'ana@x.com' });
    expect(r.status).toBe(200);
    const salvo = await prisma.cliente.findUniqueOrThrow({ where: { id: cliente.id } });
    expect(salvo).toMatchObject({ nome: 'Ana Souza', telefone: null, email: 'ana@x.com' });
  });
});

describe('editar produto', () => {
  it('recusa SKU repetido e aceita mudar preço e nome', async () => {
    const { loja, dono } = await criarEmpresa();
    const a = await criarProduto(loja.id);
    const b = await criarProduto(loja.id);
    const { auth } = await entrar(dono.email);
    expect((await request(app).put(`/api/produtos/${b.id}`).set(auth).send({ sku: a.sku })).status).toBe(409);
    const r = await request(app).put(`/api/produtos/${b.id}`).set(auth).send({ nome: 'Novo nome', precoVenda: 12.5 });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ nome: 'Novo nome', precoVenda: 12.5 });
  });
});

describe('excluir loja (plano Enterprise)', () => {
  async function empresaComDuasLojas() {
    const e = await criarEmpresa({ plano: 'ENTERPRISE' });
    const sessao = await entrar(e.dono.email);
    const cnpj2 = cnpjValidoUnico();
    const criada = await request(app).post('/api/lojas').set(sessao.auth).send({ nomeFantasia: 'Filial', razaoSocial: 'Filial LTDA', cnpj: cnpj2 });
    expect(criada.status).toBe(201);
    return { ...e, ...sessao, filialId: criada.body.id as string, cnpj2 };
  }

  it('cria a filial com CNPJ validado e normalizado', async () => {
    const e = await criarEmpresa({ plano: 'ENTERPRISE' });
    const { auth } = await entrar(e.dono.email);
    expect((await request(app).post('/api/lojas').set(auth).send({ nomeFantasia: 'Ruim', cnpj: '11.111.111/1111-11' })).status).toBe(400);
    const cnpj = cnpjValidoUnico();
    const semMascara = cnpj.replace(/\D/g, '');
    const ok = await request(app).post('/api/lojas').set(auth).send({ nomeFantasia: 'Boa', razaoSocial: 'Boa LTDA', cnpj: semMascara });
    expect(ok.status).toBe(201);
    expect((await prisma.tenant.findUniqueOrThrow({ where: { id: ok.body.id } })).cnpj).toBe(normalizarCnpj(semMascara));
    // O mesmo CNPJ digitado com máscara não passa como se fosse outro.
    expect((await request(app).post('/api/lojas').set(auth).send({ nomeFantasia: 'Repetida', razaoSocial: 'R LTDA', cnpj })).status).toBe(409);
  });

  it('exige a senha e o CNPJ certos e apaga a loja com tudo que é dela', async () => {
    const e = await empresaComDuasLojas();
    await criarProduto(e.filialId, { nome: 'Item da filial' });
    await prisma.cliente.create({ data: { tenantId: e.filialId, nome: 'Cliente da filial' } });

    expect((await request(app).delete(`/api/lojas/${e.filialId}`).set(e.auth).send({ senha: 'errada', cnpj: e.cnpj2 })).status).toBe(403);
    expect((await request(app).delete(`/api/lojas/${e.filialId}`).set(e.auth).send({ senha: SENHA, cnpj: cnpjValidoUnico() })).status).toBe(400);

    expect((await request(app).delete(`/api/lojas/${e.filialId}`).set(e.auth).send({ senha: SENHA, cnpj: e.cnpj2 })).status).toBe(204);
    expect(await prisma.tenant.findUnique({ where: { id: e.filialId } })).toBeNull();
    expect(await prisma.produto.count({ where: { tenantId: e.filialId } })).toBe(0);
    expect(await prisma.cliente.count({ where: { tenantId: e.filialId } })).toBe(0);
    // A loja de origem segue intacta.
    expect(await prisma.tenant.findUnique({ where: { id: e.loja.id } })).not.toBeNull();
  });

  it('não exclui a loja em que a pessoa está nem a loja de origem da conta', async () => {
    const e = await empresaComDuasLojas();
    const r = await request(app).delete(`/api/lojas/${e.loja.id}`).set(e.auth).send({ senha: SENHA, cnpj: e.loja.cnpj });
    expect(r.status).toBe(409);
  });

  it('usuário que não é da conta principal não gerencia lojas', async () => {
    const e = await empresaComDuasLojas();
    const gerente = await criarUsuario(e.loja.id, 'ADMIN');
    const { auth } = await entrar(gerente.email);
    expect((await request(app).delete(`/api/lojas/${e.filialId}`).set(auth).send({ senha: SENHA, cnpj: e.cnpj2 })).status).toBe(403);
  });

  it('loja desativada some do seletor e ninguém entra nela', async () => {
    const e = await empresaComDuasLojas();
    expect((await request(app).patch(`/api/lojas/${e.filialId}/ativo`).set(e.auth).send({ ativo: false })).status).toBe(200);
    expect((await request(app).post('/api/auth/trocar-loja').set(e.auth).send({ tenantId: e.filialId })).status).toBe(403);
    const me = await request(app).get('/api/auth/me').set(e.auth);
    expect(me.body.lojas.map((l: { id: string }) => l.id)).not.toContain(e.filialId);
  });
});
