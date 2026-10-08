import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { prisma } from '../lib/prisma.js';
import { motivoAcessoExpirado } from '../config/planos.js';

export interface UsuarioAutenticado {
  id: string;
  tenantId: string;
  papel: 'ADMIN' | 'GERENTE' | 'OPERADOR_CAIXA';
  tipo?: undefined;
  /** Versão das sessões do usuário quando o token foi emitido (ver Usuario.tokenVersion). */
  tv?: number;
  /** Preenchidos por requireAuth a partir do banco (não vêm no token, que pode estar velho). */
  raiz?: boolean;
  permissoes?: unknown;
  acoes?: unknown;
}

export interface AdminAutenticado {
  id: string;
  tipo: 'PLATAFORMA';
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      usuario?: UsuarioAutenticado;
      admin?: AdminAutenticado;
    }
  }
}

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET não configurado em server/.env');
}

export function assinarToken(payload: UsuarioAutenticado): string {
  // Curto de propósito: a sessão longa vem do token de renovação (lib/sessao.ts).
  return jwt.sign(payload, JWT_SECRET as string, { expiresIn: (process.env.ACCESS_TOKEN_TTL ?? '30m') as jwt.SignOptions['expiresIn'] });
}

export function assinarTokenAdmin(payload: { id: string }): string {
  const claims: AdminAutenticado = { id: payload.id, tipo: 'PLATAFORMA' };
  return jwt.sign(claims, JWT_SECRET as string, { expiresIn: '2h' });
}

function extrairToken(req: Request): string | null {
  const header = req.headers.authorization;
  return header?.startsWith('Bearer ') ? header.slice(7) : null;
}

/** Autentica usuários de uma loja (tenant). Rejeita tokens do painel admin e
 * de lojas que o dono desativou (o token continua válido até expirar, então
 * a checagem precisa acontecer a cada requisição). */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const token = extrairToken(req);
  if (!token) {
    return res.status(401).json({ erro: 'Token de autenticação ausente.' });
  }

  let payload: UsuarioAutenticado | AdminAutenticado;
  try {
    payload = jwt.verify(token, JWT_SECRET as string) as UsuarioAutenticado | AdminAutenticado;
  } catch (erro) {
    // "Expirado" é o caso normal a cada 30 min: o front renova a sessão e repete.
    if (erro instanceof jwt.TokenExpiredError) return res.status(401).json({ erro: 'Sessão expirada.', codigo: 'TOKEN_EXPIRADO' });
    return res.status(401).json({ erro: 'Token inválido.' });
  }
  // Tokens do painel admin (e o desafio do 2FA) nunca valem como sessão de loja.
  if ('tipo' in payload && payload.tipo) {
    return res.status(403).json({ erro: 'Token de admin não pode ser usado aqui.' });
  }

  // Dados frescos do banco (papel, permissões, conta principal): o token pode ter
  // dias e não reflete mudanças feitas depois do login.
  let usuarioAtual: { papel: UsuarioAutenticado['papel']; raiz: boolean; permissoes: unknown; acoes: unknown };
  try {
    const { id: usuarioId, tenantId } = payload as UsuarioAutenticado;
    const [loja, usuario] = await Promise.all([
      prisma.tenant.findUnique({
        where: { id: tenantId },
        select: {
          ativo: true,
          empresa: { select: { ativo: true, trialExpiraEm: true, assinaturaStatus: true, acessoAte: true } },
        },
      }),
      prisma.usuario.findUnique({ where: { id: usuarioId }, select: { ativo: true, papel: true, raiz: true, permissoes: true, acoes: true, tokenVersion: true } }),
    ]);
    // O token vale até expirar, então o estado de quem o usa é conferido a cada
    // requisição: usuário desativado, loja desativada ou empresa suspensa perdem
    // o acesso na hora, não só no próximo login.
    if (!usuario?.ativo || !loja || (payload as UsuarioAutenticado).tv !== undefined && (payload as UsuarioAutenticado).tv !== usuario.tokenVersion) {
      return res.status(401).json({ erro: 'Sessão inválida. Entre novamente.' });
    }
    usuarioAtual = { papel: usuario.papel, raiz: usuario.raiz, permissoes: usuario.permissoes, acoes: usuario.acoes };
    if (!loja.ativo) {
      return res.status(403).json({ erro: 'Esta loja foi desativada.' });
    }
    if (!loja.empresa.ativo) {
      return res.status(403).json({ erro: 'Esta empresa está suspensa. Fale com o suporte.' });
    }
    // Teste grátis acabado ou assinatura cancelada com o período já vencido: o
    // login continua valendo, mas só a sessão e a tela do plano funcionam, pra
    // a pessoa conseguir assinar de novo.
    const liberadas = req.originalUrl.startsWith('/api/assinatura') || req.originalUrl.startsWith('/api/auth');
    if (loja && !liberadas && motivoAcessoExpirado(loja.empresa)) {
      return res.status(402).json({ erro: 'Seu acesso expirou. Escolha um plano para continuar.', codigo: 'ACESSO_EXPIRADO' });
    }
  } catch (erro) {
    return next(erro);
  }

  req.usuario = { ...(payload as UsuarioAutenticado), papel: usuarioAtual.papel, raiz: usuarioAtual.raiz, permissoes: usuarioAtual.permissoes, acoes: usuarioAtual.acoes };
  next();
}

/** Autentica o admin interno da Total Software (painel /admin). */
export function requirePlatformAdmin(req: Request, res: Response, next: NextFunction) {
  const token = extrairToken(req);
  if (!token) {
    return res.status(401).json({ erro: 'Token de autenticação ausente.' });
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET as string) as UsuarioAutenticado | AdminAutenticado;
    if (!('tipo' in payload) || payload.tipo !== 'PLATAFORMA') {
      return res.status(403).json({ erro: 'Acesso restrito ao painel administrativo.' });
    }
    req.admin = payload;
    next();
  } catch {
    return res.status(401).json({ erro: 'Token inválido ou expirado.' });
  }
}
