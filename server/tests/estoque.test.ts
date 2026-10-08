import { describe, expect, it } from 'vitest';
import { abrirCaixa, app, criarEmpresa, criarProduto, criarUsuario, entrar, prisma, request } from './helpers/index.js';

async function cenario(plano: 'STARTER' | 'PRO' = 'PRO') {
  const e = await criarEmpresa({ plano });
  const sessao = await entrar(e.dono.email);
  return { ...e, ...sessao };
}

const movimentos = async (auth: object, id: string) => (await request(app).get(`/api/produtos/${id}/movimentacoes`).set(auth)).body.itens as Array<{ tipo: string; quantidade: number; saldoApos: number; motivo?: string; usuarioNome?: string }>;

describe('histórico de movimentações do estoque', () => {
  it('registra cadastro, entrada, venda, estorno e ajuste, com o saldo depois de cada um', async () => {
    const c = await cenario();
    await abrirCaixa(c.loja.id, c.dono.id);
    const cat = await prisma.categoria.findFirstOrThrow({ where: { tenantId: c.loja.id } });
    const criado = await request(app).post('/api/produtos').set(c.auth).send({ nome: 'Item', sku: 'MOV-1', categoriaId: cat.id, precoCusto: 5, precoVenda: 10, quantidadeEmEstoque: 10, estoqueMinimo: 1 });
    const id = criado.body.id as string;

    await request(app).post('/api/estoque/entrada').set(c.auth).send({ productId: id, quantidade: 5, observacao: 'Compra do fornecedor' });
    await request(app).post('/api/vendas').set(c.auth).send({ itens: [{ productId: id, quantidade: 3 }], formaPagamento: 'PIX' });
    expect((await request(app).post('/api/vendas/ultima/desfazer').set(c.auth)).status).toBeLessThan(300);
    const ajuste = await request(app).post('/api/estoque/ajuste').set(c.auth).send({ productId: id, novaQuantidade: 12, motivo: 'Contagem do inventário' });
    expect(ajuste.body).toMatchObject({ quantidadeEmEstoque: 12, diferenca: -3 });

    const lista = await movimentos(c.auth, id);
    expect(lista.map((m) => [m.tipo, m.quantidade, m.saldoApos])).toEqual([
      ['AJUSTE', -3, 12],
      ['ESTORNO', 3, 15],
      ['VENDA', -3, 12],
      ['ENTRADA', 5, 15],
      ['INICIAL', 10, 10],
    ]);
    expect(lista[0]).toMatchObject({ motivo: 'Contagem do inventário', usuarioNome: 'Dono' });
  });

  it('o saldo não pode ser editado pelo cadastro do produto (só por entrada, venda ou ajuste)', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { estoque: 10 });
    await request(app).put(`/api/produtos/${p.id}`).set(c.auth).send({ nome: 'Renomeado', quantidadeEmEstoque: 999 });
    const salvo = await prisma.produto.findUniqueOrThrow({ where: { id: p.id } });
    expect(salvo.nome).toBe('Renomeado');
    expect(salvo.quantidadeEmEstoque).toBe(10);
  });
});

describe('ajuste de inventário', () => {
  it('exige motivo, quantidade diferente da atual e perfil de gerente ou administrador', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { estoque: 10 });
    expect((await request(app).post('/api/estoque/ajuste').set(c.auth).send({ productId: p.id, novaQuantidade: 8, motivo: '' })).status).toBe(400);
    expect((await request(app).post('/api/estoque/ajuste').set(c.auth).send({ productId: p.id, novaQuantidade: 10, motivo: 'Sem mudança' })).status).toBe(400);
    expect((await request(app).post('/api/estoque/ajuste').set(c.auth).send({ productId: p.id, novaQuantidade: -1, motivo: 'Negativo' })).status).toBe(400);

    const op = await criarUsuario(c.loja.id, 'OPERADOR_CAIXA', ['estoque']);
    const r = await request(app).post('/api/estoque/ajuste').set((await entrar(op.email)).auth).send({ productId: p.id, novaQuantidade: 1, motivo: 'Tentativa de esconder desvio' });
    expect(r.status).toBe(403);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(10);
  });

  it('o ajuste vai para a auditoria', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { estoque: 10, nome: 'Garrafa' });
    await request(app).post('/api/estoque/ajuste').set(c.auth).send({ productId: p.id, novaQuantidade: 7, motivo: 'Quebra' });
    const log = await prisma.registroAuditoria.findFirstOrThrow({ where: { tenantId: c.loja.id, acao: 'estoque.ajuste' } });
    expect(log.detalhe).toMatch(/Garrafa: -3 \(Quebra\)/);
  });
});

describe('categorias', () => {
  it('renomeia, recusa nome repetido e só exclui categoria sem produtos', async () => {
    const c = await cenario();
    const a = await prisma.categoria.create({ data: { tenantId: c.loja.id, nome: 'Bebidas' } });
    const b = await prisma.categoria.create({ data: { tenantId: c.loja.id, nome: 'Limpeza' } });
    expect((await request(app).put(`/api/categorias/${a.id}`).set(c.auth).send({ nome: 'Bebidas geladas' })).status).toBe(200);
    expect((await request(app).put(`/api/categorias/${a.id}`).set(c.auth).send({ nome: 'Limpeza' })).status).toBe(409);

    await prisma.produto.create({ data: { tenantId: c.loja.id, nome: 'Água', sku: 'AG-1', categoriaId: a.id, precoCusto: 1, precoVenda: 2, quantidadeEmEstoque: 1, estoqueMinimo: 0 } });
    expect((await request(app).delete(`/api/categorias/${a.id}`).set(c.auth)).status).toBe(409);
    expect((await request(app).delete(`/api/categorias/${b.id}`).set(c.auth)).status).toBe(204);
  });

  it('não mexe em categoria de outra empresa', async () => {
    const a = await cenario();
    const b = await cenario();
    const categoriaDeB = await prisma.categoria.findFirstOrThrow({ where: { tenantId: b.loja.id } });
    expect((await request(app).put(`/api/categorias/${categoriaDeB.id}`).set(a.auth).send({ nome: 'Invadida' })).status).toBe(404);
    expect((await request(app).delete(`/api/categorias/${categoriaDeB.id}`).set(a.auth)).status).toBe(404);
  });
});

describe('inativar e reativar produto', () => {
  it('produto excluído some da lista normal, aparece em inativos e pode voltar', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { nome: 'Volta e meia' });
    expect((await request(app).delete(`/api/produtos/${p.id}`).set(c.auth)).status).toBeLessThan(300);

    const ativos = await request(app).get('/api/produtos').set(c.auth);
    expect(JSON.stringify(ativos.body)).not.toContain(p.id);
    const inativos = await request(app).get('/api/produtos?inativos=1').set(c.auth);
    expect(inativos.body.itens.map((i: { id: string }) => i.id)).toContain(p.id);

    expect((await request(app).patch(`/api/produtos/${p.id}/ativo`).set(c.auth).send({ ativo: true })).status).toBe(200);
    expect(JSON.stringify((await request(app).get('/api/produtos').set(c.auth)).body)).toContain(p.id);
  });

  it('reativar respeita o limite de produtos do plano', async () => {
    const c = await cenario('STARTER'); // 300 produtos
    const inativo = await criarProduto(c.loja.id);
    await prisma.produto.update({ where: { id: inativo.id }, data: { ativo: false } });
    const cat = await prisma.categoria.findFirstOrThrow({ where: { tenantId: c.loja.id } });
    await prisma.produto.createMany({
      data: Array.from({ length: 300 }, (_, i) => ({ tenantId: c.loja.id, nome: `P${i}`, sku: `LIM-${i}`, categoriaId: cat.id, precoCusto: 1, precoVenda: 2, quantidadeEmEstoque: 1, estoqueMinimo: 0 })),
    });
    expect((await request(app).patch(`/api/produtos/${inativo.id}/ativo`).set(c.auth).send({ ativo: true })).status).toBe(403);
  });
});

describe('importar clientes', () => {
  it('cria os novos e ignora quem já existe (mesmo CPF), inclusive repetido no arquivo', async () => {
    const c = await cenario();
    await prisma.cliente.create({ data: { tenantId: c.loja.id, nome: 'Já existe', cpfCnpj: '529.982.247-25' } });
    const r = await request(app).post('/api/clientes/importar').set(c.auth).send({
      clientes: [
        { nome: 'Novo 1', telefone: '22999990000', cpfCnpj: '111.444.777-35' },
        { nome: 'Repetido no arquivo', cpfCnpj: '11144477735' },
        { nome: 'Já existe de novo', cpfCnpj: '52998224725' },
        { nome: 'Sem documento', email: 'x@y.com' },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({ criados: 2, ignorados: 2 });
    expect(await prisma.cliente.count({ where: { tenantId: c.loja.id } })).toBe(3);
  });

  it('recusa arquivo com e-mail inválido e exige a permissão de clientes', async () => {
    const c = await cenario();
    expect((await request(app).post('/api/clientes/importar').set(c.auth).send({ clientes: [{ nome: 'A', email: 'nao-e-email' }] })).status).toBe(400);
    const op = await criarUsuario(c.loja.id, 'OPERADOR_CAIXA', ['pdv']);
    expect((await request(app).post('/api/clientes/importar').set((await entrar(op.email)).auth).send({ clientes: [{ nome: 'A' }] })).status).toBe(403);
  });
});
