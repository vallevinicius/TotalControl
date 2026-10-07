import { describe, expect, it } from 'vitest';
import { app, criarEmpresa, criarProduto, criarUsuario, entrar, prisma, request } from './helpers/index.js';

describe('permissões aplicadas no servidor', () => {
  it('operador de caixa (dashboard + pdv) lê o que o PDV precisa, mas não altera nem vê o resto', async () => {
    const { loja } = await criarEmpresa({ plano: 'PRO' });
    const produto = await criarProduto(loja.id);
    const cliente = await prisma.cliente.create({ data: { tenantId: loja.id, nome: 'Cliente' } });
    const op = await criarUsuario(loja.id, 'OPERADOR_CAIXA', ['dashboard', 'pdv']);
    const { auth } = await entrar(op.email);

    // O PDV lê produtos, clientes e o resumo do dashboard...
    expect((await request(app).get('/api/produtos').set(auth)).status).toBe(200);
    expect((await request(app).get('/api/clientes').set(auth)).status).toBe(200);
    expect((await request(app).get('/api/dashboard/resumo').set(auth)).status).toBe(200);

    // ...mas não altera estoque nem cadastros.
    expect((await request(app).post('/api/produtos').set(auth).send({})).status).toBe(403);
    expect((await request(app).put(`/api/produtos/${produto.id}`).set(auth).send({ nome: 'X' })).status).toBe(403);
    expect((await request(app).delete(`/api/produtos/${produto.id}`).set(auth)).status).toBe(403);
    expect((await request(app).post('/api/estoque/entrada').set(auth).send({ productId: produto.id, quantidade: 1 })).status).toBe(403);
    expect((await request(app).delete(`/api/clientes/${cliente.id}`).set(auth)).status).toBe(403);
    expect((await request(app).get('/api/produtos/sugestao-reposicao').set(auth)).status).toBe(403);

    // Áreas inteiras fora das permissões.
    for (const rota of ['/api/financeiro/resumo', '/api/relatorios/vendas', '/api/usuarios', '/api/lojas', '/api/auditoria']) {
      expect((await request(app).get(rota).set(auth)).status, rota).toBe(403);
    }
  });

  it('gerente com permissões parciais só acessa as telas liberadas', async () => {
    const { loja } = await criarEmpresa({ plano: 'PRO' });
    const g = await criarUsuario(loja.id, 'GERENTE', ['pdv', 'estoque']);
    const { auth } = await entrar(g.email);
    expect((await request(app).post('/api/estoque/entrada').set(auth).send({ productId: 'x', quantidade: 1 })).status).not.toBe(403);
    expect((await request(app).get('/api/financeiro/resumo').set(auth)).status).toBe(403);
    expect((await request(app).get('/api/relatorios/vendas').set(auth)).status).toBe(403);
  });

  it('administrador da loja tem acesso a tudo que o plano inclui', async () => {
    const { dono } = await criarEmpresa({ plano: 'PRO' });
    const { auth } = await entrar(dono.email);
    for (const rota of ['/api/produtos', '/api/clientes', '/api/usuarios', '/api/dashboard/resumo']) {
      expect((await request(app).get(rota).set(auth)).status, rota).toBe(200);
    }
  });

  it('mudar a permissão vale na hora, sem esperar novo login', async () => {
    const { loja } = await criarEmpresa();
    const op = await criarUsuario(loja.id, 'OPERADOR_CAIXA', ['pdv']);
    const { auth } = await entrar(op.email);
    expect((await request(app).get('/api/dashboard/resumo').set(auth)).status).toBe(200); // pdv lê o resumo (estoque baixo)
    expect((await request(app).get('/api/clientes').set(auth)).status).toBe(200);
    await prisma.usuario.update({ where: { id: op.id }, data: { permissoes: ['estoque'] } });
    expect((await request(app).post('/api/vendas').set(auth).send({ itens: [], formaPagamento: 'PIX' })).status).toBe(403);
  });

  it('só administradores criam usuários', async () => {
    const { loja } = await criarEmpresa();
    const g = await criarUsuario(loja.id, 'GERENTE');
    const { auth } = await entrar(g.email);
    const r = await request(app).post('/api/usuarios').set(auth).send({ nome: 'Novo', email: 'novo@teste.local', senha: 'Teste@123', papel: 'OPERADOR_CAIXA' });
    expect(r.status).toBe(403);
  });
});

describe('isolamento entre lojas', () => {
  it('uma loja não enxerga nem altera dados de outra', async () => {
    const a = await criarEmpresa();
    const b = await criarEmpresa();
    const produtoDeB = await criarProduto(b.loja.id);
    const clienteDeB = await prisma.cliente.create({ data: { tenantId: b.loja.id, nome: 'Cliente de B' } });
    const { auth } = await entrar(a.dono.email);

    expect((await request(app).get(`/api/produtos/${produtoDeB.id}`).set(auth)).status).toBe(404);
    expect((await request(app).put(`/api/produtos/${produtoDeB.id}`).set(auth).send({ nome: 'Invadido' })).status).toBe(404);
    expect((await request(app).delete(`/api/produtos/${produtoDeB.id}`).set(auth)).status).toBe(404);
    expect((await request(app).put(`/api/clientes/${clienteDeB.id}`).set(auth).send({ nome: 'Invadido' })).status).toBe(404);
    expect((await request(app).get(`/api/clientes/${clienteDeB.id}/historico`).set(auth)).status).toBe(404);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: produtoDeB.id } })).nome).not.toBe('Invadido');

    const lista = await request(app).get('/api/produtos').set(auth);
    expect(JSON.stringify(lista.body)).not.toContain(produtoDeB.id);
  });

  it('não dá pra apontar um produto para a categoria de outra empresa', async () => {
    const a = await criarEmpresa();
    const b = await criarEmpresa();
    const produto = await criarProduto(a.loja.id);
    const categoriaDeB = await prisma.categoria.findFirstOrThrow({ where: { tenantId: b.loja.id } });
    const { auth } = await entrar(a.dono.email);
    expect((await request(app).put(`/api/produtos/${produto.id}`).set(auth).send({ categoriaId: categoriaDeB.id })).status).toBe(400);
  });
});
