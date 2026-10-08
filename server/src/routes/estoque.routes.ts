import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { registrarMovimentacao } from '../lib/movimentacaoEstoque.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { requireAuth } from '../middleware/auth.js';
import { requireFeaturePlano } from '../middleware/plano.js';
import { requerirAcao, requerirAdmin, requerirTela } from '../middleware/permissao.js';

export const estoqueRouter = Router();
estoqueRouter.use(requireAuth, requerirTela(['estoque']));

const entradaSchema = z.object({
  productId: z.string().min(1),
  quantidade: z.number().int().positive(),
  precoCustoUnitario: z.number().nonnegative().optional(),
  observacao: z.string().optional(),
});

estoqueRouter.post('/entrada', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const parse = entradaSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }
  const { productId, quantidade, precoCustoUnitario, observacao } = parse.data;

  try {
    const transacao = await prisma.$transaction(async (tx) => {
      const produto = await tx.produto.findFirst({ where: { id: productId, tenantId } });
      if (!produto) throw new Error('Produto não encontrado.');

      const custoUnitario = precoCustoUnitario ?? Number(produto.precoCusto);

      await tx.produto.update({
        where: { id: produto.id },
        data: {
          quantidadeEmEstoque: { increment: quantidade },
          precoCusto: precoCustoUnitario ?? undefined,
        },
      });

      await registrarMovimentacao(tx, { tenantId, produtoId: produto.id, tipo: 'ENTRADA', quantidade, usuarioId, motivo: observacao });

      return tx.transacao.create({
        data: {
          tenantId,
          tipo: 'ENTRADA',
          valorTotal: Number((custoUnitario * quantidade).toFixed(2)),
          desconto: 0,
          taxas: 0,
          usuarioId,
          observacao,
          itens: {
            create: [
              {
                productId: produto.id,
                nomeProdutoSnapshot: produto.nome,
                quantidade,
                valorUnitarioPraticado: custoUnitario,
                subtotal: Number((custoUnitario * quantidade).toFixed(2)),
              },
            ],
          },
        },
        include: { itens: true },
      });
    });

    res.status(201).json({
      id: transacao.id,
      tenantId: transacao.tenantId,
      tipo: transacao.tipo,
      timestamp: transacao.timestamp.toISOString(),
      valorTotal: Number(transacao.valorTotal),
    });
  } catch (e) {
    res.status(400).json({ erro: e instanceof Error ? e.message : 'Erro ao registrar entrada de estoque.' });
  }
});

const ajusteSchema = z.object({
  productId: z.string().min(1),
  novaQuantidade: z.number().int().nonnegative(),
  motivo: z.string().trim().min(3, 'Explique o motivo do ajuste.').max(191),
});

/** Ajuste de inventário: corrige o saldo para a contagem real, sempre com um motivo
 * (quebra, perda, contagem...). Fica no histórico do produto e na auditoria. Só
 * administrador e gerente: ajustar saldo é o jeito clássico de esconder desvio. */
estoqueRouter.post('/ajuste', requerirAcao('estoque.ajustar'), async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;

  const parse = ajusteSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' });
  const { productId, novaQuantidade, motivo } = parse.data;

  const resultado = await prisma.$transaction(async (tx) => {
    const produto = await tx.produto.findFirst({ where: { id: productId, tenantId } });
    if (!produto) return null;
    const diferenca = novaQuantidade - produto.quantidadeEmEstoque;
    if (diferenca === 0) return { produto, diferenca };
    await tx.produto.update({ where: { id: produto.id }, data: { quantidadeEmEstoque: novaQuantidade } });
    await registrarMovimentacao(tx, { tenantId, produtoId: produto.id, tipo: 'AJUSTE', quantidade: diferenca, usuarioId, motivo });
    return { produto, diferenca };
  });
  if (!resultado) return res.status(404).json({ erro: 'Produto não encontrado.' });
  if (resultado.diferenca === 0) return res.status(400).json({ erro: 'A quantidade informada é igual à atual.' });

  await registrarAuditoria(tenantId, usuarioId, 'estoque.ajuste', `${resultado.produto.nome}: ${resultado.diferenca > 0 ? '+' : ''}${resultado.diferenca} (${motivo})`);
  res.json({ quantidadeEmEstoque: novaQuantidade, diferenca: resultado.diferenca });
});

/** Lojas da mesma empresa para onde esta pessoa pode transferir (a que ela mesma acessa). */
async function lojasDeDestino(usuarioId: string, tenantIdAtual: string) {
  const atual = await prisma.tenant.findUnique({ where: { id: tenantIdAtual }, select: { empresaId: true } });
  if (!atual) return [];
  const [usuario, acessos] = await Promise.all([
    prisma.usuario.findUnique({ where: { id: usuarioId }, select: { tenantId: true } }),
    prisma.acessoLoja.findMany({ where: { usuarioId }, select: { tenantId: true } }),
  ]);
  const permitidas = new Set([usuario?.tenantId, ...acessos.map((a) => a.tenantId)].filter(Boolean) as string[]);
  const lojas = await prisma.tenant.findMany({
    where: { empresaId: atual.empresaId, ativo: true, id: { in: [...permitidas], not: tenantIdAtual } },
    select: { id: true, nomeFantasia: true },
    orderBy: { nomeFantasia: 'asc' },
  });
  return lojas;
}

estoqueRouter.get('/lojas-destino', requireFeaturePlano('multiLoja'), async (req, res) => {
  res.json(await lojasDeDestino(req.usuario!.id, req.usuario!.tenantId));
});

const transferenciaSchema = z.object({
  destinoTenantId: z.string().min(1),
  itens: z.array(z.object({ productId: z.string().min(1), quantidade: z.number().int().positive() })).min(1).max(100),
  observacao: z.string().trim().max(191).optional(),
});

/** Move saldo da loja atual para outra loja da mesma empresa. O produto é casado pelo SKU na
 * loja de destino; se ainda não existir lá, é criado (mesmos dados, categoria de mesmo nome). */
estoqueRouter.post('/transferir', requireFeaturePlano('multiLoja'), requerirAcao('estoque.ajustar'), async (req, res) => {
  const { tenantId: origemId, id: usuarioId } = req.usuario!;
  const parse = transferenciaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  const { destinoTenantId, itens, observacao } = parse.data;

  const destinos = await lojasDeDestino(usuarioId, origemId);
  const destino = destinos.find((l) => l.id === destinoTenantId);
  if (!destino) return res.status(403).json({ erro: 'Você não tem acesso a essa loja de destino.' });

  const ids = itens.map((i) => i.productId);
  if (new Set(ids).size !== ids.length) return res.status(400).json({ erro: 'Há produtos repetidos na transferência.' });

  try {
    const resultado = await prisma.$transaction(async (tx) => {
      const origem = await tx.tenant.findUniqueOrThrow({ where: { id: origemId }, select: { nomeFantasia: true } });
      const motivoSaida = `Transferência para ${destino.nomeFantasia}${observacao ? `: ${observacao}` : ''}`;
      const motivoEntrada = `Transferência de ${origem.nomeFantasia}${observacao ? `: ${observacao}` : ''}`;
      const movidos: Array<{ produto: string; quantidade: number }> = [];

      for (const item of itens) {
        const produto = await tx.produto.findFirst({ where: { id: item.productId, tenantId: origemId }, include: { categoria: true } });
        if (!produto) throw new Error('Produto não encontrado.');

        // Só sai se houver saldo (condicional: duas transferências ao mesmo tempo não zeram além do estoque).
        const saiu = await tx.produto.updateMany({
          where: { id: produto.id, quantidadeEmEstoque: { gte: item.quantidade } },
          data: { quantidadeEmEstoque: { decrement: item.quantidade } },
        });
        if (saiu.count === 0) throw new Error(`Estoque insuficiente de "${produto.nome}".`);
        await registrarMovimentacao(tx, { tenantId: origemId, produtoId: produto.id, tipo: 'TRANSFERENCIA', quantidade: -item.quantidade, usuarioId, motivo: motivoSaida });

        let alvo = await tx.produto.findFirst({ where: { tenantId: destino.id, sku: produto.sku } });
        if (!alvo) {
          const categoria =
            (await tx.categoria.findFirst({ where: { tenantId: destino.id, nome: produto.categoria.nome } })) ??
            (await tx.categoria.create({ data: { tenantId: destino.id, nome: produto.categoria.nome } }));
          alvo = await tx.produto.create({
            data: {
              tenantId: destino.id,
              nome: produto.nome,
              sku: produto.sku,
              codigoBarras: produto.codigoBarras,
              categoriaId: categoria.id,
              precoCusto: produto.precoCusto,
              precoVenda: produto.precoVenda,
              quantidadeEmEstoque: 0,
              estoqueMinimo: produto.estoqueMinimo,
            },
          });
        }
        await tx.produto.update({ where: { id: alvo.id }, data: { quantidadeEmEstoque: { increment: item.quantidade } } });
        await registrarMovimentacao(tx, { tenantId: destino.id, produtoId: alvo.id, tipo: 'TRANSFERENCIA', quantidade: item.quantidade, usuarioId, motivo: motivoEntrada });
        movidos.push({ produto: produto.nome, quantidade: item.quantidade });
      }
      return movidos;
    });

    await registrarAuditoria(origemId, usuarioId, 'Transferiu estoque', `${resultado.length} produto(s) para ${destino.nomeFantasia}`);
    res.status(201).json({ destino: destino.nomeFantasia, itens: resultado });
  } catch (e) {
    res.status(400).json({ erro: e instanceof Error ? e.message : 'Erro ao transferir.' });
  }
});
