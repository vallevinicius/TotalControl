/**
 * Cliente mínimo da API de Assinaturas (preapproval) do Mercado Pago.
 * Docs: https://www.mercadopago.com.br/developers/pt/reference/subscriptions
 *
 * Configuração (server/.env):
 *   MERCADOPAGO_ACCESS_TOKEN  token da aplicação (obrigatório)
 *   MERCADOPAGO_API_URL       só pra testes com um servidor falso (padrão: API oficial)
 */

import crypto from 'node:crypto';

const BASE_URL = () => (process.env.MERCADOPAGO_API_URL ?? 'https://api.mercadopago.com').replace(/\/$/, '');

export class ErroMercadoPago extends Error {
  constructor(
    message: string,
    public status = 502,
  ) {
    super(message);
  }
}

export function mercadoPagoConfigurado(): boolean {
  return Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN?.trim());
}

async function chamar<T>(caminho: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN?.trim();
  if (!token) throw new ErroMercadoPago('Pagamento indisponível: o Mercado Pago não está configurado.', 503);

  let resposta: Response;
  try {
    resposta = await fetch(`${BASE_URL()}${caminho}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ErroMercadoPago('Não foi possível falar com o Mercado Pago agora. Tente de novo em instantes.');
  }

  const dados = (await resposta.json().catch(() => null)) as (T & { message?: string }) | null;
  if (!resposta.ok) {
    console.error('Mercado Pago', caminho, resposta.status, dados);
    throw new ErroMercadoPago(dados?.message ?? `O Mercado Pago recusou a operação (${resposta.status}).`, resposta.status === 404 ? 404 : 502);
  }
  return dados as T;
}

export interface AssinaturaMp {
  id: string;
  /** pending | authorized | paused | cancelled */
  status: string;
  external_reference?: string;
  next_payment_date?: string;
  init_point?: string;
}

export interface NovaAssinaturaMp {
  motivo: string;
  /** Guardamos "empresaId|PLANO" pra reconhecer a assinatura no webhook. */
  referenciaExterna: string;
  emailPagador: string;
  valor: number;
  urlDeRetorno: string;
  urlDeNotificacao?: string;
}

/** Cria a assinatura em estado "pending" e devolve o link (init_point) onde a
 * pessoa informa o cartão/meio de pagamento no próprio Mercado Pago. */
export function criarAssinatura(d: NovaAssinaturaMp): Promise<AssinaturaMp> {
  return chamar('/preapproval', {
    method: 'POST',
    body: {
      reason: d.motivo,
      external_reference: d.referenciaExterna,
      payer_email: d.emailPagador,
      back_url: d.urlDeRetorno,
      notification_url: d.urlDeNotificacao,
      status: 'pending',
      auto_recurring: { frequency: 1, frequency_type: 'months', transaction_amount: d.valor, currency_id: 'BRL' },
    },
  });
}

export function buscarAssinatura(id: string): Promise<AssinaturaMp> {
  return chamar(`/preapproval/${encodeURIComponent(id)}`);
}

/** Cancelamento no Mercado Pago: não haverá novas cobranças. */
export function cancelarAssinatura(id: string): Promise<AssinaturaMp> {
  return chamar(`/preapproval/${encodeURIComponent(id)}`, { method: 'PUT', body: { status: 'cancelled' } });
}

/** Cobrança recorrente (authorized_payment): serve pra descobrir de qual assinatura veio. */
export async function assinaturaDoPagamento(idPagamento: string): Promise<string | null> {
  const p = await chamar<{ preapproval_id?: string }>(`/authorized_payments/${encodeURIComponent(idPagamento)}`);
  return p.preapproval_id ?? null;
}

/** Confere a assinatura que o Mercado Pago coloca nas notificações (cabeçalho
 * `x-signature`, formato `ts=...,v1=...`, HMAC-SHA256 com o segredo do webhook).
 * Sem MERCADOPAGO_WEBHOOK_SECRET configurado, não há como conferir e devolve true:
 * mesmo assim o estado real é sempre buscado na API do Mercado Pago, então uma
 * notificação forjada não consegue alterar nada. */
export function assinaturaDoWebhookValida(cabecalhos: { assinatura?: string; idRequisicao?: string }, idDoRecurso: string): boolean {
  const segredo = process.env.MERCADOPAGO_WEBHOOK_SECRET?.trim();
  if (!segredo) return true;
  if (!cabecalhos.assinatura) return false;

  const partes = Object.fromEntries(cabecalhos.assinatura.split(',').map((p) => p.trim().split('=') as [string, string]));
  if (!partes.ts || !partes.v1) return false;

  // O Mercado Pago assina com o id em minúsculas quando ele é alfanumérico.
  const manifesto = `id:${idDoRecurso.toLowerCase()};request-id:${cabecalhos.idRequisicao ?? ''};ts:${partes.ts};`;
  const esperado = crypto.createHmac('sha256', segredo).update(manifesto).digest('hex');
  const recebido = Buffer.from(partes.v1, 'hex');
  const calculado = Buffer.from(esperado, 'hex');
  return recebido.length === calculado.length && crypto.timingSafeEqual(recebido, calculado);
}
