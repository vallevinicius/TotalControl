import crypto from 'node:crypto';
import { prisma } from './prisma.js';
import { emailVerificacao, enviarEmail } from './email.js';
import { operacoesExcluirLojas } from './exclusao.js';

const VALIDADE_HORAS = 24;
/** Quanto tempo o cadastro sem confirmação fica guardado antes de ser apagado (libera o CNPJ e o e-mail). */
const DIAS_PARA_APAGAR = 7;
/** Intervalo mínimo entre dois e-mails de confirmação para a mesma conta. */
const INTERVALO_REENVIO_S = 60;

export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const urlDoApp = () => (process.env.APP_URL ?? 'http://localhost:3099').replace(/\/$/, '');

/** Gera um link novo (os anteriores deixam de valer) e manda por e-mail. */
export async function enviarVerificacaoDeEmail(usuario: { id: string; nome: string; email: string }): Promise<void> {
  const token = crypto.randomBytes(32).toString('base64url');
  await prisma.$transaction([
    prisma.tokenVerificacaoEmail.deleteMany({ where: { usuarioId: usuario.id, usadoEm: null } }),
    prisma.tokenVerificacaoEmail.create({ data: { usuarioId: usuario.id, tokenHash: hashToken(token), expiraEm: new Date(Date.now() + VALIDADE_HORAS * 3_600_000) } }),
  ]);
  await enviarEmail({ para: usuario.email, ...emailVerificacao(usuario.nome, `${urlDoApp()}/verificar-email?token=${token}`) });
}

/** Reenvio pedido pela pessoa: só para conta pendente e respeitando o intervalo. Silencioso nos outros casos. */
export async function reenviarVerificacao(email: string): Promise<void> {
  const usuario = await prisma.usuario.findUnique({ where: { email } });
  if (!usuario?.ativo || !usuario.emailPendente) return;
  const recente = await prisma.tokenVerificacaoEmail.findFirst({
    where: { usuarioId: usuario.id, criadoEm: { gt: new Date(Date.now() - INTERVALO_REENVIO_S * 1000) } },
  });
  if (recente) return;
  await enviarVerificacaoDeEmail(usuario);
}

/** Confirma o e-mail com o token do link. Devolve false se o link é inválido, já usado ou venceu. */
export async function confirmarEmail(token: string): Promise<boolean> {
  const registro = await prisma.tokenVerificacaoEmail.findUnique({ where: { tokenHash: hashToken(token) } });
  if (!registro || registro.usadoEm || registro.expiraEm < new Date()) return false;
  const usado = await prisma.tokenVerificacaoEmail.updateMany({ where: { id: registro.id, usadoEm: null }, data: { usadoEm: new Date() } });
  if (usado.count === 0) return false;
  await prisma.usuario.update({ where: { id: registro.usuarioId }, data: { emailPendente: false } });
  return true;
}

/** Apaga cadastros que nunca confirmaram o e-mail (empresa de uma loja e um usuário só). Evita que
 * alguém "reserve" o CNPJ de terceiros ou encha o banco com contas de teste. */
export async function limparCadastrosNaoConfirmados(): Promise<number> {
  const limite = new Date(Date.now() - DIAS_PARA_APAGAR * 86_400_000);
  const pendentes = await prisma.usuario.findMany({
    where: { emailPendente: true, raiz: true, criadoEm: { lt: limite } },
    include: { tenant: { include: { empresa: { include: { lojas: { select: { id: true, _count: { select: { usuarios: true } } } } } } } } },
  });
  let apagadas = 0;
  for (const u of pendentes) {
    const lojas = u.tenant.empresa.lojas;
    if (lojas.length !== 1 || lojas[0]._count.usuarios !== 1) continue; // já foi usada: não mexe
    await prisma.$transaction([...operacoesExcluirLojas([lojas[0].id]), prisma.empresa.deleteMany({ where: { id: u.tenant.empresaId } })]);
    apagadas++;
  }
  return apagadas;
}
