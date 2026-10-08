import { describe, expect, it } from 'vitest';
import { abrirCaixa, app, criarEmpresa, criarProduto, criarUsuario, entrar, prisma, request } from './helpers/index.js';

const dia = (d = 0) => new Date(Date.now() + d * 86_400_000).toISOString().slice(0, 10);

async function cenario() {
  const e = await criarEmpresa({ plano: 'PRO' });
  await abrirCaixa(e.loja.id, e.dono.id);
  return { ...e, ...(await entrar(e.dono.email)) };
}

const vender = (auth: object, productId: string, quantidade: number) =>
  request(app).post('/api/vendas').set(auth).send({ itens: [{ productId, quantidade }], formaPagamento: 'PIX' });

describe('gráficos de vendas por dia', () => {
  it('o dashboard devolve N dias seguidos, com dias sem venda zerados', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10 });
    await vender(c.auth, p.id, 2);
    await vender(c.auth, p.id, 1);

    const r = await request(app).get('/api/dashboard/serie?dias=7').set(c.auth);
    expect(r.status).toBe(200);
    expect(r.body).toHaveLength(7);
    const hoje = r.body.at(-1);
    expect(hoje).toMatchObject({ faturamento: 30, vendas: 2 });
    expect(r.body.slice(0, 6).every((x: { faturamento: number }) => x.faturamento === 0)).toBe(true);
  });

  it('a série do relatório cobre exatamente o período pedido', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10 });
    await vender(c.auth, p.id, 1);
    const r = await request(app).get(`/api/relatorios/serie-diaria?inicio=${dia(-4)}&fim=${dia(0)}`).set(c.auth);
    expect(r.body).toHaveLength(5);
    expect(r.body.reduce((a: number, x: { faturamento: number }) => a + x.faturamento, 0)).toBe(10);
    expect((await request(app).get('/api/relatorios/serie-diaria').set(c.auth)).status).toBe(400);
  });

  it('a venda da noite cai no dia certo do fuso da loja (não no de UTC)', async () => {
    const c = await cenario();
    await prisma.tenant.update({ where: { id: c.loja.id }, data: { fusoHorario: 'America/Sao_Paulo' } });
    const p = await criarProduto(c.loja.id, { preco: 10 });
    // 23h do dia 10 em São Paulo = 02h do dia 11 em UTC.
    const caixa = await prisma.caixa.findFirstOrThrow({ where: { tenantId: c.loja.id } });
    await prisma.transacao.create({
      data: { tenantId: c.loja.id, tipo: 'SAIDA', valorTotal: 50, usuarioId: c.dono.id, caixaId: caixa.id, formaPagamento: 'PIX', timestamp: new Date('2026-03-11T02:00:00Z'), itens: { create: [{ productId: p.id, nomeProdutoSnapshot: p.nome, quantidade: 5, valorUnitarioPraticado: 10, subtotal: 50 }] } },
    });
    const r = await request(app).get('/api/relatorios/serie-diaria?inicio=2026-03-09&fim=2026-03-12').set(c.auth);
    const porData = Object.fromEntries(r.body.map((x: { data: string; faturamento: number }) => [x.data, x.faturamento]));
    expect(porData['2026-03-10']).toBe(50);
    expect(porData['2026-03-11']).toBe(0);
  });
});

describe('curva ABC', () => {
  it('classifica pelos 80% / 95% do faturamento acumulado', async () => {
    const c = await cenario();
    const a = await criarProduto(c.loja.id, { nome: 'Campeão', preco: 100, estoque: 100 });
    const b = await criarProduto(c.loja.id, { nome: 'Médio', preco: 10, estoque: 100 });
    const d = await criarProduto(c.loja.id, { nome: 'Pequeno', preco: 1, estoque: 100 });
    await vender(c.auth, a.id, 8); // 800
    await vender(c.auth, b.id, 14); // 140
    await vender(c.auth, d.id, 60); // 60  -> total 1000
    const r = await request(app).get(`/api/relatorios/curva-abc?inicio=${dia(-1)}&fim=${dia(1)}`).set(c.auth);
    expect(r.body.total).toBe(1000);
    expect(r.body.itens.map((i: { nome: string; classe: string; participacao: number }) => [i.nome, i.classe, i.participacao])).toEqual([
      ['Campeão', 'A', 80],
      ['Médio', 'B', 14],
      ['Pequeno', 'C', 6],
    ]);
    expect(r.body.itens[2].acumulado).toBe(100);
  });

  it('sem vendas no período, lista vazia', async () => {
    const c = await cenario();
    const r = await request(app).get(`/api/relatorios/curva-abc?inicio=${dia(-1)}&fim=${dia(0)}`).set(c.auth);
    expect(r.body).toEqual({ total: 0, itens: [] });
  });
});

describe('estoque parado', () => {
  it('lista o que tem saldo e não vendeu no período, com o dinheiro parado', async () => {
    const c = await cenario();
    const parado = await criarProduto(c.loja.id, { nome: 'Encalhado', estoque: 10 }); // custo 5
    const gira = await criarProduto(c.loja.id, { nome: 'Gira', estoque: 10 });
    const semSaldo = await criarProduto(c.loja.id, { nome: 'Acabou', estoque: 0 });
    await vender(c.auth, gira.id, 1);

    const r = await request(app).get('/api/relatorios/estoque-parado?dias=30').set(c.auth);
    const nomes = r.body.itens.map((i: { nome: string }) => i.nome);
    expect(nomes).toContain('Encalhado');
    expect(nomes).not.toContain('Gira');
    expect(nomes).not.toContain('Acabou');
    expect(r.body.itens.find((i: { nome: string }) => i.nome === 'Encalhado').valorParado).toBe(50);
    void parado;
    void semSaldo;
  });

  it('exige a permissão de relatórios', async () => {
    const c = await cenario();
    const op = await criarUsuario(c.loja.id, 'OPERADOR_CAIXA', ['pdv']);
    expect((await request(app).get('/api/relatorios/estoque-parado').set((await entrar(op.email)).auth)).status).toBe(403);
  });
});
