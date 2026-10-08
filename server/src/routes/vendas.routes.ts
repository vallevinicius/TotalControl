import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { descontoMaximoPercentual, podeFazer } from '../config/acoes.js';
import { registrarMovimentacao } from '../lib/movimentacaoEstoque.js';
import { requerirAcao, requerirTela } from '../middleware/permissao.js';
import { arredondar, MAX_PARCELAS, PARCELAS_SEM_JUROS, TAXA_CARTAO_CREDITO } from '../config/pdv.js';
import { VENDA_VALIDA } from '../lib/vendas.js';
import { mensagemDeValidacao } from '../lib/senha.js';
import { registrarAuditoria } from '../lib/auditoria.js';

const JANELA_DESFAZER_MS = 5 * 60 * 1000;

export const vendasRouter = Router();
vendasRouter.use(requireAuth, requerirTela(['pdv']));

type FormaDePagamento = 'PIX' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'DINHEIRO' | 'BOLETO' | 'OUTRO';

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
  cancelada: boolean;
  motivoCancelamento: string | null;
  pagamentos?: Array<{ forma: string; valor: unknown; parcelas: number }>;
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
    pagamentos: (t.pagamentos ?? []).map((p) => ({ forma: p.forma, valor: Number(p.valor), parcelas: p.parcelas })),
    usuarioId: t.usuarioId,
    clienteId: t.clienteId ?? undefined,
    caixaId: t.caixaId ?? undefined,
    vendedorId: t.vendedorId ?? undefined,
    observacao: t.observacao ?? undefined,
    cancelada: t.cancelada,
    motivoCancelamento: t.motivoCancelamento ?? undefined,
  };
}

vendasRouter.get('/', async (req, res) => {
  const { tenantId } = req.usuario!;
  const transacoes = await prisma.transacao.findMany({
    where: { tenantId, tipo: 'SAIDA' },
    include: { itens: true, pagamentos: true },
    orderBy: { timestamp: 'desc' },
    take: 200, // lista sem paginação: limita pra loja grande não travar a API
  });
  res.json(transacoes.map(serializarTransacao));
});

const FORMAS = ['PIX', 'CARTAO_CREDITO', 'CARTAO_DEBITO', 'DINHEIRO', 'BOLETO', 'OUTRO'] as const;

const novaVendaSchema = z
  .object({
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
    // Uma forma só (jeito antigo, ainda aceito)...
    formaPagamento: z.enum(FORMAS).optional(),
    parcelas: z.number().int().min(1).max(MAX_PARCELAS).optional(),
    // ...ou várias (venda dividida). A taxa do cartão é SEMPRE calculada aqui no servidor.
    pagamentos: z
      .array(z.object({ forma: z.enum(FORMAS), valor: z.number().positive(), parcelas: z.number().int().min(1).max(MAX_PARCELAS).optional() }))
      .min(1)
      .max(5)
      .optional(),
    clienteId: z.string().optional(),
    vendedorId: z.string().optional(),
    // Venda vinda do PDV (inclusive da fila offline): o id evita duplicar no reenvio...
    idLocal: z.string().regex(/^[\w-]{8,64}$/).optional(),
    // ...e o horário em que ela de fato aconteceu (só vale junto com idLocal).
    vendidaEm: z.string().datetime().optional(),
  })
  .refine((d) => d.pagamentos || d.formaPagamento, { message: 'Informe a forma de pagamento.', path: ['formaPagamento'] });

vendasRouter.post('/', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const podeAlterarPreco = podeFazer(req.usuario!, 'vendas.alterarPreco');
  const descontoMaximo = descontoMaximoPercentual(req.usuario!);
  const parse = novaVendaSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: mensagemDeValidacao(parse.error), detalhes: parse.error.flatten() });
  }
  const { itens, desconto = 0, clienteId, vendedorId, idLocal } = parse.data;

  // Mesmo idLocal já registrado: devolve a venda existente (reenvio seguro, nada duplica).
  if (idLocal) {
    const existente = await prisma.transacao.findUnique({
      where: { tenantId_idLocal: { tenantId, idLocal } },
      include: { itens: true, pagamentos: true },
    });
    if (existente) return res.status(200).json(serializarTransacao(existente));
  }
  // Venda que ficou na fila do aparelho: o estoque pode ter mudado nesse meio-tempo, mas a mercadoria
  // já saiu do balcão. Não recusa: registra, baixa o que houver e avisa a divergência.
  const veioDaFila = Boolean(idLocal);
  const agora = Date.now();
  const horario = parse.data.vendidaEm && idLocal ? new Date(parse.data.vendidaEm).getTime() : agora;
  const dataDaVenda = horario >= agora - 7 * 86_400_000 && horario <= agora + 5 * 60_000 ? new Date(horario) : new Date(agora);
  const divergencias: string[] = [];

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
        if (!veioDaFila && produto.quantidadeEmEstoque < item.quantidade) {
          throw new Error(`Estoque insuficiente para "${produto.nome}". Disponível: ${produto.quantidadeEmEstoque}.`);
        }
        const valorUnitario = item.precoUnitario ?? Number(produto.precoVenda);
        // Preço diferente do cadastrado é ajuste manual: exige a ação "alterar preço".
        if (Math.abs(valorUnitario - Number(produto.precoVenda)) > 0.004) {
          if (!podeAlterarPreco) {
            throw new Error(`Seu perfil não pode alterar o preço de "${produto.nome}". Peça a um gerente.`);
          }
          ajustesDePreco.push(`${produto.nome}: ${Number(produto.precoVenda).toFixed(2)} -> ${valorUnitario.toFixed(2)}`);
        }
        itensResolvidos.push({
          productId: produto.id,
          nomeProdutoSnapshot: produto.nome,
          quantidade: item.quantidade,
          valorUnitarioPraticado: valorUnitario,
          subtotal: arredondar(valorUnitario * item.quantidade),
        });
      }

      const valorBruto = arredondar(itensResolvidos.reduce((acc, i) => acc + i.subtotal, 0));
      if (desconto > valorBruto + 0.004) throw new Error('O desconto não pode ser maior que o valor da venda.');
      const percentualDesconto = valorBruto > 0 ? (desconto / valorBruto) * 100 : 0;
      if (percentualDesconto > descontoMaximo + 0.004) {
        throw new Error(`Seu perfil pode dar no máximo ${descontoMaximo}% de desconto. Peça a um gerente.`);
      }
      auditoriaDoAjuste = [
        desconto > 0 ? `desconto ${percentualDesconto.toFixed(1)}% (R$ ${desconto.toFixed(2)})` : '',
        ...ajustesDePreco,
      ].filter(Boolean).join('; ');

      // Formas de pagamento: o que o cliente paga (sem a taxa) tem de fechar com o total da venda.
      const subtotalComDesconto = arredondar(valorBruto - desconto);
      const pagamentos: Array<{ forma: FormaDePagamento; valor: number; parcelas: number }> = parse.data.pagamentos
        ? parse.data.pagamentos.map((p) => ({ forma: p.forma, valor: arredondar(p.valor), parcelas: p.forma === 'CARTAO_CREDITO' ? (p.parcelas ?? 1) : 1 }))
        : [{ forma: parse.data.formaPagamento!, valor: subtotalComDesconto, parcelas: parse.data.formaPagamento === 'CARTAO_CREDITO' ? (parse.data.parcelas ?? 1) : 1 }];
      const somaPagamentos = arredondar(pagamentos.reduce((a, p) => a + p.valor, 0));
      if (Math.abs(somaPagamentos - subtotalComDesconto) > 0.01) {
        throw new Error(`A soma das formas de pagamento (R$ ${somaPagamentos.toFixed(2)}) não bate com o valor da venda (R$ ${subtotalComDesconto.toFixed(2)}).`);
      }

      const baseCredito = pagamentos.filter((p) => p.forma === 'CARTAO_CREDITO' && p.parcelas > PARCELAS_SEM_JUROS).reduce((a, p) => a + p.valor, 0);
      const taxas = arredondar(baseCredito * TAXA_CARTAO_CREDITO);
      const valorTotal = arredondar(subtotalComDesconto + taxas);
      const principal = [...pagamentos].sort((a, b) => b.valor - a.valor)[0];
      const parcelasDoCredito = Math.max(1, ...pagamentos.filter((p) => p.forma === 'CARTAO_CREDITO').map((p) => p.parcelas));

      const novaTransacao = await tx.transacao.create({
        data: {
          tenantId,
          tipo: 'SAIDA',
          timestamp: dataDaVenda,
          idLocal,
          valorTotal,
          desconto,
          taxas,
          parcelas: parcelasDoCredito,
          formaPagamento: principal.forma,
          usuarioId,
          clienteId: clienteId || undefined,
          caixaId: caixaAberto.id,
          vendedorId: vendedorId || undefined,
          itens: { create: itensResolvidos },
          pagamentos: { create: pagamentos },
        },
        include: { itens: true, pagamentos: true },
      });

      // Baixa condicional: só decrementa se ainda houver saldo no momento da
      // escrita. Duas vendas simultâneas do mesmo item não deixam o estoque
      // negativo (a checagem lá em cima é só pra mensagem amigável).
      for (const item of itensResolvidos) {
        const baixa = await tx.produto.updateMany({
          where: { id: item.productId, tenantId, quantidadeEmEstoque: { gte: item.quantidade } },
          data: { quantidadeEmEstoque: { decrement: item.quantidade } },
        });
        let baixado = item.quantidade;
        if (baixa.count === 0) {
          if (!veioDaFila) throw new Error(`Estoque insuficiente para "${item.nomeProdutoSnapshot}".`);
          // Venda da fila: zera o que sobrou (sem ficar negativo) e registra a diferença.
          const atual = await tx.produto.findUniqueOrThrow({ where: { id: item.productId }, select: { quantidadeEmEstoque: true } });
          baixado = Math.max(0, atual.quantidadeEmEstoque);
          await tx.produto.update({ where: { id: item.productId }, data: { quantidadeEmEstoque: 0 } });
          divergencias.push(`"${item.nomeProdutoSnapshot}": vendidas ${item.quantidade}, havia ${baixado} no estoque`);
        }
        await registrarMovimentacao(tx, {
          tenantId, produtoId: item.productId, tipo: 'VENDA', quantidade: -baixado, usuarioId, referenciaId: novaTransacao.id,
          motivo: baixado < item.quantidade ? `Venda offline sem saldo suficiente (vendidas ${item.quantidade})` : undefined,
        });
      }

      return novaTransacao;
    });

    if (auditoriaDoAjuste) await registrarAuditoria(tenantId, usuarioId, 'venda.ajuste', auditoriaDoAjuste);
    if (divergencias.length > 0) await registrarAuditoria(tenantId, usuarioId, 'venda.estoque_divergente', divergencias.join('; '));
    res.status(201).json({ ...serializarTransacao(transacao), avisos: divergencias.length > 0 ? [`Estoque divergente: ${divergencias.join('; ')}`] : undefined });
  } catch (e) {
    // Duas requisições com o mesmo idLocal ao mesmo tempo: a segunda cai aqui (índice único) e recebe a venda da primeira.
    if (idLocal && typeof e === 'object' && e && (e as { code?: string }).code === 'P2002') {
      const existente = await prisma.transacao.findUnique({ where: { tenantId_idLocal: { tenantId, idLocal } }, include: { itens: true, pagamentos: true } });
      if (existente) return res.status(200).json(serializarTransacao(existente));
    }
    res.status(400).json({ erro: e instanceof Error ? e.message : 'Erro ao registrar venda.' });
  }
});

/** Cancela uma venda: devolve o estoque e a tira de todos os totais, mas ela continua
 * registrada (com quem cancelou, quando e por quê). Nada é apagado. */
async function cancelarVenda(tenantId: string, vendaId: string, usuarioId: string, motivo: string) {
  return prisma.$transaction(async (tx) => {
    const venda = await tx.transacao.findFirst({ where: { id: vendaId, tenantId, tipo: 'SAIDA' }, include: { itens: true } });
    if (!venda) return { erro: 'Venda não encontrada.', status: 404 as const };
    if (venda.cancelada) return { erro: 'Esta venda já foi cancelada.', status: 409 as const };

    // Só vendas do caixa aberto: depois do fechamento, o total do turno já foi conferido e entregue.
    const caixa = venda.caixaId ? await tx.caixa.findUnique({ where: { id: venda.caixaId } }) : null;
    if (!caixa || caixa.status !== 'ABERTO') {
      return { erro: 'Só dá para cancelar vendas do caixa aberto. Para esta, faça um lançamento no financeiro.', status: 409 as const };
    }

    // Marca primeiro, de forma condicional: dois cancelamentos simultâneos não devolvem o estoque duas vezes.
    const marcada = await tx.transacao.updateMany({
      where: { id: venda.id, cancelada: false },
      data: { cancelada: true, canceladaEm: new Date(), canceladaPorId: usuarioId, motivoCancelamento: motivo },
    });
    if (marcada.count === 0) return { erro: 'Esta venda já foi cancelada.', status: 409 as const };

    for (const item of venda.itens) {
      await tx.produto.update({ where: { id: item.productId }, data: { quantidadeEmEstoque: { increment: item.quantidade } } });
      await registrarMovimentacao(tx, { tenantId, produtoId: item.productId, tipo: 'ESTORNO', quantidade: item.quantidade, usuarioId, motivo: `Venda cancelada: ${motivo}`, referenciaId: venda.id });
    }
    return { venda };
  });
}

const cancelarSchema = z.object({ motivo: z.string().trim().min(3, 'Explique o motivo do cancelamento.').max(191) });

vendasRouter.post('/:id/cancelar', requerirAcao('vendas.cancelar'), async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const parse = cancelarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: parse.error.issues[0]?.message ?? 'Informe o motivo.' });

  const r = await cancelarVenda(tenantId, req.params.id, usuarioId, parse.data.motivo);
  if (!r.venda) return res.status(r.status ?? 400).json({ erro: r.erro });
  await registrarAuditoria(tenantId, usuarioId, 'venda.cancelar', `Venda de R$ ${Number(r.venda.valorTotal).toFixed(2)}: ${parse.data.motivo}`);
  res.status(204).end();
});

/** Desfaz a última venda do turno de caixa aberto, logo depois de feita (até 5 minutos), pra
 * corrigir erro de digitação. Qualquer operador do PDV pode; é um cancelamento comum
 * (a venda fica registrada como cancelada), só que sem pedir motivo. */
vendasRouter.post('/ultima/desfazer', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;

  const caixaAberto = await prisma.caixa.findFirst({ where: { tenantId, status: 'ABERTO' } });
  if (!caixaAberto) return res.status(400).json({ erro: 'Nenhum caixa aberto.' });

  const ultimaVenda = await prisma.transacao.findFirst({
    where: { tenantId, ...VENDA_VALIDA, caixaId: caixaAberto.id },
    orderBy: { timestamp: 'desc' },
  });
  if (!ultimaVenda) return res.status(404).json({ erro: 'Nenhuma venda pra desfazer neste turno.' });

  if (Date.now() - ultimaVenda.timestamp.getTime() > JANELA_DESFAZER_MS) {
    return res.status(400).json({ erro: 'Só dá pra desfazer uma venda até 5 minutos depois dela. Depois disso, peça a um gerente para cancelá-la.' });
  }

  const r = await cancelarVenda(tenantId, ultimaVenda.id, usuarioId, 'Desfeita logo após a venda');
  if (!r.venda) return res.status(r.status ?? 400).json({ erro: r.erro });
  await registrarAuditoria(tenantId, usuarioId, 'venda.desfazer', `Venda de R$ ${Number(ultimaVenda.valorTotal).toFixed(2)}`);
  res.status(204).send();
});
