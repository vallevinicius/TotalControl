import { describe, expect, it } from 'vitest';
import { abrirCaixa, app, criarEmpresa, criarProduto, criarUsuario, entrar, prisma, request } from './helpers/index.js';

async function cenario() {
  const e = await criarEmpresa({ plano: 'PRO' });
  const caixa = await abrirCaixa(e.loja.id, e.dono.id);
  return { ...e, caixa, sessao: await entrar(e.dono.email) };
}

const vender = (auth: object, corpo: object) => request(app).post('/api/vendas').set(auth).send(corpo);
const resumo = async (auth: object) => (await request(app).get('/api/caixa/atual').set(auth)).body.resumo;

describe('pagamento dividido e parcelas', () => {
  it('divide a venda entre formas e o caixa soma cada uma no lugar certo', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 100 });
    const r = await vender(c.sessao.auth, { itens: [{ productId: p.id, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 60 }, { forma: 'DINHEIRO', valor: 40 }] });
    expect(r.status).toBe(201);
    expect(r.body.pagamentos).toHaveLength(2);
    expect(r.body).toMatchObject({ valorTotal: 100, taxas: 0, formaPagamento: 'PIX' }); // principal = a maior parte
    expect((await resumo(c.sessao.auth)).totaisPorFormaPagamento).toEqual({ PIX: 60, DINHEIRO: 40 });
  });

  it('recusa quando a soma das formas não fecha com a venda', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 100 });
    const r = await vender(c.sessao.auth, { itens: [{ productId: p.id, quantidade: 1 }], pagamentos: [{ forma: 'PIX', valor: 60 }, { forma: 'DINHEIRO', valor: 30 }] });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/não bate/);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(50);
  });

  it('a taxa do cartão é calculada no servidor, só sobre a parte do crédito', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 100 });
    // O cliente tenta mandar uma taxa inventada: é ignorada.
    const r = await vender(c.sessao.auth, { itens: [{ productId: p.id, quantidade: 1 }], taxas: 999, pagamentos: [{ forma: 'DINHEIRO', valor: 50 }, { forma: 'CARTAO_CREDITO', valor: 50, parcelas: 6 }] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ taxas: 2.5, valorTotal: 102.5, parcelas: 6 });
    // O total do caixa por forma fecha com o valor da venda: o crédito leva a taxa (50 + 2,5).
    expect((await resumo(c.sessao.auth)).totaisPorFormaPagamento).toEqual({ DINHEIRO: 50, CARTAO_CREDITO: 52.5 });
  });

  it('aceita até 12 parcelas no crédito', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 100, estoque: 10 });
    const corpo = (n: number) => ({ itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'CARTAO_CREDITO', parcelas: n });
    // Até 3x não tem juros; de 4x em diante sim.
    expect((await vender(c.sessao.auth, corpo(3))).body).toMatchObject({ parcelas: 3, taxas: 0, valorTotal: 100 });
    expect((await vender(c.sessao.auth, corpo(12))).body).toMatchObject({ parcelas: 12, taxas: 5, valorTotal: 105 });
    expect((await vender(c.sessao.auth, corpo(13))).status).toBe(400);
  });

  it('o jeito antigo (uma forma só) continua funcionando', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10 });
    const r = await vender(c.sessao.auth, { itens: [{ productId: p.id, quantidade: 3 }], formaPagamento: 'DINHEIRO' });
    expect(r.status).toBe(201);
    expect(r.body.pagamentos).toEqual([{ forma: 'DINHEIRO', valor: 30, parcelas: 1 }]);
  });
});

describe('cancelar venda', () => {
  it('só com a ação; devolve o estoque, tira a venda de todos os totais e guarda o motivo', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10, estoque: 20 });
    const venda = (await vender(c.sessao.auth, { itens: [{ productId: p.id, quantidade: 5 }], formaPagamento: 'PIX' })).body;
    await vender(c.sessao.auth, { itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'PIX' });

    const op = await criarUsuario(c.loja.id, 'OPERADOR_CAIXA', ['pdv']);
    const sOp = await entrar(op.email);
    expect((await request(app).post(`/api/vendas/${venda.id}/cancelar`).set(sOp.auth).send({ motivo: 'Cliente desistiu' })).status).toBe(403);

    expect((await request(app).post(`/api/vendas/${venda.id}/cancelar`).set(c.sessao.auth).send({ motivo: '' })).status).toBe(400);
    expect((await request(app).post(`/api/vendas/${venda.id}/cancelar`).set(c.sessao.auth).send({ motivo: 'Cliente desistiu' })).status).toBe(204);

    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(19); // 20 - 5 - 1 + 5
    const salva = await prisma.transacao.findUniqueOrThrow({ where: { id: venda.id } });
    expect(salva).toMatchObject({ cancelada: true, motivoCancelamento: 'Cliente desistiu', canceladaPorId: c.dono.id });

    // Fora do caixa, dos relatórios, do dashboard e do financeiro: só a venda de R$ 10 vale.
    expect(await resumo(c.sessao.auth)).toMatchObject({ totalVendido: 10, quantidadeVendas: 1 });
    const dia = new Date().toISOString().slice(0, 10);
    const amanha = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect((await request(app).get(`/api/relatorios/vendas?inicio=${dia}&fim=${amanha}`).set(c.sessao.auth)).body).toMatchObject({ faturamentoTotal: 10, quantidadeVendas: 1 });
    expect((await request(app).get('/api/dashboard/resumo').set(c.sessao.auth)).body).toMatchObject({ faturamentoDoDia: 10 });
    expect((await request(app).get(`/api/financeiro/resumo?inicio=${dia}&fim=${amanha}`).set(c.sessao.auth)).body.receitaVendas).toBe(10);
    // A lista do turno ainda mostra a cancelada, marcada como tal.
    const lista = (await request(app).get(`/api/caixa/${c.caixa.id}/vendas`).set(c.sessao.auth)).body;
    expect(lista.find((v: { id: string }) => v.id === venda.id)).toMatchObject({ cancelada: true, motivoCancelamento: 'Cliente desistiu' });
    // Histórico do produto e auditoria.
    const mov = (await request(app).get(`/api/produtos/${p.id}/movimentacoes`).set(c.sessao.auth)).body.itens[0];
    expect(mov).toMatchObject({ tipo: 'ESTORNO', quantidade: 5 });
    expect(mov.motivo).toMatch(/Cliente desistiu/);
    expect(await prisma.registroAuditoria.count({ where: { tenantId: c.loja.id, acao: 'venda.cancelar' } })).toBe(1);
  });

  it('não cancela duas vezes nem vendas de caixa já fechado', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10 });
    const venda = (await vender(c.sessao.auth, { itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'PIX' })).body;
    expect((await request(app).post(`/api/vendas/${venda.id}/cancelar`).set(c.sessao.auth).send({ motivo: 'Engano' })).status).toBe(204);
    expect((await request(app).post(`/api/vendas/${venda.id}/cancelar`).set(c.sessao.auth).send({ motivo: 'Engano' })).status).toBe(409);

    const outra = (await vender(c.sessao.auth, { itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'PIX' })).body;
    await request(app).post(`/api/caixa/${c.caixa.id}/fechar`).set(c.sessao.auth).send({});
    const tarde = await request(app).post(`/api/vendas/${outra.id}/cancelar`).set(c.sessao.auth).send({ motivo: 'Tarde demais' });
    expect(tarde.status).toBe(409);
    expect(tarde.body.erro).toMatch(/caixa aberto/);
  });

  it('cancelamentos simultâneos da mesma venda devolvem o estoque uma vez só', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10, estoque: 10 });
    const venda = (await vender(c.sessao.auth, { itens: [{ productId: p.id, quantidade: 4 }], formaPagamento: 'PIX' })).body;
    const respostas = await Promise.all(Array.from({ length: 5 }, () => request(app).post(`/api/vendas/${venda.id}/cancelar`).set(c.sessao.auth).send({ motivo: 'Duplo clique' })));
    expect(respostas.filter((r) => r.status === 204)).toHaveLength(1);
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(10);
  });

  it('"desfazer" agora cancela (a venda fica registrada) e vale pra qualquer operador do PDV', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { preco: 10, estoque: 10 });
    const op = await criarUsuario(c.loja.id, 'OPERADOR_CAIXA', ['pdv']);
    const sOp = await entrar(op.email);
    const venda = (await vender(sOp.auth, { itens: [{ productId: p.id, quantidade: 2 }], formaPagamento: 'PIX' })).body;
    expect((await request(app).post('/api/vendas/ultima/desfazer').set(sOp.auth)).status).toBe(204);
    expect(await prisma.transacao.findUniqueOrThrow({ where: { id: venda.id } })).toMatchObject({ cancelada: true });
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).quantidadeEmEstoque).toBe(10);
  });
});

describe('sangria e suprimento', () => {
  const movimento = (auth: object, caixaId: string, corpo: object) => request(app).post(`/api/caixa/${caixaId}/movimentos`).set(auth).send(corpo);

  it('exige a ação, e o dinheiro esperado na gaveta acompanha vendas, suprimentos e sangrias', async () => {
    const c = await cenario(); // abertura R$ 0
    const p = await criarProduto(c.loja.id, { preco: 100 });
    await vender(c.sessao.auth, { itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'DINHEIRO' });
    await vender(c.sessao.auth, { itens: [{ productId: p.id, quantidade: 1 }], formaPagamento: 'PIX' }); // PIX não entra na gaveta

    const op = await criarUsuario(c.loja.id, 'OPERADOR_CAIXA', ['pdv']);
    expect((await movimento((await entrar(op.email)).auth, c.caixa.id, { tipo: 'SANGRIA', valor: 10, motivo: 'Cofre' })).status).toBe(403);

    expect((await movimento(c.sessao.auth, c.caixa.id, { tipo: 'SUPRIMENTO', valor: 50, motivo: 'Troco' })).status).toBe(201);
    expect((await movimento(c.sessao.auth, c.caixa.id, { tipo: 'SANGRIA', valor: 120, motivo: 'Cofre' })).status).toBe(201);
    const r = await resumo(c.sessao.auth);
    expect(r).toMatchObject({ totalSangrias: 120, totalSuprimentos: 50, valorEsperadoEmDinheiro: 30 }); // 0 + 100 + 50 - 120
    expect(r.movimentos).toHaveLength(2);
  });

  it('não deixa sangrar mais do que há na gaveta, e exige motivo', async () => {
    const c = await cenario();
    const r = await movimento(c.sessao.auth, c.caixa.id, { tipo: 'SANGRIA', valor: 10, motivo: 'Sem dinheiro' });
    expect(r.status).toBe(400);
    expect(r.body.erro).toMatch(/gaveta/);
    expect((await movimento(c.sessao.auth, c.caixa.id, { tipo: 'SUPRIMENTO', valor: 10, motivo: '' })).status).toBe(400);
  });

  it('o fechamento mostra a diferença entre o contado e o esperado, e depois de fechado não aceita movimento', async () => {
    const c = await cenario();
    await movimento(c.sessao.auth, c.caixa.id, { tipo: 'SUPRIMENTO', valor: 200, motivo: 'Troco inicial' });
    const fechado = await request(app).post(`/api/caixa/${c.caixa.id}/fechar`).set(c.sessao.auth).send({ valorContado: 190 });
    expect(fechado.body.resumo.valorEsperadoEmDinheiro).toBe(200);
    expect(fechado.body.diferencaNoFechamento).toBe(-10); // faltou R$ 10
    expect((await movimento(c.sessao.auth, c.caixa.id, { tipo: 'SUPRIMENTO', valor: 5, motivo: 'Tarde' })).status).toBe(409);
  });
});

describe('código de barras', () => {
  it('cadastra, acha pelo leitor (código ou SKU), recusa repetido e não acha produto excluído', async () => {
    const c = await cenario();
    const cat = await prisma.categoria.findFirstOrThrow({ where: { tenantId: c.loja.id } });
    const novo = (extra: object) => request(app).post('/api/produtos').set(c.sessao.auth).send({ nome: 'Item', sku: `S${Math.random()}`, categoriaId: cat.id, precoCusto: 1, precoVenda: 2, quantidadeEmEstoque: 5, estoqueMinimo: 0, ...extra });

    const a = await novo({ nome: 'Com código', codigoBarras: '7891234567895' });
    expect(a.status).toBe(201);
    expect(a.body.codigoBarras).toBe('7891234567895');
    expect((await novo({ codigoBarras: '7891234567895' })).status).toBe(409);

    expect((await request(app).get('/api/produtos/codigo/7891234567895').set(c.sessao.auth)).body.nome).toBe('Com código');
    expect((await request(app).get(`/api/produtos/codigo/${a.body.sku}`).set(c.sessao.auth)).body.nome).toBe('Com código'); // o SKU também
    expect((await request(app).get('/api/produtos/codigo/0000000000000').set(c.sessao.auth)).status).toBe(404);
    expect(JSON.stringify((await request(app).get('/api/produtos?q=789123').set(c.sessao.auth)).body)).toContain('Com código');

    await request(app).delete(`/api/produtos/${a.body.id}`).set(c.sessao.auth);
    expect((await request(app).get('/api/produtos/codigo/7891234567895').set(c.sessao.auth)).status).toBe(404);
  });

  it('editar: trocar e apagar o código; operador do PDV consulta pelo leitor', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id);
    await request(app).put(`/api/produtos/${p.id}`).set(c.sessao.auth).send({ codigoBarras: '111' });
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).codigoBarras).toBe('111');
    await request(app).put(`/api/produtos/${p.id}`).set(c.sessao.auth).send({ codigoBarras: '' });
    expect((await prisma.produto.findUniqueOrThrow({ where: { id: p.id } })).codigoBarras).toBeNull();

    await request(app).put(`/api/produtos/${p.id}`).set(c.sessao.auth).send({ codigoBarras: '222' });
    const op = await criarUsuario(c.loja.id, 'OPERADOR_CAIXA', ['pdv']);
    expect((await request(app).get('/api/produtos/codigo/222').set((await entrar(op.email)).auth)).status).toBe(200);
  });
});
