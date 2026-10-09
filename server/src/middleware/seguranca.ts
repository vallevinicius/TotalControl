import cors from 'cors';
import { log, reportarErro } from '../lib/observabilidade.js';
import type { ErrorRequestHandler, Request } from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/** Origens do front autorizadas a chamar a API pelo navegador. Chamadas sem
 * cabeçalho Origin (servidor a servidor, curl, webhook do Mercado Pago) não
 * passam por CORS e continuam funcionando. Em produção, defina APP_URL (ou
 * CORS_ORIGINS, separado por vírgula). */
function origensPermitidas(): string[] {
  const lista = (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((o) => o.trim().replace(/\/$/, ''))
    .filter(Boolean);
  lista.push((process.env.APP_URL ?? 'http://localhost:3099').replace(/\/$/, ''));
  return lista;
}

export function configurarCors() {
  const permitidas = origensPermitidas();
  return cors({
    origin: (origem, callback) => callback(null, !origem || permitidas.includes(origem)),
  });
}

const aoExceder = { erro: 'Muitas tentativas. Aguarde alguns minutos e tente novamente.' };

function limitador(opcoes: { janelaMin: number; limite: number | (() => number); porConta?: boolean; ignorarSucesso?: boolean }) {
  return rateLimit({
    windowMs: opcoes.janelaMin * 60_000,
    limit: opcoes.limite,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: opcoes.ignorarSucesso ?? false,
    message: aoExceder,
    // Por IP e, quando pedido, também por e-mail: assim um atacante não
    // esgota a cota de outra pessoa, e quem erra a senha só bloqueia a si mesmo.
    keyGenerator: (req: Request) => {
      const ip = ipKeyGenerator(req.ip ?? '');
      return opcoes.porConta ? `${ip}|${String(req.body?.email ?? '').toLowerCase()}` : ip;
    },
  });
}

/** Login de loja: poucas tentativas por IP+e-mail, e um teto por IP (contra quem
 * testa muitos e-mails). Logins que dão certo não entram na conta. */
export const limiteLoginPorConta = limitador({ janelaMin: 15, limite: 8, porConta: true, ignorarSucesso: true });
export const limiteLoginPorIp = limitador({ janelaMin: 15, limite: 60, ignorarSucesso: true });
export const limiteLoginAdmin = limitador({ janelaMin: 15, limite: 8, porConta: true, ignorarSucesso: true });
/** Código do 2FA do admin: só 6 dígitos, então o teto por IP precisa ser baixo. */
export const limiteCodigoAdmin = limitador({ janelaMin: 15, limite: 10, ignorarSucesso: true });
/** Pedido de link de senha: poucos por hora por IP e e-mail (evita encher a caixa de alguém de e-mails). */
export const limiteEsqueciSenha = limitador({ janelaMin: 60, limite: 5, porConta: true });
/** Redefinir/alterar senha: o token é longo, mas o teto segura tentativa em massa. */
export const limiteRedefinirSenha = limitador({ janelaMin: 15, limite: 20 });
/** Renovação de sessão: uso normal é 1 a cada 30 min por pessoa; o teto segura tentativa de adivinhar tokens. */
export const limiteRefresh = limitador({ janelaMin: 15, limite: 60 });
/** Cadastro: segura quem cria contas de teste em série. */
// (LIMITE_CADASTRO_HORA existe para os testes, que criam muitas contas do mesmo IP.)
export const limiteCadastro = limitador({ janelaMin: 60, limite: () => Number(process.env.LIMITE_CADASTRO_HORA) || 5 });
export const limiteWebhook = limitador({ janelaMin: 1, limite: 120 });
/** Teto geral da API por IP, só pra conter abuso grosseiro. */
export const limiteGeral = limitador({ janelaMin: 1, limite: 600 });

/** Último recurso: nenhum erro de rota pode derrubar o processo nem vazar
 * detalhes internos (stack, SQL) pro cliente. */
export const tratarErros: ErrorRequestHandler = (erro, req, res, next) => {
  if (res.headersSent) return next(erro);

  if (erro?.type === 'entity.too.large') return res.status(413).json({ erro: 'O conteúdo enviado é grande demais.' });
  if (erro?.type === 'entity.parse.failed') return res.status(400).json({ erro: 'Requisição inválida.' });

  const rota = req.originalUrl.split('?')[0];
  log('error', 'erro_nao_tratado', { id: req.idRequisicao, metodo: req.method, rota, erro: erro instanceof Error ? erro.stack ?? erro.message : String(erro) });
  void reportarErro(erro, { idRequisicao: req.idRequisicao, metodo: req.method, rota, usuario: req.usuario?.id });
  res.status(500).json({ erro: 'Ocorreu um erro inesperado. Tente novamente em instantes.', idRequisicao: req.idRequisicao });
};
