import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { POLITICA_PDV } from '../config/planos.js';
import { registrarMovimentacao } from '../lib/movimentacaoEstoque.js';
import { requerirAdmin, requerirTela } from '../middleware/permissao.js';
import { registrarAuditoria } from '../lib/auditoria.js';

const JANELA_DESFAZER_MS = 5 * 60 * 1000;

export const vendasRouter = Router();
vendasRouter.use(requireAuth, requerirTela(['pdv']));

function serializarTransacao(t: {
  id: string;
  tenantId: string;
  tipo: string;
  timestamp: Date;
  valorTotal: unknown;
  desconto: unknown;
  taxas: unknown;
  parcelas: number;
  formaPagamento: string | null;
  usuarioId: string;
  clienteId: string | null;
  caixaId: string | null;
  vendedorId: string | null;
  observacao: string | null;
  itens: Array<{
    productId: string;
    nomeProdutoSnapshot: string;
    quantidade: number;
    valorUnitarioPraticado: unknown;
    subtotal: unknown;
  }>;
}) {
  return {
    id: t.id,
    tenantId: t.tenantId,
    tipo: t.tipo,
    timestamp: t.timestamp.toISOString(),
    itens: t.itens.map((i) => ({
      productId: i.productId,
      nomeProdutoSnapshot: i.nomeProdutoSnapshot,
      quantidade: i.quantidade,
      valorUnitarioPraticado: Number(i.valorUnitarioPraticado),
      subtotal: Number(i.subtotal),
    })),
    valorTotal: Number(t.valorTotal),
    desconto: Number(t.desconto),
    taxas: Number(t.taxas),
    parcelas: t.parcelas,
    formaPagamento: t.formaPagamento ?? undefined,
    usuarioId: t.usuarioId,
    clienteId: t.clienteId ?? undefined,
    caixaId: t.caixaId ?? undefined,
    vendedorId: t.vendedorId ?? undefined,
    observacao: t.observacao ?? undefined,
  };
}

vendasRouter.get('/', async (req, res) => {
  const { tenantId } = req.usuario!;
  const transacoes = await prisma.transacao.findMany({
    where: { tenantId, tipo: 'SAIDA' },
    include: { itens: true },
    orderBy: { timestamp: 'desc' },
    take: 200, // lista sem paginação: limita pra loja grande não travar a API
  });
  res.json(transacoes.map(serializarTransacao));
});

const novaVendaSchema = z.object({
  itens: z
    .array(
      z.object({
        productId: z.string().min(1),
        quantidade: z.number().int().positive(),
        // Preço praticado nesse item, se o operador ajustou manualmente na
        // hora da venda. Se ausente, usa o preço de venda atual do produto.
        precoUnitario: z.number().nonnegative().optional(),
      }),
    )
    .min(1),
  desconto: z.number().nonnegative().optional(),
  taxas: z.number().nonnegative().optional(),
  parcelas: z.number().int().min(1).max(3).optional(),
  formaPagamento: z.enum(['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'BOLETO', 'OUTRO']),
  clienteId: z.string().optional(),
  vendedorId: z.string().optional(),
});

vendasRouter.post('/', async (req, res) => {
  const { tenantId, id: usuarioId, papel } = req.usuario!;
  const politica = POLITICA_PDV[papel];
  const parse = novaVendaSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }
  const { itens, desconto = 0, taxas = 0, parcelas = 1, formaPagamento, clienteId, vendedorId } = parse.data;

  const caixaAberto = await prisma.caixa.findFirst({ where: { tenantId, status: 'ABERTO' } });
  if (!caixaAberto) {
    return res.status(400).json({ erro: 'Abra o caixa antes de registrar uma venda.' });
  }

  if (vendedorId) {
    const vendedor = await prisma.vendedor.findFirst({ where: { id: vendedorId, tenantId } });
    if (!vendedor) return res.status(400).json({ erro: 'Vendedor inválido.' });
  } else {
    // Vendedor só é obrigatório pra lojas que já cadastraram algum — lojas
    // que ainda não usam o recurso continuam vendendo normalmente.
    const existeVendedor = await prisma.vendedor.findFirst({ where: { tenantId, ativo: true } });
    if (existeVendedor) return res.status(400).json({ erro: 'Selecione o vendedor responsável pela venda.' });
  }

  let auditoriaDoAjuste = '';
  try {
    const transacao = await prisma.$transaction(async (tx) => {
      const ajustesDePreco: string[] = [];
      const itensResolvidos: Array<{
        productId: string;
        nomeProdutoSnapshot: string;
        quantidade: number;
        valorUnitarioPraticado: number;
        subtotal: number;
      }> = [];

      for (const item of itens) {
        const produto = await tx.produto.findFirst({ where: { id: item.productId, tenantId } });
        if (!produto) throw new Error(`Produto ${item.productId} não encontrado.`);
        if (produto.quantidadeEmEstoque < item.quantidade) {
          throw new Error(`Estoque insuficiente para "${produto.nome}". Disponível: ${produto.quantidadeEmEstoque}.`);
        }
        const valorUnitario = item.precoUnitario ?? Number(produto.precoVenda);
        // Preço diferente do cadastrado é ajuste manual: só gerente e admin.
        if (Math.abs(valorUnitario - Number(produto.precoVenda)) > 0.004) {
          if (!politica.podeAlterarPreco) {
            throw new Error(`Seu perfil não pode alterar o preço de "${produto.nome}". Peça a um gerente.`);
          }
          ajustesDePreco.push(`${produto.nome}: ${Number(produto.precoVenda).toFixed(2)} -> ${valorUnitario.toFixed(2)}`);
        }
        itensResolvidos.push({
          productId: produto.id,
          nomeProdutoSnapshot: produto.nome,
          quantidade: item.quantidade,
          valorUnitarioPraticado: valorUnitario,
          subtotal: Number((valorUnitario * item.quantidade).toFixed(2)),
        });
      }

      const valorBruto = itensResolvidos.reduce((acc, i) => acc + i.subtotal, 0);
      if (desconto > valorBruto + 0.004) throw new Error('O desconto não pode ser maior que o valor da venda.');
      const percentualDesconto = valorBruto > 0 ? (desconto / valorBruto) * 100 : 0;
      if (percentualDesconto > politica.descontoMaximoPercentual + 0.004) {
        throw new Error(`Seu perfil pode dar no máximo ${politica.descontoMaximoPercentual}% de desconto. Peça a um gerente.`);
      }
      auditoriaDoAjuste = [
        desconto > 0 ? `desconto ${percentualDesconto.toFixed(1)}% (R$ ${desconto.toFixed(2)})` : '',
        ...ajustesDePreco,
      ].filter(Boolean).join('; ');
      const valorTotal = Number((valorBruto - desconto + taxas).toFixed(2));

      const novaTransacao = await tx.transacao.create({
        data: {
          tenantId,
          tipo: 'SAIDA',
          valorTotal,
          desconto,
          taxas,
          parcelas,
          formaPagamento,
          usuarioId,
          clienteId: clienteId || undefined,
          caixaId: caixaAberto.id,
          vendedorId: vendedorId || undefined,
          itens: { create: itensResolvidos },
        },
        include: { itens: true },
      });

      // Baixa condicional: só decrementa se ainda houver saldo no momento da
      // escrita. Duas vendas simultâneas do mesmo item não deixam o estoque
      // negativo (a checagem lá em cima é só pra mensagem amigável).
      for (const item of itensResolvidos) {
        const baixa = await tx.produto.updateMany({
          where: { id: item.productId, tenantId, quantidadeEmEstoque: { gte: item.quantidade } },
          data: { quantidadeEmEstoque: { decrement: item.quantidade } },
        });
        if (baixa.count === 0) throw new Error(`Estoque insuficiente para "${item.nomeProdutoSnapshot}".`);
        await registrarMovimentacao(tx, { tenantId, produtoId: item.productId, tipo: 'VENDA', quantidade: -item.quantidade, usuarioId, referenciaId: novaTransacao.id });
      }

      return novaTransacao;
    });

    if (auditoriaDoAjuste) await registrarAuditoria(tenantId, usuarioId, 'venda.ajuste', auditoriaDoAjuste);

    res.status(201).json(serializarTransacao(transacao));
  } catch (e) {
    res.status(400).json({ erro: e instanceof Error ? e.message : 'Erro ao registrar venda.' });
  }
});

/** Desfaz a última venda do turno de caixa aberto — devolve o estoque e
 * apaga a transação. Só nos primeiros minutos depois da venda, pra corrigir
 * erro de digitação sem virar uma forma de apagar vendas antigas escondido
 * (a ação em si fica registrada na auditoria de qualquer forma). */
vendasRouter.post('/ultima/desfazer', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;

  const caixaAberto = await prisma.caixa.findFirst({ where: { tenantId, status: 'ABERTO' } });
  if (!caixaAberto) return res.status(400).json({ erro: 'Nenhum caixa aberto.' });

  const ultimaVenda = await prisma.transacao.findFirst({
    where: { tenantId, tipo: 'SAIDA', caixaId: caixaAberto.id },
    orderBy: { timestamp: 'desc' },
    include: { itens: true },
  });
  if (!ultimaVenda) return res.status(404).json({ erro: 'Nenhuma venda pra desfazer neste turno.' });

  if (Date.now() - ultimaVenda.timestamp.getTime() > JANELA_DESFAZER_MS) {
    return res.status(400).json({ erro: 'Só dá pra desfazer uma venda até 5 minutos depois dela.' });
  }

  await prisma.$transaction(async (tx) => {
    for (const item of ultimaVenda.itens) {
      await tx.produto.update({
        where: { id: item.productId },
        data: { quantidadeEmEstoque: { increment: item.quantidade } },
      });
      await registrarMovimentacao(tx, { tenantId, produtoId: item.productId, tipo: 'ESTORNO', quantidade: item.quantidade, usuarioId, motivo: 'Venda desfeita', referenciaId: ultimaVenda.id });
    }
    await tx.transacao.delete({ where: { id: ultimaVenda.id } });
  });

  await registrarAuditoria(
    tenantId,
    usuarioId,
    'venda.desfazer',
    `Venda de R$ ${Number(ultimaVenda.valorTotal).toFixed(2)}`,
  );
  res.status(204).send();
});
