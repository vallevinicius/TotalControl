import { describe, expect, it } from 'vitest';
import { abrirCaixa, app, criarEmpresa, criarProduto, criarUsuario, entrar, prisma, request } from './helpers/index.js';

async function cenario() {
  const e = await criarEmpresa({ plano: 'PRO' });
  return { ...e, ...(await entrar(e.dono.email)) };
}

const dia = (deslocamentoEmDias = 0) => new Date(Date.now() + deslocamentoEmDias * 86_400_000).toISOString().slice(0, 10);
const periodo = `inicio=${dia(-60)}&fim=${dia(60)}`;

describe('contas a pagar e a receber', () => {
  it('conta aberta não entra no resultado; ao dar baixa, entra na data do pagamento; reabrir tira de novo', async () => {
    const c = await cenario();
    const r = await request(app).post('/api/financeiro/contas').set(c.auth).send({ tipo: 'DESPESA', categoria: 'Aluguel', valor: 1500, vencimento: dia(5) });
    expect(r.status).toBe(201);
    expect(r.body.criadas).toBe(1);

    const resumo = () => request(app).get(`/api/financeiro/resumo?${periodo}`).set(c.auth).then((x) => x.body);
    expect((await resumo()).despesasAvulsas).toBe(0);

    const conta = (await request(app).get('/api/financeiro/contas').set(c.auth)).body[0];
    expect(conta).toMatchObject({ categoria: 'Aluguel', valor: 1500, situacao: 'ABERTA' });

    expect((await request(app).patch(`/api/financeiro/contas/${conta.id}/baixa`).set(c.auth).send({})).status).toBe(200);
    expect((await resumo()).despesasAvulsas).toBe(1500);
    expect((await request(app).patch(`/api/financeiro/contas/${conta.id}/baixa`).set(c.auth).send({})).status).toBe(409);
    expect((await request(app).get('/api/financeiro/contas?situacao=pagas').set(c.auth)).body).toHaveLength(1);

    expect((await request(app).patch(`/api/financeiro/contas/${conta.id}/reabrir`).set(c.auth)).status).toBe(200);
    expect((await resumo()).despesasAvulsas).toBe(0);
  });

  it('parcelas mensais: gera N contas, uma por mês, e o dia 31 cai no fim de mês curto', async () => {
    const c = await cenario();
    const r = await request(app).post('/api/financeiro/contas').set(c.auth).send({ tipo: 'DESPESA', categoria: 'Internet', descricao: 'Plano', valor: 100, vencimento: '2027-01-31', parcelas: 3 });
    expect(r.body.criadas).toBe(3);
    const contas = (await request(app).get('/api/financeiro/contas').set(c.auth)).body as Array<{ vencimento: string; descricao: string }>;
    expect(contas.map((x) => x.vencimento.slice(0, 10))).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(contas[0].descricao).toBe('Plano (1/3)');
  });

  it('classifica atrasadas e resume o que vence nos próximos 7 dias', async () => {
    const c = await cenario();
    const nova = (tipo: string, valor: number, vencimento: string) => request(app).post('/api/financeiro/contas').set(c.auth).send({ tipo, categoria: 'Teste', valor, vencimento });
    await nova('DESPESA', 200, dia(-3));
    await nova('DESPESA', 300, dia(3));
    await nova('RECEITA', 500, dia(20));

    const lista = (await request(app).get('/api/financeiro/contas').set(c.auth)).body as Array<{ situacao: string; valor: number }>;
    expect(lista.find((x) => x.valor === 200)?.situacao).toBe('ATRASADA');
    expect(lista.find((x) => x.valor === 300)?.situacao).toBe('ABERTA');

    const resumo = (await request(app).get('/api/financeiro/contas/resumo').set(c.auth)).body;
    expect(resumo).toMatchObject({ aPagar: 500, aReceber: 500, atrasadas: { quantidade: 1, valor: 200 }, proximos7Dias: { quantidade: 1, valor: 300 } });
  });

  it('exige a permissão do financeiro e isola entre empresas', async () => {
    const a = await cenario();
    const b = await cenario();
    await request(app).post('/api/financeiro/contas').set(b.auth).send({ tipo: 'DESPESA', categoria: 'De B', valor: 10, vencimento: dia(1) });
    const contaDeB = (await request(app).get('/api/financeiro/contas').set(b.auth)).body[0];
    expect((await request(app).patch(`/api/financeiro/contas/${contaDeB.id}/baixa`).set(a.auth).send({})).status).toBe(404);
    expect((await request(app).get('/api/financeiro/contas').set(a.auth)).body).toEqual([]);

    const op = await criarUsuario(a.loja.id, 'OPERADOR_CAIXA', ['pdv']);
    expect((await request(app).get('/api/financeiro/contas').set((await entrar(op.email)).auth)).status).toBe(403);
  });

  it('recusa valor zero e data fora do formato', async () => {
    const c = await cenario();
    expect((await request(app).post('/api/financeiro/contas').set(c.auth).send({ tipo: 'DESPESA', categoria: 'X', valor: 0, vencimento: dia(1) })).status).toBe(400);
    expect((await request(app).post('/api/financeiro/contas').set(c.auth).send({ tipo: 'DESPESA', categoria: 'X', valor: 10, vencimento: '31/12/2026' })).status).toBe(400);
  });
});

describe('resultado do período (DRE)', () => {
  it('calcula lucro bruto, despesas por categoria e resultado', async () => {
    const c = await cenario();
    await abrirCaixa(c.loja.id, c.dono.id);
    const p = await criarProduto(c.loja.id, { preco: 10, estoque: 100 }); // custo 5 (padrão do helper)
    // 10 unidades a R$ 10 com R$ 5 de desconto: receita 95, custo 50.
    expect((await request(app).post('/api/vendas').set(c.auth).send({ itens: [{ productId: p.id, quantidade: 10 }], desconto: 5, formaPagamento: 'PIX' })).status).toBe(201);
    await request(app).post('/api/financeiro/lancamentos').set(c.auth).send({ tipo: 'DESPESA', categoria: 'Aluguel', valor: 20, data: dia(0) });
    await request(app).post('/api/financeiro/lancamentos').set(c.auth).send({ tipo: 'DESPESA', categoria: 'Luz', valor: 10, data: dia(0) });
    await request(app).post('/api/financeiro/lancamentos').set(c.auth).send({ tipo: 'RECEITA', categoria: 'Aluguel de espaço', valor: 15, data: dia(0) });
    // Conta ainda aberta não conta.
    await request(app).post('/api/financeiro/contas').set(c.auth).send({ tipo: 'DESPESA', categoria: 'Futura', valor: 999, vencimento: dia(2) });

    const dre = (await request(app).get(`/api/financeiro/dre?${periodo}`).set(c.auth)).body;
    expect(dre).toMatchObject({
      vendasBrutas: 100,
      descontos: 5,
      receitaDeVendas: 95,
      custoMercadorias: 50,
      lucroBruto: 45,
      totalDespesas: 30,
      totalOutrasReceitas: 15,
      resultado: 30, // 45 - 30 + 15
    });
    expect(dre.despesas[0]).toEqual({ categoria: 'Aluguel', valor: 20 });
    expect(dre.margemBruta).toBeCloseTo(47.37, 1);
  });
});
