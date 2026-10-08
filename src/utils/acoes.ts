import type { AcaoUsuario, PapelUsuario, Usuario } from '@/types';

/** Espelha server/src/config/acoes.ts (o servidor é quem decide; aqui é só a lista
 * para a tela de usuários e para esconder botões que não funcionariam). */
export const ACOES_DISPONIVEIS: Array<{ chave: AcaoUsuario; rotulo: string; dica: string }> = [
  { chave: 'vendas.alterarPreco', rotulo: 'Alterar preço na venda', dica: 'Mudar o preço de um item na hora de vender.' },
  { chave: 'vendas.descontoAlto', rotulo: 'Desconto até 20%', dica: 'Sem isso, o limite de desconto é 5%.' },
  { chave: 'vendas.cancelar', rotulo: 'Cancelar vendas', dica: 'Cancelar uma venda do caixa aberto, com motivo.' },
  { chave: 'caixa.sangria', rotulo: 'Sangria e suprimento', dica: 'Retirar ou colocar dinheiro na gaveta durante o turno.' },
  { chave: 'estoque.ajustar', rotulo: 'Ajustar estoque', dica: 'Corrigir o saldo do estoque (inventário).' },
  { chave: 'registros.excluir', rotulo: 'Excluir registros', dica: 'Excluir produtos, clientes e lançamentos financeiros.' },
];

/** O que cada papel pode fazer quando ninguém personalizou. */
export const ACOES_PADRAO_POR_PAPEL: Record<PapelUsuario, AcaoUsuario[]> = {
  ADMIN: ACOES_DISPONIVEIS.map((a) => a.chave),
  GERENTE: ACOES_DISPONIVEIS.map((a) => a.chave),
  OPERADOR_CAIXA: [],
};

export const mesmasAcoes = (a: AcaoUsuario[], b: AcaoUsuario[]) => a.length === b.length && a.every((x) => b.includes(x));

/** A pessoa logada pode fazer esta ação? (a lista vem do /auth/me, já resolvida pelo servidor) */
export function podeFazer(usuario: Pick<Usuario, 'acoes'> | null | undefined, acao: AcaoUsuario): boolean {
  return Boolean(usuario?.acoes?.includes(acao));
}
