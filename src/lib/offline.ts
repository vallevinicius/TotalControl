import { useEffect, useState, useSyncExternalStore } from 'react';
import type { NovaVendaPayload } from '@/services/apiService';
import type { Produto, Transacao } from '@/types';

/**
 * Base do PDV offline: estado de conexão, cache de leitura (IndexedDB) e a fila de vendas
 * feitas sem internet (localStorage). Não importa o apiService de propósito (ele é que avisa
 * este módulo quando a API some ou volta).
 */

// ----------------------------------------------------------------------------
// Conexão
// ----------------------------------------------------------------------------

let apiForaDoAr = false;
const ouvintesConexao = new Set<() => void>();
const notificarConexao = () => ouvintesConexao.forEach((f) => f());

/** O apiService chama isto: uma requisição falhou por rede (true) ou deu certo (false). */
export function marcarApiForaDoAr(fora: boolean): void {
  if (apiForaDoAr === fora) return;
  apiForaDoAr = fora;
  notificarConexao();
}

const navegadorOnline = () => (typeof navigator === 'undefined' ? true : navigator.onLine);

function assinarConexao(f: () => void) {
  ouvintesConexao.add(f);
  window.addEventListener('online', f);
  window.addEventListener('offline', f);
  return () => {
    ouvintesConexao.delete(f);
    window.removeEventListener('online', f);
    window.removeEventListener('offline', f);
  };
}

/** `true` quando dá para falar com a API (o navegador está online e a última chamada não falhou por rede). */
export function useOnline(): boolean {
  return useSyncExternalStore(assinarConexao, () => navegadorOnline() && !apiForaDoAr, () => true);
}

/** Erro de rede (sem resposta) ou gateway fora do ar: a venda pode ir para a fila, o reenvio é seguro (idLocal). */
export function ehFalhaDeConexao(e: unknown): boolean {
  if (e instanceof TypeError) return true;
  const status = (e as { status?: number } | null)?.status;
  return status === 502 || status === 503 || status === 504 || status === 0;
}

// ----------------------------------------------------------------------------
// Cache de leitura (IndexedDB): catálogo de produtos, clientes e afins
// ----------------------------------------------------------------------------

const BANCO = 'total-control-offline';
const LOJA = 'kv';

function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Sem IndexedDB'));
    const req = indexedDB.open(BANCO, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(LOJA);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function guardarCache<T>(chave: string, valor: T): Promise<void> {
  try {
    const db = await abrirBanco();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(LOJA, 'readwrite');
      tx.objectStore(LOJA).put({ valor, salvoEm: Date.now() }, chave);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  } catch {
    // sem cache: o PDV segue funcionando online
  }
}

export async function lerCache<T>(chave: string): Promise<{ valor: T; salvoEm: number } | null> {
  try {
    const db = await abrirBanco();
    const r = await new Promise<{ valor: T; salvoEm: number } | undefined>((resolve, reject) => {
      const req = db.transaction(LOJA, 'readonly').objectStore(LOJA).get(chave);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    db.close();
    return r ?? null;
  } catch {
    return null;
  }
}

export const chaveCache = (tenantId: string, nome: string) => `${tenantId}:${nome}`;

const normalizar = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Mesma busca do servidor (nome, SKU ou código de barras), feita no catálogo guardado no aparelho. */
export function buscarNoCatalogo(produtos: Produto[], termo: string, limite = 20): Produto[] {
  const t = normalizar(termo.trim());
  if (!t) return [];
  return produtos
    .filter((p) => p.ativo !== false && (normalizar(p.nome).includes(t) || normalizar(p.sku).includes(t) || (p.codigoBarras ?? '').includes(termo.trim())))
    .slice(0, limite);
}

// ----------------------------------------------------------------------------
// Fila de vendas feitas offline
// ----------------------------------------------------------------------------

export interface VendaNaFila {
  idLocal: string;
  tenantId: string;
  criadoEm: string;
  payload: NovaVendaPayload;
  /** Para mostrar na lista sem recalcular. */
  total: number;
  resumo: string;
  tentativas: number;
  /** A API recusou (ex.: caixa fechado, preço sem permissão): fica parada até alguém decidir. */
  erro?: string;
}

const chaveFila = (tenantId: string) => `tc.fila.${tenantId}`;
const EVENTO_FILA = 'tc-fila';

function lerFila(tenantId: string): VendaNaFila[] {
  try {
    return JSON.parse(localStorage.getItem(chaveFila(tenantId)) ?? '[]') as VendaNaFila[];
  } catch {
    return [];
  }
}

function gravarFila(tenantId: string, fila: VendaNaFila[]): void {
  localStorage.setItem(chaveFila(tenantId), JSON.stringify(fila));
  window.dispatchEvent(new Event(EVENTO_FILA));
}

export const listarFila = lerFila;

export function enfileirarVenda(venda: Omit<VendaNaFila, 'tentativas' | 'erro'>): void {
  gravarFila(venda.tenantId, [...lerFila(venda.tenantId), { ...venda, tentativas: 0 }]);
}

export function removerDaFila(tenantId: string, idLocal: string): void {
  gravarFila(tenantId, lerFila(tenantId).filter((v) => v.idLocal !== idLocal));
}

/** Tenta de novo uma venda que tinha sido recusada. */
export function reativarNaFila(tenantId: string, idLocal: string): void {
  gravarFila(tenantId, lerFila(tenantId).map((v) => (v.idLocal === idLocal ? { ...v, erro: undefined, tentativas: 0 } : v)));
}

function atualizarNaFila(tenantId: string, idLocal: string, mudanca: Partial<VendaNaFila>): void {
  gravarFila(tenantId, lerFila(tenantId).map((v) => (v.idLocal === idLocal ? { ...v, ...mudanca } : v)));
}

export function useFila(tenantId: string | undefined): VendaNaFila[] {
  const [fila, setFila] = useState<VendaNaFila[]>(() => (tenantId ? lerFila(tenantId) : []));
  useEffect(() => {
    if (!tenantId) return;
    const atualizar = () => setFila(lerFila(tenantId));
    atualizar();
    window.addEventListener(EVENTO_FILA, atualizar);
    window.addEventListener('storage', atualizar);
    return () => {
      window.removeEventListener(EVENTO_FILA, atualizar);
      window.removeEventListener('storage', atualizar);
    };
  }, [tenantId]);
  return fila;
}

const MAX_TENTATIVAS = 6;
let sincronizando = false;

export interface ResultadoSincronizacao {
  enviadas: number;
  recusadas: number;
  avisos: string[];
}

/** Manda a fila, uma venda por vez e na ordem em que foram feitas. Para na primeira falha de conexão. */
export async function sincronizarFila(
  tenantId: string,
  enviar: (payload: NovaVendaPayload) => Promise<Transacao & { avisos?: string[] }>,
): Promise<ResultadoSincronizacao> {
  const resultado: ResultadoSincronizacao = { enviadas: 0, recusadas: 0, avisos: [] };
  if (sincronizando) return resultado;
  sincronizando = true;
  try {
    for (const venda of lerFila(tenantId)) {
      if (venda.erro) continue;
      try {
        const r = await enviar(venda.payload);
        removerDaFila(tenantId, venda.idLocal);
        resultado.enviadas++;
        if (r.avisos) resultado.avisos.push(...r.avisos);
      } catch (e) {
        if (ehFalhaDeConexao(e)) break;
        const status = (e as { status?: number } | null)?.status ?? 0;
        // 401 (sessão vencida e sem renovação): para sem marcar erro, a pessoa precisa entrar de novo.
        if (status === 401) break;
        const tentativas = venda.tentativas + 1;
        const recusadaDeVez = status >= 400 && status < 500;
        if (recusadaDeVez || tentativas >= MAX_TENTATIVAS) {
          atualizarNaFila(tenantId, venda.idLocal, { erro: e instanceof Error ? e.message : 'Recusada pelo servidor.', tentativas });
          resultado.recusadas++;
        } else {
          atualizarNaFila(tenantId, venda.idLocal, { tentativas });
          break;
        }
      }
    }
  } finally {
    sincronizando = false;
  }
  return resultado;
}

export const novoIdLocal = (): string => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}-local`);
