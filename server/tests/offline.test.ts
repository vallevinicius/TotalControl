import { describe, expect, it } from 'vitest';
import { abrirCaixa, app, criarEmpresa, criarProduto, entrar, prisma, request } from './helpers/index.js';

async function cenario() {
  const { loja, dono } = await criarEmpresa({ plano: 'PRO' });
  await abrirCaixa(loja.id, dono.id);
  const { auth } = await entrar(dono.email);
  return { loja, auth };
}
const vender = (auth: Record<string, string>, corpo: object) => request(app).post('/api/vendas').set(auth).send(corpo);

describe('venda vinda do PDV offline (idLocal)', () => {
  it('reenviar a mesma venda não duplica nem baixa o estoque de novo', async () => {
    const { loja, auth } = await cenario();
    const p = await criarProduto(loja.id, { preco: 10, estoque: 10 });
    const corpo = { itens: [{ productId: p.id, quantidade: 2 }], formaPagamento: 'PIX', idLocal: 'local-aaaa-0001' };

    const a = await vender(auth, corpo);
    const b = await vender(auth, corpo);
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(await prisma.transacao.count({ where: { tenantId: loja.id, idLocal: 'local-aaaa-0001' } })).toBe(1);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(8);
  });

  it('duas requisições simultâneas com o mesmo id geram uma venda só', async () => {
    const { loja, auth } = await cenario();
    const p = await criarProduto(loja.id, { preco: 10, estoque: 10 });
    const corpo = { itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'PIX', idLocal: 'local-bbbb-0002' };
    const rs = await Promise.all([vender(auth, corpo), vender(auth, corpo), vender(auth, corpo)]);
    expect(rs.every((r) => r.status === 200 || r.status === 201)).toBe(true);
    expect(await prisma.transacao.count({ where: { tenantId: loja.id, idLocal: 'local-bbbb-0002' } })).toBe(1);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(9);
  });

  it('guarda o horário real da venda; horário absurdo é ignorado', async () => {
    const { loja, auth } = await cenario();
    const p = await criarProduto(loja.id, { preco: 10, estoque: 10 });
    const duasHorasAtras = new Date(Date.now() - 2 * 3_600_000);
    const a = await vender(auth, { itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'PIX', idLocal: 'local-cccc-0003', vendidaEm: duasHorasAtras.toISOString() });
    expect(new Date(a.body.timestamp).getTime()).toBe(duasHorasAtras.getTime());
    const futuro = new Date(Date.now() + 86_400_000);
    const b = await vender(auth, { itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'PIX', idLocal: 'local-dddd-0004', vendidaEm: futuro.toISOString() });
    expect(new Date(b.body.timestamp).getTime()).toBeLessThan(Date.now() + 60_000);
    // Sem idLocal o horário enviado é ignorado.
    const c = await vender(auth, { itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'PIX', vendidaEm: duasHorasAtras.toISOString() });
    expect(new Date(c.body.timestamp).getTime()).toBeGreaterThan(duasHorasAtras.getTime() + 3_600_000);
  });

  it('venda da fila sem saldo é registrada, zera o estoque (sem negativo) e avisa; venda online continua recusando', async () => {
    const { loja, auth } = await cenario();
    const p = await criarProduto(loja.id, { preco: 10, estoque: 2 });
    const r = await vender(auth, { itens: [{ productId: p.id, quantidade: 5 }], formaPagamento: 'PIX', idLocal: 'local-eeee-0005' });
    expect(r.status).toBe(201);
    expect(r.body.avisos[0]).toContain('divergente');
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(0);
    expect(await prisma.registroAuditoria.count({ where: { tenantId: loja.id, acao: 'venda.estoque_divergente' } })).toBe(1);

    const online = await vender(auth, { itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'PIX' });
    expect(online.status).toBe(400);
  });

  it('idLocal de outra loja não colide', async () => {
    const a = await cenario();
    const b = await cenario();
    const pa = await criarProduto(a.loja.id, { estoque: 5 });
    const pb = await criarProduto(b.loja.id, { estoque: 5 });
    expect((await vender(a.auth, { itens: [{ productId: pa.id, quantidade: 1 }], formaPagamento: 'PIX', idLocal: 'mesmo-id-0006' })).status).toBe(201);
    expect((await vender(b.auth, { itens: [{ productId: pb.id, quantidade: 1 }], formaPagamento: 'PIX', idLocal: 'mesmo-id-0006' })).status).toBe(201);
  });
});
