import { Router } from 'express';
import { VENDA_VALIDA } from '../lib/vendas.js';
import jwt from 'jsonwebtoken';
import QRCode from 'qrcode';
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { assinarTokenAdmin, requirePlatformAdmin } from '../middleware/auth.js';
import { calcularTrialExpiraEm } from '../config/planos.js';
import { cpfValido, normalizarCnpj } from '../lib/documentos.js';
import { mensagemDeValidacao, senhaForte } from '../lib/senha.js';
import { gerarSegredoTotp, urlOtpauth, verificarTotp } from '../lib/totp.js';
import { revogarTodasAsSessoes } from '../lib/sessao.js';
import { operacoesExcluirLojas, usuarioComHistoricoEmOutraLoja } from '../lib/exclusao.js';

export const adminRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  senha: z.string().min(1),
});

adminRouter.post('/login', async (req, res) => {
  const parse = loginSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Informe e-mail e senha.' });
  }
  const { email, senha } = parse.data;

  const admin = await prisma.adminPlataforma.findUnique({ where: { email } });
  if (!admin) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }

  const senhaConfere = await bcrypt.compare(senha, admin.senhaHash);
  if (!senhaConfere) {
    return res.status(401).json({ erro: 'E-mail ou senha inválidos.' });
  }

  // Com verificação em duas etapas ativa, a senha sozinha não entra: devolve um
  // desafio de vida curta que só serve pra /login/2fa junto com o código do app.
  if (admin.totpAtivo) {
    const desafio = jwt.sign({ id: admin.id, tipo: 'ADMIN_2FA' }, process.env.JWT_SECRET as string, { expiresIn: '5m' });
    return res.json({ precisaCodigo: true, desafio });
  }

  const token = assinarTokenAdmin({ id: admin.id });
  res.json({ token, admin: { id: admin.id, nome: admin.nome, email: admin.email }, totpAtivo: false });
});

/** Passos do TOTP já usados (admin -> último passo aceito): o mesmo código não
 * vale duas vezes, mesmo dentro da janela de 30 s. */
const ultimoPassoUsado = new Map<string, number>();

function aceitarCodigo(adminId: string, segredo: string, codigo: string): boolean {
  const passo = verificarTotp(segredo, codigo);
  if (passo === null) return false;
  if ((ultimoPassoUsado.get(adminId) ?? -1) >= passo) return false;
  ultimoPassoUsado.set(adminId, passo);
  return true;
}

const doisFatoresSchema = z.object({ desafio: z.string().min(10), codigo: z.string().min(6).max(10) });

adminRouter.post('/login/2fa', async (req, res) => {
  const parse = doisFatoresSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Informe o código do aplicativo.' });

  let adminId: string;
  try {
    const dados = jwt.verify(parse.data.desafio, process.env.JWT_SECRET as string) as { id: string; tipo: string };
    if (dados.tipo !== 'ADMIN_2FA') throw new Error('desafio inválido');
    adminId = dados.id;
  } catch {
    return res.status(401).json({ erro: 'A verificação expirou. Entre de novo com e-mail e senha.' });
  }

  const admin = await prisma.adminPlataforma.findUnique({ where: { id: adminId } });
  if (!admin?.totpAtivo || !admin.totpSegredo || !aceitarCodigo(admin.id, admin.totpSegredo, parse.data.codigo)) {
    return res.status(401).json({ erro: 'Código inválido ou já utilizado.' });
  }
  res.json({ token: assinarTokenAdmin({ id: admin.id }), admin: { id: admin.id, nome: admin.nome, email: admin.email }, totpAtivo: true });
});

adminRouter.use(requirePlatformAdmin);

// ---- Verificação em duas etapas do próprio admin ----

adminRouter.get('/2fa', async (req, res) => {
  const admin = await prisma.adminPlataforma.findUnique({ where: { id: req.admin!.id }, select: { totpAtivo: true } });
  res.json({ ativo: Boolean(admin?.totpAtivo) });
});

/** Gera um segredo novo e o QR code pra cadastrar no aplicativo. Só passa a valer
 * depois de /2fa/ativar com um código correto. */
adminRouter.post('/2fa/iniciar', async (req, res) => {
  const admin = await prisma.adminPlataforma.findUnique({ where: { id: req.admin!.id } });
  if (!admin) return res.status(404).json({ erro: 'Admin não encontrado.' });
  if (admin.totpAtivo) return res.status(409).json({ erro: 'A verificação em duas etapas já está ativa.' });

  const segredo = gerarSegredoTotp();
  await prisma.adminPlataforma.update({ where: { id: admin.id }, data: { totpSegredo: segredo } });
  const otpauth = urlOtpauth(segredo, admin.email);
  res.json({ segredo, otpauth, qrCode: await QRCode.toDataURL(otpauth, { margin: 1, width: 220 }) });
});

const codigoSchema = z.object({ codigo: z.string().min(6).max(10) });

adminRouter.post('/2fa/ativar', async (req, res) => {
  const parse = codigoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Informe o código do aplicativo.' });

  const admin = await prisma.adminPlataforma.findUnique({ where: { id: req.admin!.id } });
  if (!admin?.totpSegredo) return res.status(409).json({ erro: 'Comece pela configuração do aplicativo.' });
  if (!aceitarCodigo(admin.id, admin.totpSegredo, parse.data.codigo)) {
    return res.status(400).json({ erro: 'Código incorreto. Confira o aplicativo e tente de novo.' });
  }
  await prisma.adminPlataforma.update({ where: { id: admin.id }, data: { totpAtivo: true } });
  res.json({ ativo: true });
});

const desativarSchema = z.object({ senha: z.string().min(1), codigo: z.string().min(6).max(10) });

/** Desligar exige senha E código: quem só roubou o token de sessão não consegue. */
adminRouter.post('/2fa/desativar', async (req, res) => {
  const parse = desativarSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Informe a senha e o código.' });

  const admin = await prisma.adminPlataforma.findUnique({ where: { id: req.admin!.id } });
  if (!admin?.totpAtivo || !admin.totpSegredo) return res.status(409).json({ erro: 'A verificação em duas etapas não está ativa.' });
  if (!(await bcrypt.compare(parse.data.senha, admin.senhaHash)) || !aceitarCodigo(admin.id, admin.totpSegredo, parse.data.codigo)) {
    return res.status(400).json({ erro: 'Senha ou código incorretos.' });
  }
  await prisma.adminPlataforma.update({ where: { id: admin.id }, data: { totpAtivo: false, totpSegredo: null } });
  res.json({ ativo: false });
});

adminRouter.get('/empresas', async (_req, res) => {
  const empresas = await prisma.empresa.findMany({
    orderBy: { criadoEm: 'desc' },
    include: {
      lojas: {
        orderBy: { criadoEm: 'asc' },
        include: {
          usuarios: {
            orderBy: { nome: 'asc' },
            select: { id: true, nome: true, email: true, cpf: true, telefone: true, papel: true, raiz: true, ativo: true, criadoEm: true },
          },
        },
      },
    },
  });

  // Indicadores de uso de cada loja (produtos ativos e vendas do mês).
  const idsLojas = empresas.flatMap((e) => e.lojas.map((l) => l.id));
  const inicioDoMes = new Date();
  inicioDoMes.setDate(1);
  inicioDoMes.setHours(0, 0, 0, 0);
  const [produtos, vendas] = await Promise.all([
    prisma.produto.groupBy({ by: ['tenantId'], where: { tenantId: { in: idsLojas }, ativo: true }, _count: { _all: true } }),
    prisma.transacao.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: idsLojas }, ...VENDA_VALIDA, timestamp: { gte: inicioDoMes } },
      _sum: { valorTotal: true },
      _count: { _all: true },
      _max: { timestamp: true },
    }),
  ]);

  res.json(
    empresas.map((e) => ({
      id: e.id,
      nome: e.nome,
      planoAtual: e.planoAtual,
      trialExpiraEm: e.trialExpiraEm?.toISOString() ?? undefined,
      assinatura: {
        status: e.assinaturaStatus,
        acessoAte: e.acessoAte?.toISOString() ?? undefined,
        canceladaEm: e.canceladaEm?.toISOString() ?? undefined,
      },
      ativo: e.ativo,
      criadoEm: e.criadoEm.toISOString(),
      lojas: e.lojas.map((t) => {
        const v = vendas.find((x) => x.tenantId === t.id);
        return {
          id: t.id,
          nomeFantasia: t.nomeFantasia,
          razaoSocial: t.razaoSocial ?? undefined,
          cnpj: t.cnpj,
          telefone: t.telefone ?? undefined,
          email: t.email ?? undefined,
          site: t.site ?? undefined,
          inscricaoEstadual: t.inscricaoEstadual ?? undefined,
          inscricaoMunicipal: t.inscricaoMunicipal ?? undefined,
          regimeTributario: t.regimeTributario ?? undefined,
          endereco: {
            cep: t.cep ?? undefined,
            logradouro: t.logradouro ?? undefined,
            numero: t.numero ?? undefined,
            complemento: t.complemento ?? undefined,
            bairro: t.bairro ?? undefined,
            cidade: t.cidade ?? undefined,
            uf: t.uf ?? undefined,
          },
          ativo: t.ativo,
          criadoEm: t.criadoEm.toISOString(),
          indicadores: {
            produtos: produtos.find((x) => x.tenantId === t.id)?._count._all ?? 0,
            vendasDoMes: v?._count._all ?? 0,
            faturamentoDoMes: Number(v?._sum.valorTotal ?? 0),
            ultimaVenda: v?._max.timestamp?.toISOString() ?? undefined,
          },
          usuarios: t.usuarios.map((u) => ({
            id: u.id,
            nome: u.nome,
            email: u.email,
            cpf: u.cpf ?? undefined,
            telefone: u.telefone ?? undefined,
            papel: u.papel,
            raiz: u.raiz,
            ativo: u.ativo,
            criadoEm: u.criadoEm.toISOString(),
          })),
        };
      }),
    })),
  );
});

const textoOpcional = z.string().trim().max(191).optional();

const novaEmpresaSchema = z.object({
  nomeFantasia: z.string().min(2),
  razaoSocial: textoOpcional,
  cnpj: z.string().min(1),
  inscricaoEstadual: textoOpcional,
  inscricaoMunicipal: textoOpcional,
  regimeTributario: textoOpcional,
  telefone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  site: textoOpcional,
  cep: textoOpcional,
  logradouro: textoOpcional,
  numero: textoOpcional,
  complemento: textoOpcional,
  bairro: textoOpcional,
  cidade: textoOpcional,
  uf: z.string().trim().length(2).optional().or(z.literal('')),
  planoAtual: z.enum(['FREE', 'STARTER', 'PRO', 'ENTERPRISE']).default('FREE'),
  nomeAdmin: z.string().min(2),
  cpfAdmin: textoOpcional,
  telefoneAdmin: textoOpcional,
  emailAdmin: z.string().email(),
  senhaAdmin: senhaForte,
});

adminRouter.post('/empresas', async (req, res) => {
  const parse = novaEmpresaSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: mensagemDeValidacao(parse.error), detalhes: parse.error.flatten() });
  }
  const d = parse.data;

  const cnpj = normalizarCnpj(d.cnpj);
  if (!cnpj) return res.status(400).json({ erro: 'CNPJ inválido. Confira os números.' });
  if (d.cpfAdmin && !cpfValido(d.cpfAdmin)) return res.status(400).json({ erro: 'CPF do responsável inválido.' });

  const emailExistente = await prisma.usuario.findUnique({ where: { email: d.emailAdmin } });
  if (emailExistente) {
    return res.status(409).json({ erro: 'Já existe uma conta com este e-mail.' });
  }
  const cnpjExistente = await prisma.tenant.findUnique({ where: { cnpj } });
  if (cnpjExistente) {
    return res.status(409).json({ erro: 'Já existe uma loja cadastrada com este CNPJ.' });
  }

  const senhaHash = await bcrypt.hash(d.senhaAdmin, 10);

  const empresa = await prisma.$transaction(async (tx) => {
    const empresa = await tx.empresa.create({
      data: {
        nome: d.nomeFantasia,
        planoAtual: d.planoAtual,
        trialExpiraEm: d.planoAtual === 'FREE' ? calcularTrialExpiraEm() : undefined,
      },
    });
    const tenant = await tx.tenant.create({
      data: {
        empresaId: empresa.id,
        nomeFantasia: d.nomeFantasia,
        razaoSocial: d.razaoSocial || undefined,
        cnpj,
        inscricaoEstadual: d.inscricaoEstadual || undefined,
        inscricaoMunicipal: d.inscricaoMunicipal || undefined,
        regimeTributario: d.regimeTributario || undefined,
        telefone: d.telefone || undefined,
        email: d.email || undefined,
        site: d.site || undefined,
        cep: d.cep || undefined,
        logradouro: d.logradouro || undefined,
        numero: d.numero || undefined,
        complemento: d.complemento || undefined,
        bairro: d.bairro || undefined,
        cidade: d.cidade || undefined,
        uf: d.uf || undefined,
        logoDaLojaUrl: `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(d.nomeFantasia)}&backgroundType=gradientLinear`,
        corPrincipalDoTema: '#10B981',
      },
    });
    await tx.usuario.create({
      data: {
        tenantId: tenant.id,
        nome: d.nomeAdmin,
        cpf: d.cpfAdmin || undefined,
        telefone: d.telefoneAdmin || undefined,
        email: d.emailAdmin,
        senhaHash,
        papel: 'ADMIN',
        raiz: true,
      },
    });
    await tx.categoria.create({ data: { tenantId: tenant.id, nome: 'Geral' } });
    return empresa;
  });

  res.status(201).json({ id: empresa.id, nome: empresa.nome });
});

const empresaAtivoSchema = z.object({ ativo: z.boolean() });

adminRouter.put('/empresas/:id/ativo', async (req, res) => {
  const parse = empresaAtivoSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Valor inválido.' });
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: req.params.id } });
  if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada.' });

  const atualizado = await prisma.empresa.update({
    where: { id: empresa.id },
    data: { ativo: parse.data.ativo },
  });
  res.json({ id: atualizado.id, ativo: atualizado.ativo });
});

adminRouter.delete('/empresas/:id', async (req, res) => {
  const empresa = await prisma.empresa.findUnique({ where: { id: req.params.id }, include: { lojas: true } });
  if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada.' });

  const tenantIds = empresa.lojas.map((t) => t.id);

  // Todas as lojas saem juntas, então nenhum usuário fica com histórico
  // "pendurado" em loja de fora. Ordem em lib/exclusao.ts.
  await prisma.$transaction([...operacoesExcluirLojas(tenantIds), prisma.empresa.delete({ where: { id: empresa.id } })]);

  res.status(204).send();
});

const lojaAtivoSchema = z.object({ ativo: z.boolean() });

/** Desativa/reativa uma loja específica (a empresa segue ativa). */
adminRouter.put('/lojas/:id/ativo', async (req, res) => {
  const parse = lojaAtivoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Valor inválido.' });

  const loja = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });

  if (!parse.data.ativo) {
    const outrasAtivas = await prisma.tenant.count({
      where: { empresaId: loja.empresaId, ativo: true, id: { not: loja.id } },
    });
    if (outrasAtivas === 0) {
      return res.status(409).json({ erro: 'Esta é a única loja ativa da empresa. Para bloquear o acesso, suspenda a empresa.' });
    }
  }

  const atualizada = await prisma.tenant.update({ where: { id: loja.id }, data: { ativo: parse.data.ativo } });
  res.json({ id: atualizada.id, ativo: atualizada.ativo });
});

/** Exclusão definitiva de uma loja (LGPD). A última loja de uma empresa não
 * sai por aqui: aí é a empresa inteira que deve ser excluída. */
adminRouter.delete('/lojas/:id', async (req, res) => {
  const loja = await prisma.tenant.findUnique({ where: { id: req.params.id } });
  if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const total = await prisma.tenant.count({ where: { empresaId: loja.empresaId } });
  if (total <= 1) {
    return res.status(409).json({ erro: 'Esta é a única loja da empresa. Exclua a empresa inteira.' });
  }

  const comHistorico = await usuarioComHistoricoEmOutraLoja([loja.id]);
  if (comHistorico) {
    return res.status(409).json({
      erro: `${comHistorico} tem movimentações em outra loja e não pode ser apagado junto. Desative esse usuário e tente de novo.`,
    });
  }

  await prisma.$transaction(operacoesExcluirLojas([loja.id]));
  res.status(204).send();
});

const planoSchema = z.object({
  planoAtual: z.enum(['FREE', 'STARTER', 'PRO', 'ENTERPRISE']),
});

adminRouter.put('/empresas/:id/plano', async (req, res) => {
  const parse = planoSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Plano inválido.' });
  }

  const empresa = await prisma.empresa.findUnique({ where: { id: req.params.id } });
  if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada.' });

  const novoPlano = parse.data.planoAtual;
  const trialExpiraEm = novoPlano === 'FREE' ? calcularTrialExpiraEm() : null;

  const atualizado = await prisma.empresa.update({
    where: { id: empresa.id },
    data: { planoAtual: novoPlano, trialExpiraEm },
  });
  res.json({ id: atualizado.id, planoAtual: atualizado.planoAtual, trialExpiraEm: atualizado.trialExpiraEm });
});

const ativoSchema = z.object({ ativo: z.boolean() });

adminRouter.put('/usuarios/:id/ativo', async (req, res) => {
  const parse = ativoSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Valor inválido.' });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  const atualizado = await prisma.usuario.update({
    where: { id: usuario.id },
    data: { ativo: parse.data.ativo },
  });
  res.json({ id: atualizado.id, ativo: atualizado.ativo });
});

function gerarSenhaTemporaria(): string {
  return crypto.randomBytes(9).toString('base64url');
}

adminRouter.post('/usuarios/:id/resetar-senha', async (req, res) => {
  const usuario = await prisma.usuario.findUnique({ where: { id: req.params.id } });
  if (!usuario) return res.status(404).json({ erro: 'Usuário não encontrado.' });

  const senhaTemporaria = gerarSenhaTemporaria();
  const senhaHash = await bcrypt.hash(senhaTemporaria, 10);

  await prisma.usuario.update({ where: { id: usuario.id }, data: { senhaHash } });
  // Senha nova: as sessões abertas com a senha antiga caem na hora.
  await revogarTodasAsSessoes(usuario.id);

  res.json({ senhaTemporaria });
});
