import type { FormaPagamento } from '@/types';

/** Mesma taxa que o servidor aplica (server/src/config/pdv.ts): o servidor recalcula, aqui é só pra mostrar o total. */
export const TAXA_CARTAO_CREDITO = 0.05;
export const MAX_PARCELAS = 12;
export const PARCELAS_SEM_JUROS = 3;

export interface LinhaPagamento {
  id: string;
  forma: FormaPagamento;
  valor: number;
  parcelas: number;
}

export interface EstadoPagamento {
  /** false: uma forma só (pega o valor todo). true: várias formas, cada uma com o seu valor. */
  dividido: boolean;
  forma: FormaPagamento;
  parcelas: number;
  linhas: LinhaPagamento[];
}

export const PAGAMENTO_INICIAL: EstadoPagamento = { dividido: false, forma: 'PIX', parcelas: 1, linhas: [] };

const arredondar = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export interface ResultadoPagamento {
  /** O que vai para a API: as formas com o valor (sem a taxa) de cada uma. */
  pagamentos: Array<{ forma: FormaPagamento; valor: number; parcelas: number }>;
  taxa: number;
  total: number;
  /** Quanto da venda ainda não foi coberto (só no modo dividido). Zero = fechou. */
  restante: number;
  valorEmDinheiro: number;
  valido: boolean;
  /** O que falta para poder finalizar, se não for válido. */
  problema?: string;
}

/** Tudo que a tela precisa saber sobre o pagamento, a partir do valor da venda (já com o desconto). */
export function calcularPagamento(e: EstadoPagamento, subtotalComDesconto: number): ResultadoPagamento {
  const pagamentos = e.dividido
    ? e.linhas.filter((l) => l.valor > 0).map((l) => ({ forma: l.forma, valor: arredondar(l.valor), parcelas: l.forma === 'CARTAO_CREDITO' ? l.parcelas : 1 }))
    : [{ forma: e.forma, valor: arredondar(subtotalComDesconto), parcelas: e.forma === 'CARTAO_CREDITO' ? e.parcelas : 1 }];

  const soma = arredondar(pagamentos.reduce((a, p) => a + p.valor, 0));
  const restante = arredondar(subtotalComDesconto - soma);
  const baseCredito = pagamentos.filter((p) => p.forma === 'CARTAO_CREDITO' && p.parcelas > PARCELAS_SEM_JUROS).reduce((a, p) => a + p.valor, 0);
  const taxa = arredondar(baseCredito * TAXA_CARTAO_CREDITO);
  const valorEmDinheiro = arredondar(pagamentos.filter((p) => p.forma === 'DINHEIRO').reduce((a, p) => a + p.valor, 0));

  let problema: string | undefined;
  if (e.dividido && pagamentos.length === 0) problema = 'Informe as formas de pagamento';
  else if (e.dividido && restante > 0.004) problema = `Faltam ${restante.toFixed(2).replace('.', ',')} para fechar o pagamento`;
  else if (e.dividido && restante < -0.004) problema = 'O pagamento passou do valor da venda';

  return { pagamentos, taxa, total: arredondar(subtotalComDesconto + taxa), restante, valorEmDinheiro, valido: !problema, problema };
}
