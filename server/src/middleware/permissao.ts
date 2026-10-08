import type { NextFunction, Request, Response } from 'express';
import { ACOES, podeFazer, type Acao } from '../config/acoes.js';

export type Tela = 'dashboard' | 'pdv' | 'estoque' | 'financeiro' | 'clientes' | 'vendedores' | 'relatorios';

interface AcessoUsuario {
  papel: string;
  permissoes?: unknown;
  raiz?: boolean;
}

/** Mesma regra do front (src/utils/permissoes.ts), agora aplicada no servidor:
 * esconder o menu não impede ninguém de chamar a API direto.
 * - ADMIN sempre pode; conta sem `permissoes` definido (anterior ao recurso) também;
 * - "vendedores" é exclusivo da conta principal da loja. */
export function podeAcessarTela(u: AcessoUsuario, tela: Tela): boolean {
  if (tela === 'vendedores') return u.raiz === true;
  if (u.papel === 'ADMIN') return true;
  if (!Array.isArray(u.permissoes)) return true;
  return u.permissoes.includes(tela);
}

const METODOS_DE_LEITURA = new Set(['GET', 'HEAD', 'OPTIONS']);

/** Exige acesso a pelo menos uma das `telas` pra qualquer método. Em `leitura`
 * ficam telas que só precisam LER os dados (ex: o PDV lê produtos, clientes e
 * vendedores, mas não os altera): GET passa com qualquer uma delas. */
export function requerirTela(telas: Tela[], opcoes: { leitura?: Tela[] } = {}) {
  return (req: Request, res: Response, next: NextFunction) => {
    const usuario = req.usuario;
    if (!usuario) return res.status(401).json({ erro: 'Não autenticado.' });

    const aceitas = METODOS_DE_LEITURA.has(req.method) ? [...telas, ...(opcoes.leitura ?? [])] : telas;
    if (aceitas.some((tela) => podeAcessarTela(usuario, tela))) return next();

    return res.status(403).json({ erro: 'Você não tem permissão para acessar esta área.' });
  };
}

/** Só administradores da loja (papel ADMIN, conferido no banco a cada requisição). */
export function requerirAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.usuario?.papel !== 'ADMIN') {
    return res.status(403).json({ erro: 'Só administradores da loja podem fazer isso.' });
  }
  next();
}

/** Exige uma ação específica (ver config/acoes.ts). A mensagem diz o que faltou. */
export function requerirAcao(acao: Acao) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.usuario && podeFazer(req.usuario, acao)) return next();
    return res.status(403).json({ erro: `Seu perfil não tem permissão para: ${ACOES[acao].toLowerCase()}. Peça a um administrador.` });
  };
}
