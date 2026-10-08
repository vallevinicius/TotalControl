import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * Logs estruturados, identificador por requisição e envio de erros ao Sentry.
 *
 * - Em produção (ou com LOG_FORMATO=json) cada linha é um JSON, pronto para o agregador de logs.
 *   Em desenvolvimento fica legível. Nunca registra corpo, cabeçalhos nem query string
 *   (podem ter senha, token ou dados pessoais).
 * - Sentry: defina SENTRY_DSN e os erros inesperados (500) passam a ser enviados. Sem a variável
 *   não faz nada. Usa a API HTTP do Sentry direto, sem instalar SDK.
 */

const emJson = () => process.env.LOG_FORMATO === 'json' || (process.env.NODE_ENV === 'production' && process.env.LOG_FORMATO !== 'texto');

type Nivel = 'info' | 'warn' | 'error';

export function log(nivel: Nivel, mensagem: string, campos: Record<string, unknown> = {}): void {
  const saida = nivel === 'error' ? console.error : nivel === 'warn' ? console.warn : console.log;
  if (emJson()) {
    saida(JSON.stringify({ t: new Date().toISOString(), nivel, mensagem, ...campos }));
  } else {
    const extras = Object.entries(campos).map(([k, v]) => `${k}=${typeof v === 'object' ? JSON.stringify(v) : v}`);
    saida([mensagem, ...extras].join(' '));
  }
}

declare module 'express-serve-static-core' {
  interface Request {
    idRequisicao?: string;
  }
}

/** Dá um id a cada requisição (devolvido em X-Request-Id) e registra uma linha ao terminar. */
export function registrarRequisicoes(req: Request, res: Response, next: NextFunction): void {
  const recebido = req.get('x-request-id');
  // Aceita o id do proxy só se for curto e simples (evita injetar lixo nos logs).
  req.idRequisicao = recebido && /^[\w.-]{8,64}$/.test(recebido) ? recebido : crypto.randomUUID();
  res.setHeader('X-Request-Id', req.idRequisicao);
  const inicio = process.hrtime.bigint();
  res.on('finish', () => {
    // Health check e testes não enchem o log.
    if (process.env.NODE_ENV === 'test' || req.path.startsWith('/api/health')) return;
    const ms = Number((process.hrtime.bigint() - inicio) / 1_000_000n);
    const nivel: Nivel = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    log(nivel, 'requisicao', {
      id: req.idRequisicao,
      metodo: req.method,
      rota: req.originalUrl.split('?')[0],
      status: res.statusCode,
      ms,
      usuario: req.usuario?.id,
      loja: req.usuario?.tenantId,
    });
  });
  next();
}

interface DsnSentry {
  url: string;
  chave: string;
}

function lerDsn(): DsnSentry | null {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return null;
  try {
    const u = new URL(dsn);
    const projeto = u.pathname.replace(/^\/+/, '');
    if (!u.username || !projeto) return null;
    return { url: `${u.protocol}//${u.host}/api/${projeto}/envelope/`, chave: u.username };
  } catch {
    return null;
  }
}

/** Manda o erro ao Sentry (se configurado). Nunca lança: monitorar não pode causar falha. */
export async function reportarErro(erro: unknown, contexto: { idRequisicao?: string; metodo?: string; rota?: string; usuario?: string } = {}): Promise<void> {
  const dsn = lerDsn();
  if (!dsn) return;
  try {
    const e = erro instanceof Error ? erro : new Error(String(erro));
    const evento = {
      event_id: crypto.randomUUID().replace(/-/g, ''),
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: 'error',
      environment: process.env.NODE_ENV ?? 'development',
      server_name: 'total-control-api',
      exception: { values: [{ type: e.name, value: e.message, stacktrace: { frames: stackParaFrames(e.stack) } }] },
      tags: { rota: contexto.rota, metodo: contexto.metodo, id_requisicao: contexto.idRequisicao },
      user: contexto.usuario ? { id: contexto.usuario } : undefined,
    };
    const envelope = [
      JSON.stringify({ event_id: evento.event_id, sent_at: new Date().toISOString() }),
      JSON.stringify({ type: 'event' }),
      JSON.stringify(evento),
    ].join('\n');
    await fetch(dsn.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=total-control/1.0, sentry_key=${dsn.chave}` },
      body: envelope,
      signal: AbortSignal.timeout(3000),
    });
  } catch {
    // sem alarde: o log local já tem o erro
  }
}

/** "at fn (arquivo:linha:col)" vira os frames que o Sentry entende (do mais antigo ao mais novo). */
function stackParaFrames(stack?: string) {
  return (stack ?? '')
    .split('\n')
    .slice(1)
    .map((linha) => {
      const m = linha.match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
      return m ? { function: m[1] ?? '<anon>', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) } : null;
    })
    .filter((f): f is NonNullable<typeof f> => f !== null)
    .reverse();
}
