import { Router } from 'express';
import { VENDA_VALIDA } from '../lib/vendas.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireContaPrincipal } from '../middleware/contaPrincipal.js';
import { requireFeaturePlano } from '../middleware/plano.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { normalizarCnpj } from '../lib/documentos.js';
import { aplicarEdicaoDaLoja, editarLojaSchema } from '../lib/dadosLoja.js';
import { operacoesExcluirLojas, usuarioComHistoricoEmOutraLoja } from '../lib/exclusao.js';

export const lojasRouter = Router();
lojasRouter.use(requireAuth, requireContaPrincipal, requireFeaturePlano('multiLoja'));

const textoOpcional = z.string().trim().max(191).optional();

const novaLojaSchema = z.object({
  nomeFantasia: z.string().trim().min(2).max(191),
  razaoSocial: z.string().trim().min(2).max(191).optional(),
  cnpj: z.string().min(1),
  inscricaoEstadual: textoOpcional,
  inscricaoMunicipal: textoOpcional,
  regimeTributario: textoOpcional,
  telefone: textoOpcional,
  email: z.string().trim().email().optional().or(z.literal('')),
  site: textoOpcional,
  cep: textoOpcional,
  logradouro: textoOpcional,
  numero: textoOpcional,
  complemento: textoOpcional,
  bairro: textoOpcional,
  cidade: textoOpcional,
  uf: z.string().trim().length(2).optional().or(z.literal('')),
});

/** Criação self-service de uma loja adicional pra mesma empresa (plano
 * ENTERPRISE) — quem cria já sai com acesso a ela, sem precisar de um novo
 * login (ver AcessoLoja e POST /auth/trocar-loja). */
lojasRouter.post('/', async (req, res) => {
  const parse = novaLojaSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }
  const { cnpj: cnpjInformado, email, uf, ...dadosLoja } = parse.data;
  const cnpj = normalizarCnpj(cnpjInformado);
  if (!cnpj) return res.status(400).json({ erro: 'CNPJ inválido. Confira os números.' });

  const cnpjExistente = await prisma.tenant.findUnique({ where: { cnpj } });
  if (cnpjExistente) {
    return res.status(409).json({ erro: 'Já existe uma loja cadastrada com este CNPJ.' });
  }

  const lojaOrigem = await prisma.tenant.findUnique({ where: { id: req.usuario!.tenantId } });
  if (!lojaOrigem) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const novaLoja = await prisma.$transaction(async (tx) => {
    const loja = await tx.tenant.create({
      data: {
        empresaId: lojaOrigem.empresaId,
        // Campos de texto vazios viram null (não gravar "" no banco).
        ...Object.fromEntries(Object.entries(dadosLoja).map(([k, v]) => [k, v || null])),
        nomeFantasia: dadosLoja.nomeFantasia,
        email: email || null,
        uf: uf || null,
        cnpj,
        logoDaLojaUrl: lojaOrigem.logoDaLojaUrl,
        corPrincipalDoTema: lojaOrigem.corPrincipalDoTema,
        corPrincipalHover: lojaOrigem.corPrincipalHover ?? undefined,
        fusoHorario: lojaOrigem.fusoHorario,
        moeda: lojaOrigem.moeda,
      },
    });
    await tx.categoria.create({ data: { tenantId: loja.id, nome: 'Geral' } });
    await tx.acessoLoja.create({ data: { usuarioId: req.usuario!.id, tenantId: loja.id } });
    return loja;
  });

  await registrarAuditoria(lojaOrigem.id, req.usuario!.id, 'loja.criar', novaLoja.nomeFantasia);
  res.status(201).json({ id: novaLoja.id, nomeFantasia: novaLoja.nomeFantasia });
});

const concederAcessoSchema = z.object({ usuarioId: z.string().min(1) });

/** Concede a um usuário de qualquer loja da mesma empresa acesso a outra
 * loja específica (ver AcessoLoja). Só o dono (conta principal) concede. */
lojasRouter.post('/:tenantId/acessos', async (req, res) => {
  const parse = concederAcessoSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.' });
  }

  const lojaAtual = await prisma.tenant.findUnique({ where: { id: req.usuario!.tenantId } });
  if (!lojaAtual) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const lojaAlvo = await prisma.tenant.findUnique({ where: { id: req.params.tenantId } });
  if (!lojaAlvo || lojaAlvo.empresaId !== lojaAtual.empresaId) {
    return res.status(404).json({ erro: 'Loja não encontrada.' });
  }
  if (!lojaAlvo.ativo) {
    return res.status(409).json({ erro: 'Esta loja está desativada. Reative-a para conceder acessos.' });
  }

  const usuario = await prisma.usuario.findUnique({
    where: { id: parse.data.usuarioId },
    include: { tenant: true },
  });
  if (!usuario || usuario.tenant.empresaId !== lojaAtual.empresaId) {
    return res.status(404).json({ erro: 'Usuário não encontrado.' });
  }

  await prisma.acessoLoja.upsert({
    where: { usuarioId_tenantId: { usuarioId: usuario.id, tenantId: lojaAlvo.id } },
    update: {},
    create: { usuarioId: usuario.id, tenantId: lojaAlvo.id },
  });

  await registrarAuditoria(
    lojaAtual.id,
    req.usuario!.id,
    'loja.concederAcesso',
    `${usuario.nome} → ${lojaAlvo.nomeFantasia}`,
  );
  res.status(201).json({ ok: true });
});

/** Carrega a loja `id` só se ela for da mesma empresa da loja ativa do token —
 * o dono nunca enxerga nem mexe em lojas de outra empresa. */
async function buscarLojaDaEmpresa(tenantIdAtual: string, id: string) {
  const atual = await prisma.tenant.findUnique({ where: { id: tenantIdAtual }, select: { empresaId: true } });
  if (!atual) return null;
  const loja = await prisma.tenant.findUnique({ where: { id } });
  return loja && loja.empresaId === atual.empresaId ? loja : null;
}

function resumirLoja(l: NonNullable<Awaited<ReturnType<typeof buscarLojaDaEmpresa>>>) {
  return {
    id: l.id,
    nomeFantasia: l.nomeFantasia,
    razaoSocial: l.razaoSocial ?? undefined,
    cnpj: l.cnpj,
    telefone: l.telefone ?? undefined,
    email: l.email ?? undefined,
    site: l.site ?? undefined,
    inscricaoEstadual: l.inscricaoEstadual ?? undefined,
    inscricaoMunicipal: l.inscricaoMunicipal ?? undefined,
    regimeTributario: l.regimeTributario ?? undefined,
    endereco: {
      cep: l.cep ?? undefined,
      logradouro: l.logradouro ?? undefined,
      numero: l.numero ?? undefined,
      complemento: l.complemento ?? undefined,
      bairro: l.bairro ?? undefined,
      cidade: l.cidade ?? undefined,
      uf: l.uf ?? undefined,
    },
    logoDaLojaUrl: l.logoDaLojaUrl,
    corPrincipalDoTema: l.corPrincipalDoTema,
    fusoHorario: l.fusoHorario,
    exigirSenhaAoAbrirCaixa: l.exigirSenhaAoAbrirCaixa,
    ativo: l.ativo,
    criadoEm: l.criadoEm.toISOString(),
  };
}

/** Lista todas as lojas da empresa (inclusive desativadas) com indicadores
 * de cada uma: usuários, produtos ativos e vendas/faturamento do mês. */
lojasRouter.get('/', async (req, res) => {
  const { tenantId } = req.usuario!;
  const atual = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { empresaId: true } });
  if (!atual) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const lojas = await prisma.tenant.findMany({
    where: { empresaId: atual.empresaId },
    orderBy: { criadoEm: 'asc' },
  });
  const ids = lojas.map((l) => l.id);

  const inicioDoMes = new Date();
  inicioDoMes.setDate(1);
  inicioDoMes.setHours(0, 0, 0, 0);

  const [usuarios, acessos, produtos, vendas] = await Promise.all([
    prisma.usuario.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, ativo: true }, _count: { _all: true } }),
    prisma.acessoLoja.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids } }, _count: { _all: true } }),
    prisma.produto.groupBy({ by: ['tenantId'], where: { tenantId: { in: ids }, ativo: true }, _count: { _all: true } }),
    prisma.transacao.groupBy({
      by: ['tenantId'],
      where: { tenantId: { in: ids }, ...VENDA_VALIDA, timestamp: { gte: inicioDoMes } },
      _sum: { valorTotal: true },
      _count: { _all: true },
    }),
  ]);
  const contar = (linhas: { tenantId: string; _count: { _all: number } }[], id: string) =>
    linhas.find((l) => l.tenantId === id)?._count._all ?? 0;

  res.json(
    lojas.map((l) => {
      const v = vendas.find((x) => x.tenantId === l.id);
      return {
        ...resumirLoja(l),
        atual: l.id === tenantId,
        indicadores: {
          usuarios: contar(usuarios, l.id) + contar(acessos, l.id),
          produtos: contar(produtos, l.id),
          vendasDoMes: v?._count._all ?? 0,
          faturamentoDoMes: Number(v?._sum.valorTotal ?? 0),
        },
      };
    }),
  );
});

/** Todos os usuários da empresa (de qualquer loja) — alimenta a escolha de
 * quem receberá acesso a uma loja. Definida antes de "/:tenantId" pra "usuarios"
 * não ser lido como id de loja. */
lojasRouter.get('/usuarios', async (req, res) => {
  const atual = await prisma.tenant.findUnique({ where: { id: req.usuario!.tenantId }, select: { empresaId: true } });
  if (!atual) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const usuarios = await prisma.usuario.findMany({
    where: { tenant: { empresaId: atual.empresaId }, ativo: true },
    select: { id: true, nome: true, email: true, papel: true, tenant: { select: { id: true, nomeFantasia: true } } },
    orderBy: { nome: 'asc' },
  });
  res.json(
    usuarios.map((u) => ({ id: u.id, nome: u.nome, email: u.email, papel: u.papel, lojaId: u.tenant.id, lojaNome: u.tenant.nomeFantasia })),
  );
});

lojasRouter.get('/:tenantId', async (req, res) => {
  const loja = await buscarLojaDaEmpresa(req.usuario!.tenantId, req.params.tenantId);
  if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });
  res.json({ ...resumirLoja(loja), atual: loja.id === req.usuario!.tenantId });
});

/** Edita os dados cadastrais e operacionais de uma loja da empresa. Campos
 * de texto opcionais enviados vazios apagam o valor; campos omitidos ficam
 * como estão. */
lojasRouter.put('/:tenantId', async (req, res) => {
  const loja = await buscarLojaDaEmpresa(req.usuario!.tenantId, req.params.tenantId);
  if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const parse = editarLojaSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }

  const r = await aplicarEdicaoDaLoja(loja, parse.data);
  if (!r.ok) return res.status(r.status).json({ erro: r.erro });

  await registrarAuditoria(loja.id, req.usuario!.id, 'loja.editar', r.loja.nomeFantasia);
  res.json({ ...resumirLoja(r.loja), atual: r.loja.id === req.usuario!.tenantId });
});

const ativoSchema = z.object({ ativo: z.boolean() });

/** Desativa ou reativa uma loja. Desativada, ela some do seletor, ninguém
 * consegue entrar nela e as requisições dos tokens dela passam a falhar, mas
 * nada é apagado (vendas, estoque, financeiro ficam preservados). */
lojasRouter.patch('/:tenantId/ativo', async (req, res) => {
  const parse = ativoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Dados inválidos.' });

  const loja = await buscarLojaDaEmpresa(req.usuario!.tenantId, req.params.tenantId);
  if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });
  const { ativo } = parse.data;
  if (loja.ativo === ativo) return res.json({ id: loja.id, ativo });

  if (!ativo) {
    if (loja.id === req.usuario!.tenantId) {
      return res.status(409).json({ erro: 'Você está dentro desta loja. Troque para outra antes de desativá-la.' });
    }
    const dono = await prisma.usuario.findUnique({ where: { id: req.usuario!.id }, select: { tenantId: true } });
    if (dono?.tenantId === loja.id) {
      return res.status(409).json({ erro: 'Esta é a loja de origem da sua conta e não pode ser desativada.' });
    }
    const contaPrincipalDaLoja = await prisma.usuario.count({ where: { tenantId: loja.id, raiz: true } });
    if (contaPrincipalDaLoja > 0) {
      return res.status(409).json({ erro: 'Esta loja tem uma conta principal própria e não pode ser desativada por aqui.' });
    }
  }

  await prisma.tenant.update({ where: { id: loja.id }, data: { ativo } });
  await registrarAuditoria(
    req.usuario!.tenantId,
    req.usuario!.id,
    ativo ? 'loja.reativar' : 'loja.desativar',
    loja.nomeFantasia,
  );
  res.json({ id: loja.id, ativo });
});

/** Quem tem acesso à loja: os usuários dela (acesso próprio, não revogável) e
 * os de outras lojas da empresa que receberam acesso extra. */
lojasRouter.get('/:tenantId/acessos', async (req, res) => {
  const loja = await buscarLojaDaEmpresa(req.usuario!.tenantId, req.params.tenantId);
  if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const [proprios, concedidos] = await Promise.all([
    prisma.usuario.findMany({
      where: { tenantId: loja.id },
      select: { id: true, nome: true, email: true, papel: true, ativo: true },
      orderBy: { nome: 'asc' },
    }),
    prisma.acessoLoja.findMany({
      where: { tenantId: loja.id },
      include: { usuario: { select: { id: true, nome: true, email: true, papel: true, ativo: true } } },
      orderBy: { criadoEm: 'asc' },
    }),
  ]);

  res.json([
    ...proprios.map((u) => ({ ...u, origem: 'PROPRIO' as const })),
    ...concedidos.map((a) => ({ ...a.usuario, origem: 'CONCEDIDO' as const, concedidoEm: a.criadoEm.toISOString() })),
  ]);
});

/** Revoga um acesso extra. O acesso "próprio" (usuário criado nesta loja) não
 * é um AcessoLoja e não se revoga aqui: pra isso, desative o usuário. */
lojasRouter.delete('/:tenantId/acessos/:usuarioId', async (req, res) => {
  const loja = await buscarLojaDaEmpresa(req.usuario!.tenantId, req.params.tenantId);
  if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const { usuarioId } = req.params;
  if (usuarioId === req.usuario!.id && loja.id === req.usuario!.tenantId) {
    return res.status(409).json({ erro: 'Você não pode remover o seu próprio acesso à loja em que está.' });
  }

  const acesso = await prisma.acessoLoja.findUnique({
    where: { usuarioId_tenantId: { usuarioId, tenantId: loja.id } },
    include: { usuario: { select: { nome: true } } },
  });
  if (!acesso) return res.status(404).json({ erro: 'Este usuário não tem acesso extra a esta loja.' });

  await prisma.acessoLoja.delete({ where: { id: acesso.id } });
  await registrarAuditoria(
    req.usuario!.tenantId,
    req.usuario!.id,
    'loja.revogarAcesso',
    `${acesso.usuario.nome} → ${loja.nomeFantasia}`,
  );
  res.status(204).end();
});

const excluirLojaSchema = z.object({
  senha: z.string().min(1),
  cnpj: z.string().min(1),
});

/** Exclusão definitiva de uma loja e de todos os dados dela (vendas, estoque,
 * clientes, financeiro, caixas, vendedores, auditoria e os usuários criados
 * nela) — atende o pedido de eliminação de dados da LGPD. Não tem volta, então
 * exige a senha de quem está pedindo e a digitação do CNPJ da loja. */
lojasRouter.delete('/:tenantId', async (req, res) => {
  const parse = excluirLojaSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Confirme com a sua senha e o CNPJ da loja.' });
  }

  const loja = await buscarLojaDaEmpresa(req.usuario!.tenantId, req.params.tenantId);
  if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const solicitante = await prisma.usuario.findUnique({ where: { id: req.usuario!.id } });
  if (!solicitante || !(await bcrypt.compare(parse.data.senha, solicitante.senhaHash))) {
    return res.status(403).json({ erro: 'Senha incorreta.' });
  }
  if (normalizarCnpj(parse.data.cnpj) !== loja.cnpj) {
    return res.status(400).json({ erro: 'O CNPJ digitado não confere com o da loja.' });
  }

  if (loja.id === req.usuario!.tenantId) {
    return res.status(409).json({ erro: 'Você está dentro desta loja. Troque para outra antes de excluí-la.' });
  }
  if (loja.id === solicitante.tenantId) {
    return res.status(409).json({ erro: 'Esta é a loja de origem da sua conta e não pode ser excluída por aqui.' });
  }
  const contasPrincipais = await prisma.usuario.count({ where: { tenantId: loja.id, raiz: true } });
  if (contasPrincipais > 0) {
    return res.status(409).json({ erro: 'Esta loja tem uma conta principal própria e não pode ser excluída por aqui.' });
  }

  // Usuários criados nesta loja são apagados junto. Se algum tem movimentações
  // em OUTRA loja, o banco não deixa apagá-lo sem quebrar o histórico de lá.
  const comHistorico = await usuarioComHistoricoEmOutraLoja([loja.id]);
  if (comHistorico) {
    return res.status(409).json({
      erro: `${comHistorico} tem movimentações em outra loja e não pode ser apagado junto. Desative esse usuário e tente de novo.`,
    });
  }

  await prisma.$transaction(operacoesExcluirLojas([loja.id]));

  // A trilha da loja apagada foi junto com ela, então o registro fica na loja
  // de onde o pedido partiu (só nome e CNPJ da empresa, nenhum dado pessoal).
  await registrarAuditoria(req.usuario!.tenantId, req.usuario!.id, 'loja.excluir', `${loja.nomeFantasia} (${loja.cnpj})`);
  res.status(204).end();
});
