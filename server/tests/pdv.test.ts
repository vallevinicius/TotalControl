import { describe, expect, it } from 'vitest';
import { abrirCaixa, app, criarEmpresa, criarProduto, criarUsuario, entrar, prisma, request } from './helpers/index.js';

async function cenario() {
  const { loja, dono } = await criarEmpresa({ plano: 'PRO' });
  const caixa = await abrirCaixa(loja.id, dono.id);
  const operador = await criarUsuario(loja.id, 'OPERADOR_CAIXA', ['dashboard', 'pdv']);
  const gerente = await criarUsuario(loja.id, 'GERENTE', ['pdv', 'estoque']);
  return {
    loja,
    caixa,
    dono: await entrar(dono.email),
    operador: await entrar(operador.email),
    gerente: await entrar(gerente.email),
  };
}

const venda = (productId: string, extra: object = {}, qtd = 1, preco?: number) => ({
  itens: [{ productId, quantidade: qtd, precoUnitario: preco }],
  formaPagamento: 'PIX',
  ...extra,
});

describe('regras de preço e desconto no PDV', () => {
  it('operador vende no preço cadastrado e com até 5% de desconto', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10 });
    expect((await request(app).post('/api/vendas').set(c.operador.auth).send(venda(p.id, {}, 1, 10))).status).toBe(201);
    // 5% de 100 = 5
    expect((await request(app).post('/api/vendas').set(c.operador.auth).send(venda(p.id, { desconto: 5 }, 10, 10))).status).toBe(201);
  });

  it('operador não altera o preço nem passa de 5% de desconto', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10 });
    const preco = await request(app).post('/api/vendas').set(c.operador.auth).send(venda(p.id, {}, 1, 1));
    expect(preco.status).toBe(400);
    expect(preco.body.erro).toMatch(/preço/i);
    const desc = await request(app).post('/api/vendas').set(c.operador.auth).send(venda(p.id, { desconto: 6 }, 10, 10));
    expect(desc.status).toBe(400);
    expect(desc.body.erro).toMatch(/5%/);
  });

  it('gerente pode mudar o preço e dar até 20%; acima disso não', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10 });
    expect((await request(app).post('/api/vendas').set(c.gerente.auth).send(venda(p.id, {}, 1, 8))).status).toBe(201);
    expect((await request(app).post('/api/vendas').set(c.gerente.auth).send(venda(p.id, { desconto: 20 }, 10, 10))).status).toBe(201);
    expect((await request(app).post('/api/vendas').set(c.gerente.auth).send(venda(p.id, { desconto: 21 }, 10, 10))).status).toBe(400);
  });

  it('ninguém dá desconto maior que a venda, e os ajustes ficam na auditoria', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10 });
    expect((await request(app).post('/api/vendas').set(c.dono.auth).send(venda(p.id, { desconto: 50 }, 1, 10))).status).toBe(400);
    await request(app).post('/api/vendas').set(c.gerente.auth).send(venda(p.id, { desconto: 10 }, 10, 10));
    const log = await prisma.registroAuditoria.findFirst({ where: { tenantId: c.loja.id, acao: 'venda.ajuste' } });
    expect(log?.detalhe).toMatch(/desconto 10\.0%/);
  });

  it('exige caixa aberto', async () => {
    const { loja, dono } = await criarEmpresa();
    const p = await criarProduto(loja.id);
    const { auth } = await entrar(dono.email);
    expect((await request(app).post('/api/vendas').set(auth).send(venda(p.id))).status).toBe(400);
  });
});

describe('estoque', () => {
  it('baixa o estoque na venda e recusa quando não há saldo', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { estoque: 3 });
    expect((await request(app).post('/api/vendas').set(c.dono.auth).send(venda(p.id, {}, 2))).status).toBe(201);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(1);
    expect((await request(app).post('/api/vendas').set(c.dono.auth).send(venda(p.id, {}, 2))).status).toBe(400);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(1);
  });

  it('vendas simultâneas do último item: só uma passa e o saldo nunca fica negativo', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { estoque: 1 });
    const respostas = await Promise.all(
      Array.from({ length: 8 }, () => request(app).post('/api/vendas').set(c.dono.auth).send(venda(p.id))),
    );
    const ok = respostas.filter((r) => r.status === 201).length;
    expect(ok).toBe(1);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(0);
    expect(await prisma.transacao.count({ where: { tenantId: c.loja.id, tipo: 'SAIDA' } })).toBe(1);
  });

  it('desfazer a última venda devolve o estoque', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { estoque: 5 });
    await request(app).post('/api/vendas').set(c.dono.auth).send(venda(p.id, {}, 2));
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(3);
    expect((await request(app).post('/api/vendas/ultima/desfazer').set(c.dono.auth)).status).toBeLessThan(300);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(5);
  });
});

describe('comprovante e senha do caixa', () => {
  it('a lista de vendas do turno traz o detalhe para reemitir o comprovante', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { nome: 'Café', preco: 7.5 });
    await request(app).post('/api/vendas').set(c.dono.auth).send(venda(p.id, { desconto: 1.5 }, 2, 7.5));
    const r = await request(app).get(`/api/caixa/${c.caixa.id}/vendas`).set(c.dono.auth);
    expect(r.status).toBe(200);
    expect(r.body[0]).toMatchObject({ desconto: 1.5, valorTotal: 13.5, itens: [{ nome: 'Café', quantidade: 2, valorUnitario: 7.5, subtotal: 15 }] });
  });

  it('com "exigir senha ao abrir o caixa", sem a senha certa o caixa não abre', async () => {
    const { loja, dono } = await criarEmpresa();
    await prisma.tenant.update({ where: { id: loja.id }, data: { exigirSenhaAoAbrirCaixa: true } });
    const { auth } = await entrar(dono.email);
    expect((await request(app).post('/api/caixa/abrir').set(auth).send({ valorAbertura: 50 })).status).toBe(403);
    expect((await request(app).post('/api/caixa/abrir').set(auth).send({ valorAbertura: 50, senha: 'errada' })).status).toBe(403);
    expect((await request(app).post('/api/caixa/abrir').set(auth).send({ valorAbertura: 50, senha: 'Teste@123' })).status).toBe(201);
  });
});
