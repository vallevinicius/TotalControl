import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireContaPrincipal } from '../middleware/contaPrincipal.js';
import bcrypt from 'bcryptjs';
import { registrarAuditoria } from '../lib/auditoria.js';
import { aplicarEdicaoDaLoja, editarLojaSchema } from '../lib/dadosLoja.js';
import { normalizarCnpj } from '../lib/documentos.js';
import { operacoesExcluirLojas } from '../lib/exclusao.js';
import { emailContaExcluida, enviarEmail } from '../lib/email.js';
import { ErroMercadoPago, cancelarAssinatura } from '../lib/mercadopago.js';

export const tenantRouter = Router();
tenantRouter.use(requireAuth);

const corHex = /^#[0-9a-fA-F]{6}$/;

const aparenciaSchema = z.object({
  corPrincipalDoTema: z.string().regex(corHex, 'Use um hex de 6 dígitos, ex: #10B981'),
  // null = voltar a calcular o hover automaticamente a partir da cor principal.
  corPrincipalHover: z.string().regex(corHex).nullable().optional(),
  // Aceita tanto um link (imagem já hospedada) quanto uma imagem enviada do
  // computador, convertida em base64 no front (data URL) — sem depender de
  // um serviço externo de armazenamento de arquivos.
  logoDaLojaUrl: z
    .string()
    .max(2_000_000, 'Imagem muito grande.')
    .refine((v) => /^https?:\/\//.test(v) || /^data:image\/(png|jpe?g|webp|gif|svg\+xml);base64,/.test(v), {
      message: 'Logo inválida.',
    })
    .optional(),
});

/** Personalização visual da loja (cor de destaque/logo) — só a conta
 * principal muda, e vale só pra loja atual (cada loja tem a sua). */
tenantRouter.put('/aparencia', requireContaPrincipal, async (req, res) => {
  const parse = aparenciaSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }

  const { tenantId, id: usuarioId } = req.usuario!;
  const { corPrincipalDoTema, corPrincipalHover, logoDaLojaUrl } = parse.data;
  const atualizado = await prisma.tenant.update({
    where: { id: tenantId },
    data: { corPrincipalDoTema, corPrincipalHover, logoDaLojaUrl },
  });

  await registrarAuditoria(tenantId, usuarioId, 'loja.personalizarAparencia', parse.data.corPrincipalDoTema);

  res.json({
    logoDaLojaUrl: atualizado.logoDaLojaUrl,
    corPrincipalDoTema: atualizado.corPrincipalDoTema,
    corPrincipalHover: atualizado.corPrincipalHover ?? undefined,
  });
});

/** Edita os dados cadastrais da empresa (loja atual), em qualquer plano. */
tenantRouter.put('/dados', requireContaPrincipal, async (req, res) => {
  const parse = editarLojaSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }
  const loja = await prisma.tenant.findUnique({ where: { id: req.usuario!.tenantId } });
  if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const r = await aplicarEdicaoDaLoja(loja, parse.data);
  if (!r.ok) return res.status(r.status).json({ erro: r.erro });

  await registrarAuditoria(loja.id, req.usuario!.id, 'loja.editar', r.loja.nomeFantasia);
  res.json({ ok: true });
});

/** LGPD: exporta tudo o que a empresa guarda no sistema (todas as lojas), em JSON.
 * Nunca inclui hash de senha nem tokens. Só a conta principal. */
tenantRouter.get('/exportar', requireContaPrincipal, async (req, res) => {
  const atual = await prisma.tenant.findUnique({ where: { id: req.usuario!.tenantId }, include: { empresa: true } });
  if (!atual) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const lojas = await prisma.tenant.findMany({
    where: { empresaId: atual.empresaId },
    orderBy: { criadoEm: 'asc' },
    include: {
      usuarios: {
        select: { id: true, nome: true, email: true, cpf: true, telefone: true, papel: true, raiz: true, ativo: true, permissoes: true, aceiteTermosEm: true, aceiteTermosVersao: true, criadoEm: true },
      },
      categorias: true,
      produtos: true,
      clientes: true,
      vendedores: true,
      transacoes: { include: { itens: true }, orderBy: { timestamp: 'asc' } },
      lancamentosFinanceiros: true,
      caixas: true,
      registrosAuditoria: { orderBy: { criadoEm: 'asc' } },
    },
  });

  const e = atual.empresa;
  const exportacao = {
    geradoEm: new Date().toISOString(),
    aviso: 'Dados da sua empresa no Total Control. Senhas e tokens de acesso não fazem parte da exportação.',
    empresa: { id: e.id, nome: e.nome, plano: e.planoAtual, criadaEm: e.criadoEm, assinatura: e.assinaturaStatus, acessoAte: e.acessoAte },
    lojas: lojas.map(({ logoDaLojaUrl: _logo, ...loja }) => loja),
  };

  await registrarAuditoria(atual.id, req.usuario!.id, 'empresa.exportarDados');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="total-control-dados-${new Date().toISOString().slice(0, 10)}.json"`);
  res.send(JSON.stringify(exportacao, null, 2));
});

const excluirContaSchema = z.object({ senha: z.string().min(1), cnpj: z.string().min(1) });

/** LGPD: exclui a EMPRESA inteira (todas as lojas, usuários e dados) a pedido da
 * conta principal. Cancela antes a assinatura no Mercado Pago, pra não haver
 * cobrança depois da exclusão. Sem volta. */
tenantRouter.delete('/conta', requireContaPrincipal, async (req, res) => {
  const parse = excluirContaSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Confirme com a sua senha e o CNPJ da loja principal.' });

  const solicitante = await prisma.usuario.findUnique({ where: { id: req.usuario!.id }, include: { tenant: { include: { empresa: true } } } });
  if (!solicitante || !(await bcrypt.compare(parse.data.senha, solicitante.senhaHash))) {
    return res.status(403).json({ erro: 'Senha incorreta.' });
  }
  const lojaPrincipal = solicitante.tenant;
  if (normalizarCnpj(parse.data.cnpj) !== lojaPrincipal.cnpj) {
    return res.status(400).json({ erro: 'O CNPJ digitado não confere com o da loja principal.' });
  }

  const empresa = lojaPrincipal.empresa;
  // Primeiro a cobrança: se não der pra cancelar, nada é apagado.
  try {
    for (const id of [empresa.mpAssinaturaId, empresa.mpCheckoutId]) if (id) await cancelarAssinatura(id);
  } catch (e) {
    if (e instanceof ErroMercadoPago && e.status !== 404) {
      return res.status(502).json({ erro: 'Não foi possível cancelar a assinatura agora, então nada foi apagado. Tente de novo em instantes ou fale com o suporte.' });
    }
  }

  const lojas = await prisma.tenant.findMany({ where: { empresaId: empresa.id }, select: { id: true } });
  await prisma.$transaction([...operacoesExcluirLojas(lojas.map((l) => l.id)), prisma.empresa.delete({ where: { id: empresa.id } })]);
  console.log(`Conta excluída a pedido do titular: empresa ${empresa.id}`);

  enviarEmail({ para: solicitante.email, ...emailContaExcluida(solicitante.nome, empresa.nome) }).catch(() => undefined);
  res.status(204).end();
});

/** Liga ou desliga os avisos por e-mail da empresa (teste acabando, pagamento, estoque, contas). */
tenantRouter.put('/avisos', requireContaPrincipal, async (req, res) => {
  const parse = z.object({ ativo: z.boolean() }).safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Dados inválidos.' });
  const loja = await prisma.tenant.findUnique({ where: { id: req.usuario!.tenantId }, select: { empresaId: true } });
  if (!loja) return res.status(404).json({ erro: 'Loja não encontrada.' });
  await prisma.empresa.update({ where: { id: loja.empresaId }, data: { avisosEmail: parse.data.ativo } });
  res.json({ ativo: parse.data.ativo });
});
