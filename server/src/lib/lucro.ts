import { arredondar } from '../config/pdv.js';
import { diaNoFuso } from './datas.js';

interface ItemParaCusto {
  quantidade: number;
  custoUnitario: unknown | null;
  produto: { precoCusto: unknown };
}

/** Custo das mercadorias de uma venda: usa o custo gravado na hora da venda; nas vendas
 * antigas (sem custo gravado) cai no custo ATUAL do produto, que é só uma estimativa. */
export function custoDaVenda(itens: ItemParaCusto[]): number {
  return itens.reduce((acc, i) => acc + i.quantidade * Number(i.custoUnitario ?? i.produto.precoCusto), 0);
}

export interface VendaParaLucro {
  timestamp: Date;
  valorTotal: unknown;
  itens: ItemParaCusto[];
}

export interface ResumoDoPeriodo {
  faturamento: number;
  custo: number;
  lucro: number;
  vendas: number;
}

export interface ResumoDeLucro {
  hoje: ResumoDoPeriodo;
  semana: ResumoDoPeriodo;
  mes: ResumoDoPeriodo;
  /** Primeiro dia de cada janela (AAAA-MM-DD), pra a tela mostrar "desde quando". */
  desde: { semana: string; mes: string };
}

/** Segunda-feira da semana de `dia` (AAAA-MM-DD). A semana comercial começa na segunda. */
export function segundaDaSemana(dia: string): string {
  const d = new Date(`${dia}T00:00:00Z`);
  const diasDesdeSegunda = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - diasDesdeSegunda);
  return d.toISOString().slice(0, 10);
}

/** Faturamento, custo e lucro bruto de hoje, da semana (desde segunda) e do mês (desde o dia 1),
 * contando os dias no fuso da loja. Comparar os dias como texto AAAA-MM-DD funciona porque o formato é ordenável. */
export function resumirLucro(vendas: VendaParaLucro[], fuso: string, agora = new Date()): ResumoDeLucro {
  const hoje = diaNoFuso(agora, fuso);
  const desdeSemana = segundaDaSemana(hoje);
  const desdeMes = `${hoje.slice(0, 7)}-01`;

  const acumulado = { hoje: [0, 0, 0], semana: [0, 0, 0], mes: [0, 0, 0] };
  for (const v of vendas) {
    const dia = diaNoFuso(v.timestamp, fuso);
    if (dia > hoje) continue;
    const valor = Number(v.valorTotal);
    const custo = custoDaVenda(v.itens);
    const janelas: Array<keyof typeof acumulado> = [];
    if (dia === hoje) janelas.push('hoje');
    if (dia >= desdeSemana) janelas.push('semana');
    if (dia >= desdeMes) janelas.push('mes');
    for (const j of janelas) {
      acumulado[j][0] += valor;
      acumulado[j][1] += custo;
      acumulado[j][2] += 1;
    }
  }

  const fechar = ([faturamento, custo, vendas]: number[]): ResumoDoPeriodo => ({
    faturamento: arredondar(faturamento),
    custo: arredondar(custo),
    lucro: arredondar(faturamento - custo),
    vendas,
  });
  return {
    hoje: fechar(acumulado.hoje),
    semana: fechar(acumulado.semana),
    mes: fechar(acumulado.mes),
    desde: { semana: desdeSemana, mes: desdeMes },
  };
}
