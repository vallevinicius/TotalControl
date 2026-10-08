import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { assinarToken, requireAuth } from '../middleware/auth.js';
import { cpfValido, normalizarCnpj } from '../lib/documentos.js';
import crypto from 'node:crypto';
import { emitirSessao, renovarSessao, revogarSessao, revogarTodasAsSessoes } from '../lib/sessao.js';
import { emailRecuperacaoDeSenha, emailSenhaAlterada, enviarEmail } from '../lib/email.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { acoesEfetivas, descontoMaximoPercentual } from '../config/acoes.js';
import { mensagemDeValidacao, senhaForte, VERSAO_TERMOS } from '../lib/senha.js';
import { calcularTrialExpiraEm, LIMITES_POR_PLANO, motivoAcessoExpirado } from '../config/planos.js';

export const authRouter = Router();

const textoOpcional = z.string().trim().max(191).optional();

const registerSchema = z.object({
  nomeFantasia: z.string().min(2),
  razaoSocial: z.string().trim().min(2).max(191),
  cnpj: z.string().min(1),
  inscricaoEstadual: textoOpcional,
  inscricaoMunicipal: textoOpcional,
  regimeTributario: textoOpcional,
  telefone: z.string().optional(),
  emailContato: z.string().email().optional().or(z.literal('')),
  site: textoOpcional,
  cep: textoOpcional,
  logradouro: textoOpcional,
  numero: textoOpcional,
  complemento: textoOpcional,
  bairro: textoOpcional,
  cidade: textoOpcional,
  uf: z.string().trim().length(2).optional().or(z.literal('')),
  nomeAdmin: z.string().min(2),
  cpfAdmin: textoOpcional,
  telefoneAdmin: textoOpcional,
  email: z.string().email(),
  senha: senhaForte,
  /** Consentimento explícito: o servidor não cria a conta sem ele. */
  aceitouTermos: z.literal(true, { errorMap: () => ({ message: 'É preciso aceitar os Termos de Uso e a Política de Privacidade.' }) }),
});

authRouter.post('/register', async (req, res) => {
  const parse = registerSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: mensagemDeValidacao(parse.error), detalhes: parse.error.flatten() });
  }
  const {
    nomeFantasia,
    razaoSocial,
    cnpj: cnpjInformado,
    inscricaoEstadual,
    inscricaoMunicipal,
    regimeTributario,
    telefone,
    emailContato,
    site,
    cep,
    logradouro,
    numero,
    complemento,
    bairro,
    cidade,
    uf,
    nomeAdmin,
    cpfAdmin,
    telefoneAdmin,
    email,
    senha,
  } = parse.data;

  const cnpj = normalizarCnpj(cnpjInformado);
  if (!cnpj) {
    return res.status(400).json({ erro: 'CNPJ inválido. Confira os números.' });
  }
  if (cpfAdmin && !cpfValido(cpfAdmin)) {
    return res.status(400).json({ erro: 'CPF do responsável inválido.' });
  }

  const emailExistente = await prisma.usuario.findUnique({ where: { email } });
  if (emailExistente) {
    return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
  }
  const cnpjExistente = await prisma.tenant.findUnique({ where: { cnpj } });
  if (cnpjExistente) {
    return res.status(409).json({ erro: 'Já existe uma loja cadastrada com este CNPJ.' });
  }

  const senhaHash = await bcrypt.hash(senha, 10);

  const { tenant, usuario } = await prisma.$transaction(async (tx) => {
    // Cadastro self-service já entra no STARTER, com um trial — dá pra
    // sentir o valor real do plano (Financeiro, Relatórios) em vez de uma
    // versão capada, o que converte melhor do que um FREE permanente.
    const empresa = await tx.empresa.create({
      data: {
        nome: nomeFantasia,
        planoAtual: 'STARTER',
        trialExpiraEm: calcularTrialExpiraEm(),
      },
    });
    const tenant = await tx.tenant.create({
      data: {
        empresaId: empresa.id,
        nomeFantasia,
        razaoSocial,
        cnpj,
        inscricaoEstadual: inscricaoEstadual || undefined,
        inscricaoMunicipal: inscricaoMunicipal || undefined,
        regimeTributario: regimeTributario || undefined,
        telefone: telefone || undefined,
        email: emailContato || undefined,
        site: site || undefined,
        cep: cep || undefined,
        logradouro: logradouro || undefined,
        numero: numero || undefined,
        complemento: complemento || undefined,
        bairro: bairro || undefined,
        cidade: cidade || undefined,
        uf: uf || undefined,
        logoDaLojaUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(nomeFantasia)}&backgroundType=gradientLinear`,
        corPrincipalDoTema: '#10B981',
      },
    });
    const usuario = await tx.usuario.create({
      data: {
        tenantId: tenant.id,
        nome: nomeAdmin,
        cpf: cpfAdmin || undefined,
        telefone: telefoneAdmin || undefined,
        email,
        senhaHash,
        papel: 'ADMIN',
        raiz: true,
        aceiteTermosEm: new Date(),
        aceiteTermosVersao: VERSAO_TERMOS,
      },
    });
    await tx.categoria.create({ data: { tenantId: tenant.id, nome: 'Geral' } });
    return { tenant, usuario };
  });

  res.status(201).json(await emitirSessao(usuario, req));
});

const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

authRouter.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Informe e-mail e senha.' });
  }
  const { email, senha } = parse.data;

  const usuario = await prisma.usuario.findUnique({
    where: { email },
    include: { tenant: { include: { empresa: true } } },
  });
  if (!usuario || !usuario.ativo) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }
  if (!usuario.tenant.empresa.ativo) {
    return res.status(403).json({ erro: 'Esta loja está suspensa. Fale com o suporte.' });
  }
  if (!usuario.tenant.ativo) {
    return res.status(403).json({ erro: 'Esta loja foi desativada pelo responsável da empresa.' });
  }
  // Teste expirado ou assinatura vencida não bloqueiam o login: a pessoa entra e
  // cai na tela do plano pra assinar (ver requireAuth e /auth/me).

  const senhaConfere = await bcrypt.compare(senha, usuario.senhaHash);
  if (!senhaConfere) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }

  res.json(await emitirSessao(usuario, req));
});

const refreshSchema = z.object({ refreshToken: z.string().min(20), tenantId: z.string().optional() });

/** Renova a sessão: troca o token de renovação por um par novo. Sem login, pois
 * o próprio token de renovação é a credencial. */
authRouter.post('/refresh', async (req, res) => {
  const parse = refreshSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Requisição inválida.' });

  const r = await renovarSessao(parse.data.refreshToken, req, parse.data.tenantId, possuiAcessoALoja);
  if (!r.ok) return res.status(401).json({ erro: 'Sessão expirada. Entre novamente.' });
  res.json({ token: r.token, refreshToken: r.refreshToken });
});

authRouter.post('/logout', async (req, res) => {
  const parse = refreshSchema.pick({ refreshToken: true }).safeParse(req.body);
  if (parse.success) await revogarSessao(parse.data.refreshToken);
  res.status(204).end();
});

/** Aparelhos/navegadores com sessão aberta na conta. O app manda o próprio token de
 * renovação no cabeçalho X-Refresh-Token só para a lista marcar qual é a sessão atual. */
authRouter.get('/sessoes', requireAuth, async (req, res) => {
  const atual = req.get('x-refresh-token');
  const atualHash = atual ? crypto.createHash('sha256').update(atual).digest('hex') : null;
  const sessoes = await prisma.sessaoRefresh.findMany({
    where: { usuarioId: req.usuario!.id, revogadaEm: null, expiraEm: { gt: new Date() } },
    orderBy: { criadoEm: 'desc' },
  });
  res.json(
    sessoes.map((x) => ({
      id: x.id,
      criadaEm: x.criadoEm.toISOString(),
      ip: x.ip ?? undefined,
      dispositivo: x.userAgent ?? undefined,
      atual: atualHash === x.tokenHash,
    })),
  );
});

/** Encerra uma sessão (ou todas as outras, com `outras`). Vale a partir da próxima
 * renovação do app naquele aparelho (o token de acesso dura no máximo ACCESS_TOKEN_TTL). */
authRouter.delete('/sessoes/:id', requireAuth, async (req, res) => {
  const { id: usuarioId } = req.usuario!;
  const atual = req.get('x-refresh-token');
  if (req.params.id === 'outras') {
    const atualHash = atual ? crypto.createHash('sha256').update(atual).digest('hex') : '';
    // Apaga (não marca como revogada): token revogado reaparecendo é lido como roubo e derruba tudo.
    const r = await prisma.sessaoRefresh.deleteMany({ where: { usuarioId, revogadaEm: null, tokenHash: { not: atualHash } } });
    await registrarAuditoria(req.usuario!.tenantId, usuarioId, 'Encerrou as outras sessões', `${r.count} sessão(ões)`);
    return res.json({ encerradas: r.count });
  }
  const r = await prisma.sessaoRefresh.deleteMany({ where: { id: req.params.id, usuarioId, revogadaEm: null } });
  if (r.count === 0) return res.status(404).json({ erro: 'Sessão não encontrada.' });
  res.status(204).end();
});

/** Confere se o usuário pode acessar a loja `tenantId`: é a loja de origem
 * dele (Usuario.tenantId, sempre permitida) ou ele tem um AcessoLoja
 * explícito pra ela E o plano atual da empresa ainda cobre múltiplas lojas.
 * Se a empresa foi rebaixada de ENTERPRISE, as lojas extras ficam
 * inacessíveis (dados preservados, só o acesso é suspenso) até promover de
 * volta — só a loja de origem continua disponível. */
async function possuiAcessoALoja(usuarioId: string, tenantIdHome: string, tenantId: string): Promise<boolean> {
  const alvo = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { ativo: true } });
  if (!alvo?.ativo) return false;
  if (tenantId === tenantIdHome) return true;

  const acesso = await prisma.acessoLoja.findUnique({
    where: { usuarioId_tenantId: { usuarioId, tenantId } },
  });
  if (!acesso) return false;

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { empresa: { select: { planoAtual: true } } },
  });
  if (!tenant) return false;
  return LIMITES_POR_PLANO[tenant.empresa.planoAtual].features.multiLoja;
}

authRouter.get('/me', requireAuth, async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario!.id } });
  if (!usuario || !usuario.ativo) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  // A loja ativa vem do token (pode ser diferente da loja de origem do
  // usuário, se ele trocou de loja — ver POST /auth/trocar-loja), não da
  // coluna Usuario.tenantId.
  const tenantIdAtivo = req.usuario!.tenantId;
  const temAcesso = await possuiAcessoALoja(usuario.id, usuario.tenantId, tenantIdAtivo);
  if (!temAcesso) return res.status(403).json({ erro: 'Você não tem mais acesso a esta loja.' });

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantIdAtivo }, include: { empresa: true } });
  if (!tenant) return res.status(404).json({ erro: 'Loja não encontrada.' });
  if (!tenant.empresa.ativo) return res.status(403).json({ erro: 'Esta loja está suspensa. Fale com o suporte.' });

  // As lojas extras (via AcessoLoja) só aparecem no seletor enquanto o plano
  // da empresa cobrir multiLoja — se foi rebaixada, elas somem da lista (os
  // dados continuam intactos, só ficam temporariamente inacessíveis).
  const multiLojaAtivo = LIMITES_POR_PLANO[tenant.empresa.planoAtual].features.multiLoja;
  const acessosExtras = multiLojaAtivo
    ? await prisma.acessoLoja.findMany({
        where: { usuarioId: usuario.id },
        include: { tenant: { select: { id: true, nomeFantasia: true, ativo: true } } },
      })
    : [];
  const lojaHome =
    usuario.tenantId === tenant.id
      ? { id: tenant.id, nomeFantasia: tenant.nomeFantasia, ativo: tenant.ativo }
      : await prisma.tenant.findUnique({ where: { id: usuario.tenantId }, select: { id: true, nomeFantasia: true, ativo: true } });
  const lojas = [lojaHome, ...acessosExtras.map((a) => a.tenant)]
    .filter((l): l is { id: string; nomeFantasia: string; ativo: boolean } => Boolean(l) && l!.ativo !== false)
    .map((l) => ({ id: l.id, nomeFantasia: l.nomeFantasia }));

  res.json({
    usuario: {
      id: usuario.id,
      tenantId: tenant.id,
      nome: usuario.nome,
      email: usuario.email,
      telefone: usuario.telefone ?? undefined,
      papel: usuario.papel,
      permissoes: (usuario.permissoes as string[] | null) ?? undefined,
      // Ações finas que valem hoje (cancelar venda, sangria...) e o desconto máximo do PDV.
      acoes: acoesEfetivas(usuario),
      descontoMaximo: descontoMaximoPercentual(usuario),
      raiz: usuario.raiz,
      ativo: usuario.ativo,
    },
    tenant: {
      id: tenant.id,
      nomeFantasia: tenant.nomeFantasia,
      razaoSocial: tenant.razaoSocial ?? undefined,
      cnpj: tenant.cnpj,
      telefone: tenant.telefone ?? undefined,
      email: tenant.email ?? undefined,
      site: tenant.site ?? undefined,
      inscricaoEstadual: tenant.inscricaoEstadual ?? undefined,
      inscricaoMunicipal: tenant.inscricaoMunicipal ?? undefined,
      regimeTributario: tenant.regimeTributario ?? undefined,
      endereco: {
        cep: tenant.cep ?? undefined,
        logradouro: tenant.logradouro ?? undefined,
        numero: tenant.numero ?? undefined,
        complemento: tenant.complemento ?? undefined,
        bairro: tenant.bairro ?? undefined,
        cidade: tenant.cidade ?? undefined,
        uf: tenant.uf ?? undefined,
      },
      planoAtual: tenant.empresa.planoAtual,
      trialExpiraEm: tenant.empresa.trialExpiraEm?.toISOString() ?? undefined,
      assinatura: {
        status: tenant.empresa.assinaturaStatus,
        acessoAte: tenant.empresa.acessoAte?.toISOString() ?? undefined,
        canceladaEm: tenant.empresa.canceladaEm?.toISOString() ?? undefined,
      },
      acessoExpirado: motivoAcessoExpirado(tenant.empresa) ?? undefined,
      avisosEmail: tenant.empresa.avisosEmail,
      configuracoes: {
        logoDaLojaUrl: tenant.logoDaLojaUrl,
        corPrincipalDoTema: tenant.corPrincipalDoTema,
        corPrincipalHover: tenant.corPrincipalHover ?? undefined,
        fusoHorario: tenant.fusoHorario,
        moeda: tenant.moeda,
        exigirSenhaAoAbrirCaixa: tenant.exigirSenhaAoAbrirCaixa,
      },
      criadoEm: tenant.criadoEm.toISOString(),
    },
    lojas,
  });
});

const trocarLojaSchema = z.object({ tenantId: z.string().min(1) });

authRouter.post('/trocar-loja', requireAuth, async (req, res) => {
  const parse = trocarLojaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Loja inválida.' });

  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario!.id } });
  if (!usuario || !usuario.ativo) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  const temAcesso = await possuiAcessoALoja(usuario.id, usuario.tenantId, parse.data.tenantId);
  if (!temAcesso) return res.status(403).json({ erro: 'Você não tem acesso a essa loja.' });

  const token = assinarToken({ id: usuario.id, tenantId: parse.data.tenantId, papel: usuario.papel, tv: usuario.tokenVersion });
  res.json({ token });
});

// ----------------------------------------------------------------------------
// Recuperação e troca de senha
// ----------------------------------------------------------------------------

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
const urlDoApp = () => (process.env.APP_URL ?? 'http://localhost:3099').replace(/\/$/, '');

const esqueciSchema = z.object({ email: z.string().email() });

/** Pede o link de redefinição. A resposta é SEMPRE a mesma, exista ou não a conta,
 * pra ninguém descobrir quais e-mails estão cadastrados. O envio acontece depois
 * de responder, então o tempo também não denuncia. */
authRouter.post('/esqueci-senha', async (req, res) => {
  const parse = esqueciSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Informe um e-mail válido.' });

  res.json({ mensagem: 'Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha.' });

  try {
    const usuario = await prisma.usuario.findUnique({ where: { email: parse.data.email } });
    if (!usuario?.ativo) return;

    const token = crypto.randomBytes(32).toString('base64url');
    await prisma.$transaction([
      // Só o link mais recente vale.
      prisma.tokenSenha.deleteMany({ where: { usuarioId: usuario.id, usadoEm: null } }),
      prisma.tokenSenha.create({
        data: { usuarioId: usuario.id, tokenHash: hashToken(token), expiraEm: new Date(Date.now() + 3_600_000) },
      }),
    ]);
    const link = `${urlDoApp()}/redefinir-senha?token=${token}`;
    await enviarEmail({ para: usuario.email, ...emailRecuperacaoDeSenha(usuario.nome, link) });
  } catch (erro) {
    console.error('Falha ao enviar o e-mail de recuperação de senha:', erro);
  }
});

const redefinirSchema = z.object({ token: z.string().min(20), senha: senhaForte });

authRouter.post('/redefinir-senha', async (req, res) => {
  const parse = redefinirSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: mensagemDeValidacao(parse.error, 'Link ou senha inválidos.') });

  const registro = await prisma.tokenSenha.findUnique({
    where: { tokenHash: hashToken(parse.data.token) },
    include: { usuario: true },
  });
  if (!registro || registro.usadoEm || registro.expiraEm < new Date() || !registro.usuario.ativo) {
    return res.status(400).json({ erro: 'Este link expirou ou já foi usado. Peça um novo em "Esqueci minha senha".' });
  }

  // Consome o link (condicional: dois cliques simultâneos não passam os dois).
  const consumido = await prisma.tokenSenha.updateMany({ where: { id: registro.id, usadoEm: null }, data: { usadoEm: new Date() } });
  if (consumido.count === 0) return res.status(400).json({ erro: 'Este link já foi usado.' });

  await prisma.usuario.update({ where: { id: registro.usuarioId }, data: { senhaHash: await bcrypt.hash(parse.data.senha, 10) } });
  // Senha nova: quem estava logado com a antiga (inclusive um invasor) cai.
  await revogarTodasAsSessoes(registro.usuarioId);
  await registrarAuditoria(registro.usuario.tenantId, registro.usuarioId, 'usuario.redefinirSenha', 'Por link enviado por e-mail');
  enviarEmail({ para: registro.usuario.email, ...emailSenhaAlterada(registro.usuario.nome) }).catch(() => undefined);

  res.json({ ok: true });
});

const alterarSenhaSchema = z.object({ senhaAtual: z.string().min(1), novaSenha: senhaForte });

/** Troca a própria senha (logado). Derruba as outras sessões, mas devolve uma
 * nova pra este aparelho continuar logado. */
authRouter.post('/alterar-senha', requireAuth, async (req, res) => {
  const parse = alterarSenhaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: mensagemDeValidacao(parse.error) });

  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario!.id } });
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });
  if (!(await bcrypt.compare(parse.data.senhaAtual, usuario.senhaHash))) {
    return res.status(400).json({ erro: 'A senha atual está incorreta.' });
  }
  if (parse.data.senhaAtual === parse.data.novaSenha) {
    return res.status(400).json({ erro: 'A nova senha precisa ser diferente da atual.' });
  }

  await prisma.usuario.update({ where: { id: usuario.id }, data: { senhaHash: await bcrypt.hash(parse.data.novaSenha, 10) } });
  await revogarTodasAsSessoes(usuario.id);
  await registrarAuditoria(req.usuario!.tenantId, usuario.id, 'usuario.alterarSenha');
  enviarEmail({ para: usuario.email, ...emailSenhaAlterada(usuario.nome) }).catch(() => undefined);

  const atualizado = await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
  res.json(await emitirSessao(atualizado, req, req.usuario!.tenantId));
});

const perfilSchema = z.object({
  nome: z.string().trim().min(2).max(191),
  telefone: z.string().trim().max(30).optional(),
});

/** Editar o próprio nome e telefone. */
authRouter.put('/perfil', requireAuth, async (req, res) => {
  const parse = perfilSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Informe um nome válido.' });

  await prisma.usuario.update({
    where: { id: req.usuario!.id },
    data: { nome: parse.data.nome, telefone: parse.data.telefone === undefined ? undefined : parse.data.telefone || null },
  });
  res.json({ ok: true });
});
