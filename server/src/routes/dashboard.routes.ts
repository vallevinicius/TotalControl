import { Router } from 'express';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requerirAdmin, requerirTela } from '../middleware/permissao.js';
import { contarProdutosComEstoqueBaixo } from '../lib/estoque.js';
import { diaNoFuso, ultimosDias } from '../lib/datas.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth, requerirTela(['dashboard', 'estoque', 'pdv']));

dashboardRouter.get('/resumo', async (req, res) => {
  const { tenantId } = req.usuario!;

  const inicioDoDia = new Date();
  inicioDoDia.setHours(0, 0, 0, 0);

  const vendasDoDia = await prisma.transacao.findMany({
    where: { tenantId, tipo: 'SAIDA', timestamp: { gte: inicioDoDia } },
    include: { itens: true },
  });

  const faturamentoDoDia = Number(vendasDoDia.reduce((acc, t) => acc + Number(t.valorTotal), 0).toFixed(2));
  const quantidadeVendasDoDia = vendasDoDia.length;
  const ticketMedio = quantidadeVendasDoDia > 0 ? Number((faturamentoDoDia / quantidadeVendasDoDia).toFixed(2)) : 0;

  const acumuladoPorProduto = new Map<string, { nome: string; quantidade: number; receita: number }>();
  for (const venda of vendasDoDia) {
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
    .slice(0, 5);

  const produtosComEstoqueBaixo = await contarProdutosComEstoqueBaixo(tenantId);

  res.json({
    faturamentoDoDia,
    quantidadeVendasDoDia,
    ticketMedio,
    produtosMaisVendidos,
    produtosComEstoqueBaixo,
  });
});

/** Faturamento e número de vendas por dia nos últimos N dias (padrão 14), no fuso da loja. */
dashboardRouter.get('/serie', requerirTela(['dashboard']), async (req, res) => {
  const { tenantId } = req.usuario!;
  const dias = Math.min(60, Math.max(2, Math.trunc(Number(req.query.dias)) || 14));
  const loja = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { fusoHorario: true } });
  const fuso = loja?.fusoHorario ?? 'America/Sao_Paulo';

  const lista = ultimosDias(dias, fuso);
  // Folga de 1 dia pra trás: o corte exato depende do fuso; o filtro final é por dia local.
  const desde = new Date(Date.now() - (dias + 1) * 86_400_000);
  const vendas = await prisma.transacao.findMany({ where: { tenantId, tipo: 'SAIDA', timestamp: { gte: desde } }, select: { timestamp: true, valorTotal: true } });

  const porDia = new Map(lista.map((d) => [d, { data: d, faturamento: 0, vendas: 0 }]));
  for (const v of vendas) {
    const ponto = porDia.get(diaNoFuso(v.timestamp, fuso));
    if (ponto) {
      ponto.faturamento += Number(v.valorTotal);
      ponto.vendas += 1;
    }
  }
  res.json([...porDia.values()].map((p) => ({ ...p, faturamento: Number(p.faturamento.toFixed(2)) })));
});
