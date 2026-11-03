import { describe, expect, it } from 'vitest';
import { abrirCaixa, app, criarEmpresa, criarProduto, criarUsuario, entrar, prisma, request } from './helpers/index.js';

const dia = (d = 0) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function cenario() {
  const e = await criarEmpresa({ plano: 'PRO' });
  await abrirCaixa(e.loja.id, e.dono.id);
  return { ...e, ...(await entrar(e.dono.email)) };
}

type Auth = { auth: object };
const vender = (c: Auth, productId: string, quantidade: number, extra: object = {}) =>
  request(app).post('/api/vendas').set(c.auth).send({ itens: [{ productId, quantidade }], formaPagamento: 'PIX', ...extra });

describe('custo gravado na venda', () => {
  it('a venda guarda o custo do produto na hora, e reajustar o custo depois não muda o lucro passado', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 20 }); // custo 5
    const venda = await vender(c, p.id, 2);
    expect(venda.status).toBe(201);

    await prisma.produto.update({ where: { id: p.id }, data: { precoCusto: 18 } });

    const item = await prisma.itemTransacao.findFirstOrThrow({ where: { transacaoId: venda.body.id } });
    expect(Number(item.custoUnitario)).toBe(5);

    const r = await request(app).get('/api/dashboard/lucro').set(c.auth);
    expect(r.body.hoje).toEqual({ faturamento: 40, custo: 10, lucro: 30, vendas: 1 });
  });

  it('venda antiga, sem custo gravado, usa o custo atual do produto', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 20 });
    const venda = await vender(c, p.id, 1);
    await prisma.itemTransacao.updateMany({ where: { transacaoId: venda.body.id }, data: { custoUnitario: null } });
    await prisma.produto.update({ where: { id: p.id }, data: { precoCusto: 8 } });

    const r = await request(app).get('/api/dashboard/lucro').set(c.auth);
    expect(r.body.hoje).toMatchObject({ faturamento: 20, custo: 8, lucro: 12 });
  });
});

describe('GET /dashboard/lucro', () => {
  it('soma hoje, semana e mês e ignora venda cancelada', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10 });
    await vender(c, p.id, 3); // 30 de receita, custo 15
    const cancelada = await vender(c, p.id, 1);
    await prisma.transacao.update({ where: { id: cancelada.body.id }, data: { cancelada: true } });

    const r = await request(app).get('/api/dashboard/lucro').set(c.auth);
    expect(r.status).toBe(200);
    expect(r.body.hoje).toEqual({ faturamento: 30, custo: 15, lucro: 15, vendas: 1 });
    expect(r.body.semana.lucro).toBe(15);
    expect(r.body.mes.lucro).toBe(15);
  });

  it('não mistura o lucro de outra loja', async () => {
    const a = await cenario();
    const b = await cenario();
    const p = await criarProduto(a.loja.id, { preco: 10 });
    await vender(a, p.id, 1);
    const r = await request(app).get('/api/dashboard/lucro').set(b.auth);
    expect(r.body.mes).toEqual({ faturamento: 0, custo: 0, lucro: 0, vendas: 0 });
  });

  it('exige login e a tela do painel (o caixa não vê o lucro)', async () => {
    const c = await cenario();
    expect((await request(app).get('/api/dashboard/lucro')).status).toBe(401);
    const caixa = await criarUsuario(c.loja.id, 'OPERADOR_CAIXA', ['pdv']);
    const sessao = await entrar(caixa.email);
    expect((await request(app).get('/api/dashboard/lucro').set(sessao.auth)).status).toBe(403);
  });
});

describe('GET /relatorios/vendas-lista', () => {
  it('pagina e informa o total', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10, estoque: 100 });
    for (let i = 0; i < 5; i++) await vender(c, p.id, 1);

    const url = `/api/relatorios/vendas-lista?inicio=${dia(-1)}&fim=${dia(1)}&tamanho=2`;
    const pag1 = await request(app).get(`${url}&pagina=1`).set(c.auth);
    expect(pag1.status).toBe(200);
    expect(pag1.body).toMatchObject({ total: 5, pagina: 1, totalPaginas: 3 });
    expect(pag1.body.itens).toHaveLength(2);
    const pag3 = await request(app).get(`${url}&pagina=3`).set(c.auth);
    expect(pag3.body.itens).toHaveLength(1);
  });

  it('busca por cliente e por vendedor, sem curinga de SQL', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10, estoque: 100 });
    const maria = await prisma.cliente.create({ data: { tenantId: c.loja.id, nome: 'Maria Souza' } });
    await vender(c, p.id, 1, { clienteId: maria.id });
    await vender(c, p.id, 1);

    const base = `/api/relatorios/vendas-lista?inicio=${dia(-1)}&fim=${dia(1)}`;
    const achou = await request(app).get(`${base}&q=maria`).set(c.auth);
    expect(achou.body.total).toBe(1);
    expect(achou.body.itens[0].clienteNome).toBe('Maria Souza');
    expect((await request(app).get(`${base}&q=ninguem`).set(c.auth)).body.total).toBe(0);
    expect((await request(app).get(`${base}&q=${encodeURIComponent("' OR 1=1 --")}`).set(c.auth)).body.total).toBe(0);
  });

  it('só mostra as vendas da própria loja e exige a tela de relatórios', async () => {
    const a = await cenario();
    const b = await cenario();
    const p = await criarProduto(a.loja.id, { preco: 10 });
    await vender(a, p.id, 1);
    const url = `/api/relatorios/vendas-lista?inicio=${dia(-1)}&fim=${dia(1)}`;
    expect((await request(app).get(url).set(b.auth)).body.total).toBe(0);
    expect((await request(app).get(url)).status).toBe(401);
    const caixa = await criarUsuario(a.loja.id, 'OPERADOR_CAIXA', ['pdv']);
    expect((await request(app).get(url).set((await entrar(caixa.email)).auth)).status).toBe(403);
  });
});

describe('GET /relatorios/clientes-ranking', () => {
  it('ordena por valor comprado e separa as vendas sem cliente', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10, estoque: 100 });
    const ana = await prisma.cliente.create({ data: { tenantId: c.loja.id, nome: 'Ana' } });
    const bia = await prisma.cliente.create({ data: { tenantId: c.loja.id, nome: 'Bia' } });
    await vender(c, p.id, 1, { clienteId: ana.id });
    await vender(c, p.id, 5, { clienteId: bia.id });
    await vender(c, p.id, 1, { clienteId: bia.id });
    await vender(c, p.id, 2);

    const r = await request(app).get(`/api/relatorios/clientes-ranking?inicio=${dia(-1)}&fim=${dia(1)}`).set(c.auth);
    expect(r.status).toBe(200);
    expect(r.body.clientes.map((x: { nome: string }) => x.nome)).toEqual(['Bia', 'Ana']);
    expect(r.body.clientes[0]).toMatchObject({ compras: 2, total: 60, ticketMedio: 30 });
    expect(r.body.semCliente).toEqual({ compras: 1, total: 20 });
  });

  it('exige o período, ignora venda cancelada e não mostra cliente de outra loja', async () => {
    const a = await cenario();
    const b = await cenario();
    const p = await criarProduto(a.loja.id, { preco: 10, estoque: 100 });
    const ana = await prisma.cliente.create({ data: { tenantId: a.loja.id, nome: 'Ana' } });
    const venda = await vender(a, p.id, 1, { clienteId: ana.id });
    await prisma.transacao.update({ where: { id: venda.body.id }, data: { cancelada: true } });

    expect((await request(app).get('/api/relatorios/clientes-ranking').set(a.auth)).status).toBe(400);
    const url = `/api/relatorios/clientes-ranking?inicio=${dia(-1)}&fim=${dia(1)}`;
    expect((await request(app).get(url).set(a.auth)).body.clientes).toEqual([]);
    await vender(a, p.id, 1, { clienteId: ana.id });
    expect((await request(app).get(url).set(b.auth)).body.clientes).toEqual([]);
    expect((await request(app).get(url)).status).toBe(401);
  });
});
