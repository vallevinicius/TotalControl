import { describe, expect, it } from 'vitest';
import { app, criarEmpresa, criarProduto, cnpjValidoUnico, entrar, prisma, request } from './helpers/index.js';

async function segundaLoja(empresaId: string, donoId: string) {
  const loja = await prisma.tenant.create({ data: { empresaId, nomeFantasia: 'Filial', cnpj: cnpjValidoUnico(), logoDaLojaUrl: 'https://exemplo.test/logo.png', corPrincipalDoTema: '#10B981' } });
  await prisma.categoria.create({ data: { tenantId: loja.id, nome: 'Geral' } });
  await prisma.acessoLoja.create({ data: { usuarioId: donoId, tenantId: loja.id } });
  return loja;
}

describe('transferência de estoque entre lojas', () => {
  it('move o saldo, cria o produto na filial e registra as duas pontas', async () => {
    const { empresa, loja, dono } = await criarEmpresa({ plano: 'ENTERPRISE' });
    const filial = await segundaLoja(empresa.id, dono.id);
    const p = await criarProduto(loja.id, { estoque: 10 });
    const { auth } = await entrar(dono.email);

    expect((await request(app).get('/api/estoque/lojas-destino').set(auth)).body).toEqual([{ id: filial.id, nomeFantasia: 'Filial' }]);
    const r = await request(app).post('/api/estoque/transferir').set(auth).send({ destinoTenantId: filial.id, itens: [{ productId: p.id, quantidade: 4 }] });
    expect(r.status).toBe(201);

    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(6);
    const nova = await prisma.produto.findFirstOrThrow({ where: { tenantId: filial.id, sku: p.sku } });
    expect(nova.quantidadeEmEstoque).toBe(4);
    expect(await prisma.movimentacaoEstoque.count({ where: { tipo: 'TRANSFERENCIA', produtoId: { in: [p.id, nova.id] } } })).toBe(2);

    // Segunda transferência soma no produto que já existe lá.
    await request(app).post('/api/estoque/transferir').set(auth).send({ destinoTenantId: filial.id, itens: [{ productId: p.id, quantidade: 6 }] });
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: nova.id } })).quantidadeEmEstoque).toBe(10);
  });

  it('recusa saldo insuficiente (nada muda) e loja de outra empresa', async () => {
    const a = await criarEmpresa({ plano: 'ENTERPRISE' });
    const b = await criarEmpresa({ plano: 'ENTERPRISE' });
    const filial = await segundaLoja(a.empresa.id, a.dono.id);
    const p = await criarProduto(a.loja.id, { estoque: 3 });
    const { auth } = await entrar(a.dono.email);

    const r = await request(app).post('/api/estoque/transferir').set(auth).send({ destinoTenantId: filial.id, itens: [{ productId: p.id, quantidade: 5 }] });
    expect(r.status).toBe(400);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(3);

    const alheia = await request(app).post('/api/estoque/transferir').set(auth).send({ destinoTenantId: b.loja.id, itens: [{ productId: p.id, quantidade: 1 }] });
    expect(alheia.status).toBe(403);
  });

  it('plano sem multi-loja não transfere', async () => {
    const { loja, dono } = await criarEmpresa({ plano: 'PRO' });
    const p = await criarProduto(loja.id);
    const { auth } = await entrar(dono.email);
    expect((await request(app).post('/api/estoque/transferir').set(auth).send({ destinoTenantId: 'x', itens: [{ productId: p.id, quantidade: 1 }] })).status).toBe(403);
  });
});
