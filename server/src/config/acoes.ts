/**
 * Permissões por AÇÃO: complementam as permissões por tela. A tela diz onde a pessoa
 * entra; a ação diz o que ela pode fazer lá dentro (cancelar venda, mexer no preço...).
 *
 * Cada usuário tem `acoes`: `null` usa o padrão do papel (abaixo); uma lista vale
 * exatamente como está. ADMIN sempre pode tudo, como nas telas.
 */
export const ACOES = {
  'vendas.alterarPreco': 'Alterar o preço de um item na hora da venda',
  'vendas.descontoAlto': 'Dar desconto de até 20% (sem isso, o limite é 5%)',
  'vendas.cancelar': 'Cancelar vendas',
  'caixa.sangria': 'Fazer sangria e suprimento de caixa',
  'estoque.ajustar': 'Ajustar o estoque (inventário)',
  'registros.excluir': 'Excluir produtos, clientes e lançamentos',
} as const;

export type Acao = keyof typeof ACOES;
export const TODAS_AS_ACOES = Object.keys(ACOES) as Acao[];

type Papel = 'ADMIN' | 'GERENTE' | 'OPERADOR_CAIXA';

/** O que cada papel pode fazer quando ninguém personalizou. */
export const ACOES_PADRAO: Record<Papel, Acao[]> = {
  ADMIN: TODAS_AS_ACOES,
  GERENTE: TODAS_AS_ACOES,
  OPERADOR_CAIXA: [],
};

const DESCONTO_BASE = 5;
const DESCONTO_ALTO = 20;

interface UsuarioParaAcoes {
  papel: string;
  acoes?: unknown;
}

/** As ações que a pessoa realmente tem hoje. */
export function acoesEfetivas(u: UsuarioParaAcoes): Acao[] {
  if (u.papel === 'ADMIN') return TODAS_AS_ACOES;
  if (Array.isArray(u.acoes)) return TODAS_AS_ACOES.filter((a) => (u.acoes as unknown[]).includes(a));
  return ACOES_PADRAO[u.papel as Papel] ?? [];
}

export function podeFazer(u: UsuarioParaAcoes, acao: Acao): boolean {
  return acoesEfetivas(u).includes(acao);
}

/** Maior desconto (% do valor da venda) que a pessoa pode dar. */
export function descontoMaximoPercentual(u: UsuarioParaAcoes): number {
  if (u.papel === 'ADMIN') return 100;
  return podeFazer(u, 'vendas.descontoAlto') ? DESCONTO_ALTO : DESCONTO_BASE;
}
