import { describe, expect, it } from 'vitest';
import { abrirCaixa, app, criarEmpresa, criarProduto, criarUsuario, entrar, prisma, request } from './helpers/index.js';
import { acoesEfetivas, descontoMaximoPercentual, podeFazer, TODAS_AS_ACOES } from '../src/config/acoes.js';

describe('regras de ações (unidade)', () => {
  it('padrões por papel: admin e gerente fazem tudo; operador nada', () => {
    expect(acoesEfetivas({ papel: 'ADMIN' })).toEqual(TODAS_AS_ACOES);
    expect(acoesEfetivas({ papel: 'GERENTE' })).toEqual(TODAS_AS_ACOES);
    expect(acoesEfetivas({ papel: 'OPERADOR_CAIXA' })).toEqual([]);
  });

  it('uma lista personalizada vale exatamente como está, e admin ignora a lista', () => {
    expect(acoesEfetivas({ papel: 'OPERADOR_CAIXA', acoes: ['vendas.cancelar'] })).toEqual(['vendas.cancelar']);
    expect(acoesEfetivas({ papel: 'GERENTE', acoes: [] })).toEqual([]);
    expect(acoesEfetivas({ papel: 'ADMIN', acoes: [] })).toEqual(TODAS_AS_ACOES);
    expect(acoesEfetivas({ papel: 'GERENTE', acoes: ['nao.existe', 'caixa.sangria'] })).toEqual(['caixa.sangria']);
  });

  it('desconto máximo: 5% sem a ação, 20% com ela, 100% para admin', () => {
    expect(descontoMaximoPercentual({ papel: 'OPERADOR_CAIXA' })).toBe(5);
    expect(descontoMaximoPercentual({ papel: 'OPERADOR_CAIXA', acoes: ['vendas.descontoAlto'] })).toBe(20);
    expect(descontoMaximoPercentual({ papel: 'GERENTE' })).toBe(20);
    expect(descontoMaximoPercentual({ papel: 'GERENTE', acoes: [] })).toBe(5);
    expect(descontoMaximoPercentual({ papel: 'ADMIN' })).toBe(100);
    expect(podeFazer({ papel: 'OPERADOR_CAIXA' }, 'caixa.sangria')).toBe(false);
  });
});

describe('ações aplicadas no servidor', () => {
  async function cenario() {
    const e = await criarEmpresa({ plano: 'PRO' });
    const dono = await entrar(e.dono.email);
    return { ...e, sessaoDono: dono };
  }
  const definirAcoes = (auth: object, id: string, acoes: string[] | null) =>
    request(app).put(`/api/usuarios/${id}/acesso`).set(auth).send({ acoes });

  it('operador não exclui nem ajusta; ao receber a ação, passa a poder (e só ela)', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id, { estoque: 10 });
    const op = await criarUsuario(c.loja.id, 'OPERADOR_CAIXA', ['pdv', 'estoque']);
    const sessao = await entrar(op.email);

    expect((await request(app).delete(`/api/produtos/${p.id}`).set(sessao.auth)).status).toBe(403);
    expect((await request(app).post('/api/estoque/ajuste').set(sessao.auth).send({ productId: p.id, novaQuantidade: 5, motivo: 'Contagem' })).status).toBe(403);

    expect((await definirAcoes(c.sessaoDono.auth, op.id, ['estoque.ajustar'])).status).toBe(200);
    // Vale na hora, sem novo login.
    expect((await request(app).post('/api/estoque/ajuste').set(sessao.auth).send({ productId: p.id, novaQuantidade: 5, motivo: 'Contagem' })).status).toBe(200);
    expect((await request(app).delete(`/api/produtos/${p.id}`).set(sessao.auth)).status).toBe(403); // não recebeu esta

    expect((await definirAcoes(c.sessaoDono.auth, op.id, ['registros.excluir'])).status).toBe(200);
    expect((await request(app).delete(`/api/produtos/${p.id}`).set(sessao.auth)).status).toBeLessThan(300);
  });

  it('gerente pode ter ações retiradas', async () => {
    const c = await cenario();
    const p = await criarProduto(c.loja.id);
    const g = await criarUsuario(c.loja.id, 'GERENTE', ['pdv', 'estoque']);
    const sessao = await entrar(g.email);
    expect((await request(app).post('/api/estoque/ajuste').set(sessao.auth).send({ productId: p.id, novaQuantidade: 9, motivo: 'Teste' })).status).toBe(200);

    await definirAcoes(c.sessaoDono.auth, g.id, []);
    expect((await request(app).post('/api/estoque/ajuste').set(sessao.auth).send({ productId: p.id, novaQuantidade: 8, motivo: 'Teste 2' })).status).toBe(403);

    // null volta ao padrão do papel
    await definirAcoes(c.sessaoDono.auth, g.id, null);
    expect((await request(app).post('/api/estoque/ajuste').set(sessao.auth).send({ productId: p.id, novaQuantidade: 8, motivo: 'Teste 3' })).status).toBe(200);
  });

  it('preço manual e desconto alto dependem das ações, não só do papel', async () => {
    const c = await cenario();
    await abrirCaixa(c.loja.id, c.dono.id);
    const p = await criarProduto(c.loja.id, { preco: 10 });
    const op = await criarUsuario(c.loja.id, 'OPERADOR_CAIXA', ['pdv']);
    const sessao = await entrar(op.email);
    const venda = (extra: object, preco = 10, qtd = 10) => request(app).post('/api/vendas').set(sessao.auth).send({ itens: [{ productId: p.id, quantidade: qtd, precoUnitario: preco }], formaPagamento: 'PIX', ...extra });

    expect((await venda({}, 8)).status).toBe(400);
    expect((await venda({ desconto: 15 })).status).toBe(400);

    await definirAcoes(c.sessaoDono.auth, op.id, ['vendas.alterarPreco', 'vendas.descontoAlto']);
    expect((await venda({}, 8, 1)).status).toBe(201);
    expect((await venda({ desconto: 15 })).status).toBe(201); // 15% de 100
    expect((await venda({ desconto: 25 })).status).toBe(400); // acima de 20%
  });

  it('valida a lista (ação inexistente) e só administradores personalizam', async () => {
    const c = await cenario();
    const op = await criarUsuario(c.loja.id, 'OPERADOR_CAIXA');
    expect((await definirAcoes(c.sessaoDono.auth, op.id, ['fazer.tudo'])).status).toBe(400);
    const g = await criarUsuario(c.loja.id, 'GERENTE');
    expect((await definirAcoes((await entrar(g.email)).auth, op.id, ['vendas.cancelar'])).status).toBe(403);
  });

  it('/me informa as ações que valem e o desconto máximo; criar usuário já aceita as ações', async () => {
    const c = await cenario();
    const criado = await request(app).post('/api/usuarios').set(c.sessaoDono.auth).send({ nome: 'Caixa 1', email: 'caixa1@teste.local', senha: 'Teste@123', papel: 'OPERADOR_CAIXA', permissoes: ['pdv'], acoes: ['vendas.cancelar'] });
    expect(criado.status).toBe(201);
    expect(criado.body.acoes).toEqual(['vendas.cancelar']);
    const me = await request(app).get('/api/auth/me').set((await entrar('caixa1@teste.local')).auth);
    expect(me.body.usuario.acoes).toEqual(['vendas.cancelar']);
    expect(me.body.usuario.descontoMaximo).toBe(5);
    const doDono = await request(app).get('/api/auth/me').set(c.sessaoDono.auth);
    expect(doDono.body.usuario.descontoMaximo).toBe(100);
    void prisma;
  });
});
