import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { diaNoFuso, diasDoPeriodo } from '../lib/datas.js';
import { requireAuth } from '../middleware/auth.js';
import { requerirAdmin, requerirTela } from '../middleware/permissao.js';
import { requireFeaturePlano } from '../middleware/plano.js';

export const relatoriosRouter = Router();
relatoriosRouter.use(requireAuth, requerirTela(['relatorios']), requireFeaturePlano('relatorios'));

/** Consolidado somando o faturamento de todas as lojas da empresa — só
 * ENTERPRISE (mesma feature que libera multi-loja). */
relatoriosRouter.get('/consolidado', requireFeaturePlano('multiLoja'), async (req, res) => {
  const { tenantId } = req.usuario!;
  const inicio = typeof req.query.inicio === 'string' ? new Date(req.query.inicio) : null;
  const fim = typeof req.query.fim === 'string' ? new Date(req.query.fim) : null;
  if (fim) fim.setUTCHours(23, 59, 59, 999);

  const tenantAtual = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenantAtual) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const lojas = await prisma.tenant.findMany({
    where: { empresaId: tenantAtual.empresaId },
    orderBy: { nomeFantasia: 'asc' },
  });

  const vendas = await prisma.transacao.findMany({
    where: {
      tenantId: { in: lojas.map((l) => l.id) },
      tipo: 'SAIDA',
      timestamp: { gte: inicio ?? undefined, lte: fim ?? undefined },
    },
  });

  const porLoja = new Map<string, { faturamento: number; quantidadeVendas: number }>();
  for (const loja of lojas) porLoja.set(loja.id, { faturamento: 0, quantidadeVendas: 0 });
  for (const v of vendas) {
    const atual = porLoja.get(v.tenantId)!;
    atual.faturamento += Number(v.valorTotal);
    atual.quantidadeVendas += 1;
  }

  const lojasResumo = lojas.map((l) => {
    const dados = porLoja.get(l.id)!;
    return {
      tenantId: l.id,
      nomeFantasia: l.nomeFantasia,
      faturamento: Number(dados.faturamento.toFixed(2)),
      quantidadeVendas: dados.quantidadeVendas,
    };
  });

  res.json({
    faturamentoTotal: Number(lojasResumo.reduce((acc, l) => acc + l.faturamento, 0).toFixed(2)),
    quantidadeVendasTotal: lojasResumo.reduce((acc, l) => acc + l.quantidadeVendas, 0),
    lojas: lojasResumo,
  });
});

relatoriosRouter.get('/vendas', async (req, res) => {
  const { tenantId } = req.usuario!;

  // Datas vêm como "YYYY-MM-DD" e o Date as interpreta como meia-noite UTC —
  // por isso o limite superior também precisa ser fechado em UTC, senão em
  // fusos negativos (ex: America/Sao_Paulo) o dia final "vaza" para trás e
  // exclui vendas feitas mais tarde no próprio dia.
  const inicio = typeof req.query.inicio === 'string' ? new Date(req.query.inicio) : null;
  const fim = typeof req.query.fim === 'string' ? new Date(req.query.fim) : null;
  if (fim) fim.setUTCHours(23, 59, 59, 999);

  const vendas = await prisma.transacao.findMany({
    where: {
      tenantId,
      tipo: 'SAIDA',
      timestamp: {
        gte: inicio ?? undefined,
        lte: fim ?? undefined,
      },
    },
    include: { itens: true, cliente: true, vendedor: true },
    orderBy: { timestamp: 'desc' },
  });

  const faturamentoTotal = Number(vendas.reduce((acc, v) => acc + Number(v.valorTotal), 0).toFixed(2));
  const quantidadeVendas = vendas.length;
  const ticketMedio = quantidadeVendas > 0 ? Number((faturamentoTotal / quantidadeVendas).toFixed(2)) : 0;

  const totaisPorFormaPagamento = new Map<string, number>();
  for (const v of vendas) {
    const chave = v.formaPagamento ?? 'OUTRO';
    totaisPorFormaPagamento.set(chave, (totaisPorFormaPagamento.get(chave) ?? 0) + Number(v.valorTotal));
  }

  const acumuladoPorProduto = new Map<string, { nome: string; quantidade: number; receita: number }>();
  for (const venda of vendas) {
    for (const item of venda.itens) {
      const atual = acumuladoPorProduto.get(item.productId) ?? {
        nome: item.nomeProdutoSnapshot,
        quantidade: 0,
        receita: 0,
      };
      atual.quantidade += item.quantidade;
      atual.receita += Number(item.subtotal);
      acumuladoPorProduto.set(item.productId, atual);
    }
  }

  const produtosMaisVendidos = Array.from(acumuladoPorProduto.entries())
    .map(([productId, dados]) => ({
      productId,
      nome: dados.nome,
      quantidadeVendida: dados.quantidade,
      receitaGerada: Number(dados.receita.toFixed(2)),
    }))
    .sort((a, b) => b.quantidadeVendida - a.quantidadeVendida)
    .slice(0, 10);

  const acumuladoPorVendedor = new Map<
    string,
    { nome: string; comissaoPercentual: number; quantidade: number; totalVendido: number }
  >();
  for (const venda of vendas) {
    if (!venda.vendedor) continue;
    const atual = acumuladoPorVendedor.get(venda.vendedor.id) ?? {
      nome: venda.vendedor.nome,
      comissaoPercentual: Number(venda.vendedor.comissaoPercentual),
      quantidade: 0,
      totalVendido: 0,
    };
    atual.quantidade += 1;
    atual.totalVendido += Number(venda.valorTotal);
    acumuladoPorVendedor.set(venda.vendedor.id, atual);
  }

  const vendasPorVendedor = Array.from(acumuladoPorVendedor.entries())
    .map(([vendedorId, dados]) => ({
      vendedorId,
      nome: dados.nome,
      quantidadeVendas: dados.quantidade,
      totalVendido: Number(dados.totalVendido.toFixed(2)),
      comissaoPercentual: dados.comissaoPercentual,
      comissaoAPagar: Number(((dados.totalVendido * dados.comissaoPercentual) / 100).toFixed(2)),
    }))
    .sort((a, b) => b.totalVendido - a.totalVendido);

  res.json({
    faturamentoTotal,
    quantidadeVendas,
    ticketMedio,
    totaisPorFormaPagamento: Object.fromEntries(
      Array.from(totaisPorFormaPagamento.entries()).map(([k, v]) => [k, Number(v.toFixed(2))]),
    ),
    produtosMaisVendidos,
    vendasPorVendedor,
    vendas: vendas.map((v) => ({
      id: v.id,
      timestamp: v.timestamp.toISOString(),
      valorTotal: Number(v.valorTotal),
      formaPagamento: v.formaPagamento ?? undefined,
      clienteNome: v.cliente?.nome,
      vendedorNome: v.vendedor?.nome,
      quantidadeItens: v.itens.reduce((acc, i) => acc + i.quantidade, 0),
    })),
  });
});

function periodo(req: import('express').Request): { inicio: string; fim: string } | null {
  const ok = (v: unknown): v is string => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  return ok(req.query.inicio) && ok(req.query.fim) ? { inicio: req.query.inicio, fim: req.query.fim } : null;
}

/** Faturamento e nº de vendas por dia do período (até 92 dias), no fuso da loja. Dias sem venda vêm zerados. */
relatoriosRouter.get('/serie-diaria', async (req, res) => {
  const { tenantId } = req.usuario!;
  const p = periodo(req);
  if (!p) return res.status(400).json({ erro: 'Informe o período (inicio e fim, AAAA-MM-DD).' });

  const loja = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { fusoHorario: true } });
  const fuso = loja?.fusoHorario ?? 'America/Sao_Paulo';
  const dias = diasDoPeriodo(p.inicio, p.fim);
  if (dias.length === 0) return res.json([]);

  const fim = new Date(`${p.fim}T23:59:59.999Z`);
  fim.setUTCDate(fim.getUTCDate() + 1); // folga de fuso; o filtro final é por dia local
  const inicio = new Date(`${p.inicio}T00:00:00Z`);
  inicio.setUTCDate(inicio.getUTCDate() - 1);
  const vendas = await prisma.transacao.findMany({ where: { tenantId, tipo: 'SAIDA', timestamp: { gte: inicio, lte: fim } }, select: { timestamp: true, valorTotal: true } });

  const porDia = new Map(dias.map((d) => [d, { data: d, faturamento: 0, vendas: 0 }]));
  for (const v of vendas) {
    const ponto = porDia.get(diaNoFuso(v.timestamp, fuso));
    if (ponto) {
      ponto.faturamento += Number(v.valorTotal);
      ponto.vendas += 1;
    }
  }
  res.json([...porDia.values()].map((x) => ({ ...x, faturamento: Number(x.faturamento.toFixed(2)) })));
});

/** Curva ABC: classifica os produtos pela fatia do faturamento do período. A (até 80% da receita
 * acumulada) são os que sustentam a loja; B (até 95%) os intermediários; C o resto. */
relatoriosRouter.get('/curva-abc', async (req, res) => {
  const { tenantId } = req.usuario!;
  const p = periodo(req);
  if (!p) return res.status(400).json({ erro: 'Informe o período (inicio e fim, AAAA-MM-DD).' });

  const fim = new Date(p.fim);
  fim.setUTCHours(23, 59, 59, 999);
  const itens = await prisma.itemTransacao.findMany({
    where: { transacao: { tenantId, tipo: 'SAIDA', timestamp: { gte: new Date(p.inicio), lte: fim } } },
    select: { productId: true, nomeProdutoSnapshot: true, quantidade: true, subtotal: true },
  });

  const porProduto = new Map<string, { nome: string; quantidade: number; receita: number }>();
  for (const i of itens) {
    const a = porProduto.get(i.productId) ?? { nome: i.nomeProdutoSnapshot, quantidade: 0, receita: 0 };
    a.quantidade += i.quantidade;
    a.receita += Number(i.subtotal);
    porProduto.set(i.productId, a);
  }

  const ordenados = [...porProduto.entries()].map(([productId, a]) => ({ productId, ...a })).sort((a, b) => b.receita - a.receita);
  const total = ordenados.reduce((acc, x) => acc + x.receita, 0);
  let acumulado = 0;
  const lista = ordenados.map((x, posicao) => {
    acumulado += x.receita;
    // Convenção usual: a classe sai do acumulado já com o próprio produto (até 80% = A,
    // até 95% = B, o resto = C). O campeão de vendas é sempre A, mesmo que sozinho passe de 80%.
    const pct = total === 0 ? 100 : (acumulado / total) * 100;
    const classe = posicao === 0 ? 'A' : pct <= 80.0001 ? 'A' : pct <= 95.0001 ? 'B' : 'C';
    return {
      productId: x.productId,
      nome: x.nome,
      quantidade: x.quantidade,
      receita: Number(x.receita.toFixed(2)),
      participacao: total > 0 ? Number(((x.receita / total) * 100).toFixed(1)) : 0,
      acumulado: total > 0 ? Number(((acumulado / total) * 100).toFixed(1)) : 0,
      classe,
    };
  });
  res.json({ total: Number(total.toFixed(2)), itens: lista });
});

/** Estoque parado: produtos ativos com saldo e SEM venda nos últimos N dias (padrão 30).
 * `valorParado` é o dinheiro preso (saldo x preço de custo). */
relatoriosRouter.get('/estoque-parado', async (req, res) => {
  const { tenantId } = req.usuario!;
  const dias = Math.min(365, Math.max(7, Math.trunc(Number(req.query.dias)) || 30));
  const desde = new Date(Date.now() - dias * 86_400_000);

  const [produtos, vendidos] = await Promise.all([
    prisma.produto.findMany({ where: { tenantId, ativo: true, quantidadeEmEstoque: { gt: 0 } }, select: { id: true, nome: true, sku: true, quantidadeEmEstoque: true, precoCusto: true } }),
    prisma.itemTransacao.groupBy({
      by: ['productId'],
      where: { transacao: { tenantId, tipo: 'SAIDA', timestamp: { gte: desde } } },
    }),
  ]);
  const comVenda = new Set(vendidos.map((v) => v.productId));

  const parados = produtos
    .filter((p) => !comVenda.has(p.id))
    .map((p) => ({ productId: p.id, nome: p.nome, sku: p.sku, quantidade: p.quantidadeEmEstoque, valorParado: Number((p.quantidadeEmEstoque * Number(p.precoCusto)).toFixed(2)) }))
    .sort((a, b) => b.valorParado - a.valorParado);

  res.json({ dias, valorTotal: Number(parados.reduce((a, p) => a + p.valorParado, 0).toFixed(2)), itens: parados });
});
