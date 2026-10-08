import type { Cliente, Produto } from '@/types';

/** Venda guardada para atender outra pessoa e retomar depois. Fica só neste navegador
 * (localStorage), por loja e por caixa: ao fechar o caixa, as vendas em espera deixam de valer. */
export interface VendaEmEspera {
  id: string;
  caixaId: string;
  criadaEm: string;
  rotulo: string;
  itens: Array<{ produto: Produto; quantidade: number; precoUnitario: number }>;
  cliente: Cliente | null;
  vendedorId: string;
  descontoPercentual: number;
}

const VALIDADE_MS = 24 * 3_600_000;
const chave = (tenantId: string) => `tc-pdv-espera-${tenantId}`;

function ler(tenantId: string): VendaEmEspera[] {
  try {
    const lista = JSON.parse(localStorage.getItem(chave(tenantId)) ?? '[]') as VendaEmEspera[];
    return lista.filter((v) => Date.now() - new Date(v.criadaEm).getTime() < VALIDADE_MS);
  } catch {
    return [];
  }
}

function gravar(tenantId: string, lista: VendaEmEspera[]) {
  try {
    localStorage.setItem(chave(tenantId), JSON.stringify(lista));
  } catch {
    // Armazenamento cheio ou indisponível: a venda em espera não é guardada (a tela avisa).
  }
}

export function listarEmEspera(tenantId: string, caixaId: string): VendaEmEspera[] {
  return ler(tenantId).filter((v) => v.caixaId === caixaId);
}

export function guardarEmEspera(tenantId: string, venda: Omit<VendaEmEspera, 'id' | 'criadaEm'>): VendaEmEspera {
  const nova: VendaEmEspera = { ...venda, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, criadaEm: new Date().toISOString() };
  gravar(tenantId, [...ler(tenantId), nova]);
  return nova;
}

export function removerDaEspera(tenantId: string, id: string) {
  gravar(tenantId, ler(tenantId).filter((v) => v.id !== id));
}
