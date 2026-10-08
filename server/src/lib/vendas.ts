import type { FormaPagamento } from '@prisma/client';
import { arredondar } from '../config/pdv.js';

/** Filtro de "venda que vale": é uma venda (não uma entrada de estoque) e não foi cancelada.
 * Usado em TODA soma de vendas (caixa, relatórios, financeiro, dashboard), pra uma venda
 * cancelada nunca contar em total nenhum. */
export const VENDA_VALIDA = { tipo: 'SAIDA', cancelada: false } as const;

interface VendaComPagamentos {
  valorTotal: unknown;
  taxas: unknown;
  formaPagamento: FormaPagamento | null;
  pagamentos?: Array<{ forma: FormaPagamento; valor: unknown }>;
}

/** As formas de pagamento da venda com o valor que CADA UMA arrecadou, já com a taxa do
 * cartão somada nas partes de crédito (assim a soma bate com o valor total da venda).
 * Vendas antigas, sem registro de pagamentos, contam como uma forma só. */
export function pagamentosEfetivos(v: VendaComPagamentos): Array<{ forma: FormaPagamento | 'OUTRO'; valor: number }> {
  if (!v.pagamentos || v.pagamentos.length === 0) {
    return [{ forma: v.formaPagamento ?? 'OUTRO', valor: Number(v.valorTotal) }];
  }
  const taxas = Number(v.taxas);
  const baseCredito = v.pagamentos.filter((p) => p.forma === 'CARTAO_CREDITO').reduce((a, p) => a + Number(p.valor), 0);
  return v.pagamentos.map((p) => {
    const parteDaTaxa = p.forma === 'CARTAO_CREDITO' && baseCredito > 0 ? taxas * (Number(p.valor) / baseCredito) : 0;
    return { forma: p.forma, valor: arredondar(Number(p.valor) + parteDaTaxa) };
  });
}

/** Soma por forma de pagamento (chave = forma) de várias vendas. */
export function totaisPorForma(vendas: VendaComPagamentos[]): Record<string, number> {
  const mapa = new Map<string, number>();
  for (const v of vendas) {
    for (const p of pagamentosEfetivos(v)) mapa.set(p.forma, (mapa.get(p.forma) ?? 0) + p.valor);
  }
  return Object.fromEntries([...mapa.entries()].map(([k, valor]) => [k, arredondar(valor)]));
}
