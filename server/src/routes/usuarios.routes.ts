import { Router } from 'express';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requerirAdmin, requerirTela } from '../middleware/permissao.js';
import { verificarLimiteRecurso } from '../middleware/plano.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { mensagemDeValidacao, senhaForte } from '../lib/senha.js';
import { emailConvite, enviarEmail } from '../lib/email.js';
import { revogarTodasAsSessoes } from '../lib/sessao.js';

type PapelUsuario = 'ADMIN' | 'GERENTE' | 'OPERADOR_CAIXA';

export const usuariosRouter = Router();
usuariosRouter.use(requireAuth, requerirAdmin);

const TELAS_VALIDAS = ['dashboard', 'pdv', 'estoque', 'financeiro', 'clientes', 'vendedores', 'relatorios'] as const;
const permissoesSchema = z.array(z.enum(TELAS_VALIDAS));

function serializarUsuario(u: {
  id: string;
  tenantId: string;
  nome: string;
  email: string;
  papel: string;
  permissoes: unknown;
  raiz: boolean;
  ativo: boolean;
  criadoEm: Date;
}) {
  return {
    id: u.id,
    tenantId: u.tenantId,
    nome: u.nome,
    email: u.email,
    papel: u.papel,
    permissoes: (u.permissoes as string[] | null) ?? undefined,
    raiz: u.raiz,
    ativo: u.ativo,
    criadoEm: u.criadoEm.toISOString(),
  };
}

usuariosRouter.get('/', async (req, res) => {
  const { tenantId } = req.usuario!;
  const usuarios = await prisma.usuario.findMany({ where: { tenantId }, orderBy: { nome: 'asc' } });
  res.json(usuarios.map(serializarUsuario));
});

const novoUsuarioSchema = z.object({
  nome: z.string().min(2),
  email: z.string().email(),
  senha: senhaForte.optional(),
  /** Em vez de o gestor definir a senha, a pessoa recebe um link por e-mail e cria a própria. */
  convidarPorEmail: z.boolean().optional(),
  papel: z.enum(['ADMIN', 'GERENTE', 'OPERADOR_CAIXA']),
  permissoes: permissoesSchema.optional(),
}).superRefine((d, ctx) => {
  if (!d.convidarPorEmail && !d.senha) ctx.addIssue({ code: 'custom', path: ['senha'], message: 'Informe a senha do novo login.' });
});

usuariosRouter.post('/', async (req, res) => {
  const { tenantId, papel: papelSolicitante, id: idSolicitante } = req.usuario!;
  if (papelSolicitante !== 'ADMIN') {
    return res.status(403).json({ erro: 'Só administradores da loja podem criar novos logins.' });
  }

  const parse = novoUsuarioSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: mensagemDeValidacao(parse.error), detalhes: parse.error.flatten() });
  }

  const existente = await prisma.usuario.findUnique({ where: { email: parse.data.email } });
  if (existente) {
    return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
  }

  const limiteExcedido = await verificarLimiteRecurso(tenantId, 'usuarios');
  if (limiteExcedido) {
    return res.status(403).json(limiteExcedido);
  }

  // Convite: a conta nasce com uma senha aleatória que ninguém conhece; a pessoa
  // define a dela pelo link (o mesmo mecanismo do "esqueci minha senha").
  const convidar = Boolean(parse.data.convidarPorEmail);
  const senhaHash = await bcrypt.hash(convidar ? crypto.randomBytes(24).toString('base64url') : parse.data.senha!, 10);
  const usuario = await prisma.usuario.create({
    data: {
      tenantId,
      nome: parse.data.nome,
      email: parse.data.email,
      senhaHash,
      papel: parse.data.papel,
      permissoes: parse.data.permissoes ?? [],
    },
  });

  await registrarAuditoria(tenantId, idSolicitante, convidar ? 'usuario.convidar' : 'usuario.criar', `${usuario.nome} (${usuario.email})`);

  if (convidar) {
    const token = crypto.randomBytes(32).toString('base64url');
    await prisma.tokenSenha.create({
      data: { usuarioId: usuario.id, tokenHash: crypto.createHash('sha256').update(token).digest('hex'), expiraEm: new Date(Date.now() + 3 * 86_400_000) },
    });
    const [quem, loja] = await Promise.all([
      prisma.usuario.findUnique({ where: { id: idSolicitante }, select: { nome: true } }),
      prisma.tenant.findUnique({ where: { id: tenantId }, select: { nomeFantasia: true } }),
    ]);
    const link = `${(process.env.APP_URL ?? 'http://localhost:3099').replace(/\/$/, '')}/redefinir-senha?token=${token}&convite=1`;
    enviarEmail({ para: usuario.email, ...emailConvite(usuario.nome, quem?.nome ?? 'A sua empresa', loja?.nomeFantasia ?? 'sua loja', link) }).catch((e) => console.error('Falha ao enviar o convite:', e));
  }
  res.status(201).json({ ...serializarUsuario(usuario), conviteEnviado: convidar });
});

const ativoSchema = z.object({ ativo: z.boolean() });

usuariosRouter.put('/:id/ativo', async (req, res) => {
  const { tenantId, papel: papelSolicitante, id: idSolicitante } = req.usuario!;
  if (papelSolicitante !== 'ADMIN') {
    return res.status(403).json({ erro: 'Só administradores da loja podem alterar logins.' });
  }
  if (req.params.id === idSolicitante) {
    return res.status(400).json({ erro: 'Você não pode desativar seu próprio login.' });
  }

  const parse = ativoSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Valor inválido.' });
  }

  const usuario = await prisma.usuario.findFirst({ where: { id: req.params.id, tenantId } });
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (usuario.raiz && !parse.data.ativo) {
    return res.status(400).json({ erro: 'A conta principal da loja não pode ser desativada.' });
  }

  const atualizado = await prisma.usuario.update({
    where: { id: usuario.id },
    data: { ativo: parse.data.ativo },
  });
  await registrarAuditoria(
    tenantId,
    idSolicitante,
    parse.data.ativo ? 'usuario.ativar' : 'usuario.desativar',
    usuario.nome,
  );
  res.json(serializarUsuario(atualizado));
});

const atualizarAcessoSchema = z.object({
  permissoes: permissoesSchema.optional(),
  papel: z.enum(['ADMIN', 'GERENTE', 'OPERADOR_CAIXA']).optional(),
});

/** Muda o que um login vê (telas) e, só pra conta principal da loja, o
 * próprio papel — promover/rebaixar alguém é sensível o bastante pra não
 * deixar qualquer Admin fazer isso com outro Admin. */
usuariosRouter.put('/:id/acesso', async (req, res) => {
  const { tenantId, papel: papelSolicitante, id: idSolicitante } = req.usuario!;
  if (papelSolicitante !== 'ADMIN') {
    return res.status(403).json({ erro: 'Só administradores da loja podem alterar acessos.' });
  }

  const parse = atualizarAcessoSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }

  const usuario = await prisma.usuario.findFirst({ where: { id: req.params.id, tenantId } });
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  const dadosAtualizacao: { papel?: PapelUsuario; permissoes?: string[] } = {};

  if (parse.data.papel && parse.data.papel !== usuario.papel) {
    if (usuario.id === idSolicitante) {
      return res.status(400).json({ erro: 'Você não pode alterar seu próprio papel.' });
    }
    if (usuario.raiz) {
      return res.status(400).json({ erro: 'A conta principal da loja não pode ter o papel alterado.' });
    }
    const solicitante = await prisma.usuario.findUnique({ where: { id: idSolicitante }, select: { raiz: true } });
    if (!solicitante?.raiz) {
      return res.status(403).json({ erro: 'Só a conta principal da loja pode alterar o papel de um usuário.' });
    }
    dadosAtualizacao.papel = parse.data.papel;
  }

  if (parse.data.permissoes) {
    dadosAtualizacao.permissoes = parse.data.permissoes;
  }

  const atualizado = await prisma.usuario.update({ where: { id: usuario.id }, data: dadosAtualizacao });
  if (dadosAtualizacao.papel) {
    await registrarAuditoria(tenantId, idSolicitante, 'usuario.alterarPapel', `${usuario.nome} -> ${dadosAtualizacao.papel}`);
  }
  res.json(serializarUsuario(atualizado));
});

/** O administrador da loja gera uma senha temporária para alguém que perdeu o acesso
 * (útil para logins sem e-mail real, que não recebem o link do "esqueci minha senha").
 * A conta principal não é redefinida por outro login, nem a própria pessoa por aqui. */
usuariosRouter.post('/:id/resetar-senha', async (req, res) => {
  const { tenantId, id: idSolicitante } = req.usuario!;
  const usuario = await prisma.usuario.findFirst({ where: { id: req.params.id, tenantId } });
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (usuario.id === idSolicitante) return res.status(400).json({ erro: 'Para trocar a sua senha, use "Minha conta".' });

  const solicitante = await prisma.usuario.findUnique({ where: { id: idSolicitante }, select: { raiz: true } });
  if (usuario.raiz) return res.status(403).json({ erro: 'A senha da conta principal não pode ser redefinida por outro login.' });
  if (usuario.papel === 'ADMIN' && !solicitante?.raiz) return res.status(403).json({ erro: 'Só a conta principal redefine a senha de outro administrador.' });

  // 10 caracteres com letra e número (passa na política de senha).
  const senhaTemporaria = `${crypto.randomBytes(6).toString('base64url')}a1`;
  await prisma.usuario.update({ where: { id: usuario.id }, data: { senhaHash: await bcrypt.hash(senhaTemporaria, 10) } });
  await revogarTodasAsSessoes(usuario.id);
  await registrarAuditoria(tenantId, idSolicitante, 'usuario.resetarSenha', `${usuario.nome} (${usuario.email})`);
  res.json({ senhaTemporaria });
});
