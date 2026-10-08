import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { registrarMovimentacao } from '../lib/movimentacaoEstoque.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { requireAuth } from '../middleware/auth.js';
import { requerirAdmin, requerirTela } from '../middleware/permissao.js';

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
estoqueRouter.post('/ajuste', async (req, res) => {
  const { tenantId, id: usuarioId, papel } = req.usuario!;
  if (papel === 'OPERADOR_CAIXA') return res.status(403).json({ erro: 'Só gerente ou administrador ajusta o estoque.' });

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
