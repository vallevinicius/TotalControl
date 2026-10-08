import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requerirAdmin, requerirTela } from '../middleware/permissao.js';
import { requireFeaturePlano } from '../middleware/plano.js';
import { registrarAuditoria } from '../lib/auditoria.js';

export const financeiroRouter = Router();
financeiroRouter.use(requireAuth, requerirTela(['financeiro']), requireFeaturePlano('financeiro'));

/**
 * Datas vêm como "YYYY-MM-DD" e o Date as interpreta como meia-noite UTC —
 * por isso o limite superior também é fechado em UTC, senão em fusos
 * negativos (ex: America/Sao_Paulo) o dia final "vaza" para trás e exclui
 * lançamentos feitos mais tarde no próprio dia (mesmo bug já corrigido em
 * relatorios.routes.ts).
 */
function periodoDaQuery(req: import('express').Request): { inicio?: Date; fim?: Date } {
  const inicio = typeof req.query.inicio === 'string' ? new Date(req.query.inicio) : undefined;
  const fim = typeof req.query.fim === 'string' ? new Date(req.query.fim) : undefined;
  if (fim) fim.setUTCHours(23, 59, 59, 999);
  return { inicio, fim };
}

function serializarLancamento(l: {
  id: string;
  tenantId: string;
  tipo: string;
  categoria: string;
  descricao: string | null;
  valor: unknown;
  data: Date;
  vencimento?: Date | null;
  pagoEm?: Date | null;
  usuarioId: string;
  criadoEm: Date;
}) {
  return {
    id: l.id,
    tenantId: l.tenantId,
    tipo: l.tipo,
    categoria: l.categoria,
    descricao: l.descricao ?? undefined,
    valor: Number(l.valor),
    data: l.data.toISOString(),
    vencimento: l.vencimento?.toISOString(),
    pagoEm: l.pagoEm?.toISOString(),
    situacao: l.vencimento ? situacaoDaConta(l.vencimento, l.pagoEm) : undefined,
    usuarioId: l.usuarioId,
    criadoEm: l.criadoEm.toISOString(),
  };
}

type Situacao = 'ABERTA' | 'ATRASADA' | 'PAGA';

/** Situação de uma conta a pagar/receber: paga, aberta ou atrasada (vencida e sem baixa). */
function situacaoDaConta(vencimento: Date, pagoEm?: Date | null): Situacao {
  if (pagoEm) return 'PAGA';
  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);
  return vencimento < hoje ? 'ATRASADA' : 'ABERTA';
}

/** Só entra no resultado o que já aconteceu: lançamento avulso (sem vencimento) ou
 * conta já baixada. Conta aberta fica de fora até ser paga/recebida. */
const REALIZADO = { OR: [{ vencimento: null }, { pagoEm: { not: null } }] };

financeiroRouter.get('/resumo', async (req, res) => {
  const { tenantId } = req.usuario!;
  const { inicio, fim } = periodoDaQuery(req);

  const [vendas, entradasEstoque, lancamentos] = await Promise.all([
    prisma.transacao.findMany({
      where: { tenantId, tipo: 'SAIDA', timestamp: { gte: inicio, lte: fim } },
    }),
    prisma.transacao.findMany({
      where: { tenantId, tipo: 'ENTRADA', timestamp: { gte: inicio, lte: fim } },
    }),
    prisma.lancamentoFinanceiro.findMany({
      where: { tenantId, data: { gte: inicio, lte: fim }, ...REALIZADO },
    }),
  ]);

  const receitaVendas = Number(vendas.reduce((acc, v) => acc + Number(v.valorTotal), 0).toFixed(2));
  const custoEstoque = Number(entradasEstoque.reduce((acc, e) => acc + Number(e.valorTotal), 0).toFixed(2));
  const receitasAvulsas = Number(
    lancamentos.filter((l) => l.tipo === 'RECEITA').reduce((acc, l) => acc + Number(l.valor), 0).toFixed(2),
  );
  const despesasAvulsas = Number(
    lancamentos.filter((l) => l.tipo === 'DESPESA').reduce((acc, l) => acc + Number(l.valor), 0).toFixed(2),
  );
  const saldo = Number((receitaVendas + receitasAvulsas - custoEstoque - despesasAvulsas).toFixed(2));

  res.json({ receitaVendas, custoEstoque, receitasAvulsas, despesasAvulsas, saldo });
});

financeiroRouter.get('/lancamentos', async (req, res) => {
  const { tenantId } = req.usuario!;
  const { inicio, fim } = periodoDaQuery(req);

  const lancamentos = await prisma.lancamentoFinanceiro.findMany({
    where: { tenantId, data: { gte: inicio, lte: fim }, ...REALIZADO },
    orderBy: { data: 'desc' },
  });

  res.json(lancamentos.map(serializarLancamento));
});

const lancamentoSchema = z.object({
  tipo: z.enum(['RECEITA', 'DESPESA']),
  categoria: z.string().min(1),
  descricao: z.string().optional(),
  valor: z.number().positive(),
  data: z.string().min(1),
});

financeiroRouter.post('/lancamentos', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const parse = lancamentoSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }

  const { tipo, categoria, descricao, valor, data } = parse.data;

  const lancamento = await prisma.lancamentoFinanceiro.create({
    data: { tenantId, tipo, categoria, descricao, valor, data: new Date(data), usuarioId },
  });

  res.status(201).json(serializarLancamento(lancamento));
});

financeiroRouter.delete('/lancamentos/:id', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const lancamento = await prisma.lancamentoFinanceiro.findFirst({ where: { id: req.params.id, tenantId } });
  if (!lancamento) return res.status(404).json({ erro: 'Lançamento não encontrado.' });

  await prisma.lancamentoFinanceiro.delete({ where: { id: lancamento.id } });
  await registrarAuditoria(
    tenantId,
    usuarioId,
    'financeiro.excluirLancamento',
    `${lancamento.categoria} — ${Number(lancamento.valor).toFixed(2)}`,
  );
  res.status(204).send();
});

// ----------------------------------------------------------------------------
// Contas a pagar e a receber
// ----------------------------------------------------------------------------

const contaSchema = z.object({
  tipo: z.enum(['RECEITA', 'DESPESA']),
  categoria: z.string().trim().min(1).max(191),
  descricao: z.string().trim().max(191).optional(),
  valor: z.number().positive(),
  /** "YYYY-MM-DD" */
  vencimento: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** Quantas mensalidades gerar (ex: aluguel por 12 meses). */
  parcelas: z.number().int().min(1).max(36).default(1),
});

/** Cria a conta (ou as parcelas mensais). Cada parcela vence um mês depois da anterior. */
financeiroRouter.post('/contas', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const parse = contaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  const { tipo, categoria, descricao, valor, vencimento, parcelas } = parse.data;

  const [ano, mes, dia] = vencimento.split('-').map(Number);
  const contas = Array.from({ length: parcelas }, (_, i) => {
    // Dia 31 num mês de 30 dias cai no último dia do mês, não pula pro seguinte.
    const alvo = new Date(Date.UTC(ano, mes - 1 + i, 1));
    const ultimoDia = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth() + 1, 0)).getUTCDate();
    const venc = new Date(Date.UTC(alvo.getUTCFullYear(), alvo.getUTCMonth(), Math.min(dia, ultimoDia)));
    return {
      tenantId,
      tipo,
      categoria,
      descricao: parcelas > 1 ? `${descricao ? `${descricao} ` : ''}(${i + 1}/${parcelas})` : descricao,
      valor,
      data: venc,
      vencimento: venc,
      usuarioId,
    };
  });
  await prisma.lancamentoFinanceiro.createMany({ data: contas });
  await registrarAuditoria(tenantId, usuarioId, 'financeiro.criarConta', `${categoria}: ${parcelas}x ${valor.toFixed(2)}`);
  res.status(201).json({ criadas: contas.length });
});

/** Lista as contas (com vencimento). `situacao`: abertas (padrão: abertas + atrasadas), pagas ou todas. */
financeiroRouter.get('/contas', async (req, res) => {
  const { tenantId } = req.usuario!;
  const situacao = typeof req.query.situacao === 'string' ? req.query.situacao : 'abertas';
  const tipo = req.query.tipo === 'RECEITA' || req.query.tipo === 'DESPESA' ? req.query.tipo : undefined;

  const contas = await prisma.lancamentoFinanceiro.findMany({
    where: {
      tenantId,
      vencimento: { not: null },
      ...(tipo ? { tipo } : {}),
      ...(situacao === 'pagas' ? { pagoEm: { not: null } } : situacao === 'abertas' ? { pagoEm: null } : {}),
    },
    orderBy: situacao === 'pagas' ? { pagoEm: 'desc' } : { vencimento: 'asc' },
    take: 500,
  });
  res.json(contas.map(serializarLancamento));
});

/** Totais das contas em aberto, pros cartões do topo e para o aviso de vencimento. */
financeiroRouter.get('/contas/resumo', async (req, res) => {
  const { tenantId } = req.usuario!;
  const abertas = await prisma.lancamentoFinanceiro.findMany({ where: { tenantId, vencimento: { not: null }, pagoEm: null } });
  const hoje = new Date();
  hoje.setUTCHours(0, 0, 0, 0);
  const em7Dias = new Date(hoje.getTime() + 7 * 86_400_000);
  const soma = (l: typeof abertas) => Number(l.reduce((acc, c) => acc + Number(c.valor), 0).toFixed(2));

  const aPagar = abertas.filter((c) => c.tipo === 'DESPESA');
  const aReceber = abertas.filter((c) => c.tipo === 'RECEITA');
  const atrasadas = abertas.filter((c) => c.vencimento! < hoje);
  const proximas = abertas.filter((c) => c.vencimento! >= hoje && c.vencimento! <= em7Dias);
  res.json({
    aPagar: soma(aPagar),
    aReceber: soma(aReceber),
    atrasadas: { quantidade: atrasadas.length, valor: soma(atrasadas) },
    proximos7Dias: { quantidade: proximas.length, valor: soma(proximas) },
  });
});

const baixaSchema = z.object({ pagoEm: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() });

/** Dá baixa (pagou ou recebeu). Daí em diante o valor entra no resultado, na data da baixa. */
financeiroRouter.patch('/contas/:id/baixa', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const parse = baixaSchema.safeParse(req.body ?? {});
  if (!parse.success) return res.status(400).json({ erro: 'Data inválida.' });

  const conta = await prisma.lancamentoFinanceiro.findFirst({ where: { id: req.params.id, tenantId, vencimento: { not: null } } });
  if (!conta) return res.status(404).json({ erro: 'Conta não encontrada.' });
  if (conta.pagoEm) return res.status(409).json({ erro: 'Esta conta já foi baixada.' });

  const pagoEm = parse.data.pagoEm ? new Date(parse.data.pagoEm) : new Date(new Date().toISOString().slice(0, 10));
  const atualizada = await prisma.lancamentoFinanceiro.update({ where: { id: conta.id }, data: { pagoEm, data: pagoEm } });
  await registrarAuditoria(tenantId, usuarioId, 'financeiro.baixarConta', `${conta.categoria}: ${Number(conta.valor).toFixed(2)}`);
  res.json(serializarLancamento(atualizada));
});

/** Desfaz a baixa (lançou por engano): a conta volta a ficar em aberto. */
financeiroRouter.patch('/contas/:id/reabrir', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const conta = await prisma.lancamentoFinanceiro.findFirst({ where: { id: req.params.id, tenantId, vencimento: { not: null } } });
  if (!conta) return res.status(404).json({ erro: 'Conta não encontrada.' });
  if (!conta.pagoEm) return res.status(409).json({ erro: 'Esta conta está em aberto.' });

  const atualizada = await prisma.lancamentoFinanceiro.update({ where: { id: conta.id }, data: { pagoEm: null, data: conta.vencimento! } });
  await registrarAuditoria(tenantId, usuarioId, 'financeiro.reabrirConta', `${conta.categoria}: ${Number(conta.valor).toFixed(2)}`);
  res.json(serializarLancamento(atualizada));
});

// ----------------------------------------------------------------------------
// Resultado do período (DRE simplificada)
// ----------------------------------------------------------------------------

/** Receita de vendas - custo das mercadorias vendidas = lucro bruto; menos as
 * despesas (por categoria), mais outras receitas = resultado. O custo das
 * mercadorias usa o preço de custo ATUAL de cada produto (o sistema não guarda o
 * custo na hora da venda), então é uma estimativa. */
financeiroRouter.get('/dre', async (req, res) => {
  const { tenantId } = req.usuario!;
  const { inicio, fim } = periodoDaQuery(req);

  const [vendas, lancamentos] = await Promise.all([
    prisma.transacao.findMany({
      where: { tenantId, tipo: 'SAIDA', timestamp: { gte: inicio, lte: fim } },
      include: { itens: { select: { quantidade: true, produto: { select: { precoCusto: true } } } } },
    }),
    prisma.lancamentoFinanceiro.findMany({ where: { tenantId, data: { gte: inicio, lte: fim }, ...REALIZADO } }),
  ]);

  const dinheiro = (n: number) => Number(n.toFixed(2));
  const vendasBrutas = vendas.reduce((a, v) => a + Number(v.valorTotal) + Number(v.desconto) - Number(v.taxas), 0);
  const descontos = vendas.reduce((a, v) => a + Number(v.desconto), 0);
  const taxasCobradas = vendas.reduce((a, v) => a + Number(v.taxas), 0);
  const receitaDeVendas = vendas.reduce((a, v) => a + Number(v.valorTotal), 0);
  const custoMercadorias = vendas.reduce((a, v) => a + v.itens.reduce((b, i) => b + i.quantidade * Number(i.produto.precoCusto), 0), 0);

  const porCategoria = (tipo: 'RECEITA' | 'DESPESA') => {
    const mapa = new Map<string, number>();
    for (const l of lancamentos.filter((x) => x.tipo === tipo)) mapa.set(l.categoria, (mapa.get(l.categoria) ?? 0) + Number(l.valor));
    return [...mapa.entries()].map(([categoria, valor]) => ({ categoria, valor: dinheiro(valor) })).sort((a, b) => b.valor - a.valor);
  };
  const despesas = porCategoria('DESPESA');
  const outrasReceitas = porCategoria('RECEITA');
  const totalDespesas = despesas.reduce((a, d) => a + d.valor, 0);
  const totalOutras = outrasReceitas.reduce((a, d) => a + d.valor, 0);
  const lucroBruto = receitaDeVendas - custoMercadorias;

  res.json({
    vendasBrutas: dinheiro(vendasBrutas),
    descontos: dinheiro(descontos),
    taxasCobradas: dinheiro(taxasCobradas),
    receitaDeVendas: dinheiro(receitaDeVendas),
    custoMercadorias: dinheiro(custoMercadorias),
    lucroBruto: dinheiro(lucroBruto),
    margemBruta: receitaDeVendas > 0 ? dinheiro((lucroBruto / receitaDeVendas) * 100) : 0,
    despesas,
    totalDespesas: dinheiro(totalDespesas),
    outrasReceitas,
    totalOutrasReceitas: dinheiro(totalOutras),
    resultado: dinheiro(lucroBruto - totalDespesas + totalOutras),
  });
});
