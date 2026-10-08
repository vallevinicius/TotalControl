import type { Prisma, TipoMovimentacaoEstoque } from '@prisma/client';

/** Registra uma linha no livro-razão do estoque (MovimentacaoEstoque). Recebe o
 * cliente da transação (`tx`) pra gravar junto com a mudança de saldo: ou as duas
 * coisas acontecem, ou nenhuma. */
export async function registrarMovimentacao(
  tx: Prisma.TransactionClient,
  dados: {
    tenantId: string;
    produtoId: string;
    tipo: TipoMovimentacaoEstoque;
    quantidade: number;
    usuarioId?: string;
    motivo?: string;
    referenciaId?: string;
  },
): Promise<void> {
  if (dados.quantidade === 0) return;
  // Saldo lido DEPOIS da mudança, dentro da mesma transação.
  const produto = await tx.produto.findUniqueOrThrow({ where: { id: dados.produtoId }, select: { quantidadeEmEstoque: true } });
  await tx.movimentacaoEstoque.create({ data: { ...dados, saldoApos: produto.quantidadeEmEstoque } });
}
