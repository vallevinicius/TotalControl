import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requireContaPrincipal } from '../middleware/contaPrincipal.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { avisarPagamentoRecusado } from '../lib/avisos.js';
import { PRECOS_MENSAIS, motivoAcessoExpirado, planoAssinavel, type PlanoAssinavel } from '../config/planos.js';
import {
  ErroMercadoPago,
  assinaturaDoPagamento,
  assinaturaDoWebhookValida,
  buscarAssinatura,
  cancelarAssinatura,
  criarAssinatura,
  listarCobrancas,
  mercadoPagoConfigurado,
} from '../lib/mercadopago.js';

export const assinaturaRouter = Router();

const urlDoApp = () => (process.env.APP_URL ?? 'http://localhost:3099').replace(/\/$/, '');
const urlPublicaDaApi = () => process.env.API_PUBLIC_URL?.replace(/\/$/, '');

// ----------------------------------------------------------------------------
// Sincronização com o Mercado Pago
// ----------------------------------------------------------------------------

/** Lê o estado real de uma assinatura no Mercado Pago e aplica na empresa.
 * É a única porta de entrada do estado de cobrança: o webhook e o botão
 * "atualizar" chamam isto, e nunca confiam no que veio na requisição, só no
 * que o próprio Mercado Pago responde. Idempotente. */
export async function sincronizarAssinatura(mpId: string): Promise<void> {
  const mp = await buscarAssinatura(mpId);
  const [empresaId, planoRef] = (mp.external_reference ?? '').split('|');
  if (!empresaId) return;

  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId } });
  if (!empresa) return;

  const proximaCobranca = mp.next_payment_date ? new Date(mp.next_payment_date) : null;

  // Novo plano / upgrade: quando o Mercado Pago autoriza o checkout, ele vira a
  // assinatura vigente e a anterior é cancelada (senão a pessoa pagaria duas).
  if (empresa.mpCheckoutId === mpId) {
    if (mp.status === 'authorized') {
      const plano: PlanoAssinavel = planoAssinavel(planoRef) ? planoRef : (empresa.planoPendente as PlanoAssinavel) ?? 'STARTER';
      const anterior = empresa.mpAssinaturaId;
      await prisma.empresa.update({
        where: { id: empresa.id },
        data: {
          planoAtual: plano,
          planoPendente: null,
          trialExpiraEm: null,
          assinaturaStatus: 'ATIVA',
          mpAssinaturaId: mpId,
          mpCheckoutId: null,
          acessoAte: proximaCobranca ?? proximoMes(),
          canceladaEm: null,
        },
      });
      if (anterior && anterior !== mpId) {
        await cancelarAssinatura(anterior).catch((e) => console.error('Falha ao cancelar a assinatura anterior:', e));
      }
    } else if (mp.status === 'cancelled') {
      await prisma.empresa.update({ where: { id: empresa.id }, data: { mpCheckoutId: null, planoPendente: null } });
    }
    return;
  }

  // Assinatura vigente: só acompanha mudanças (renovação, pausa, cancelamento).
  if (empresa.mpAssinaturaId !== mpId) return; // evento de uma assinatura antiga

  if (mp.status === 'authorized') {
    await prisma.empresa.update({
      where: { id: empresa.id },
      data: { assinaturaStatus: 'ATIVA', acessoAte: proximaCobranca ?? empresa.acessoAte ?? proximoMes() },
    });
  } else if (mp.status === 'paused') {
    await prisma.empresa.update({ where: { id: empresa.id }, data: { assinaturaStatus: 'PAUSADA' } });
    // Só avisa na virada (a notificação pode chegar repetida).
    if (empresa.assinaturaStatus !== 'PAUSADA') avisarPagamentoRecusado(empresa.id).catch(() => undefined);
  } else if (mp.status === 'cancelled' && empresa.assinaturaStatus !== 'CANCELADA') {
    await prisma.empresa.update({
      where: { id: empresa.id },
      data: { assinaturaStatus: 'CANCELADA', canceladaEm: new Date(), acessoAte: empresa.acessoAte ?? new Date() },
    });
  }
}

function proximoMes(): Date {
  const d = new Date();
  d.setMonth(d.getMonth() + 1);
  return d;
}

// ----------------------------------------------------------------------------
// Webhook (público: o Mercado Pago chama sem login)
// ----------------------------------------------------------------------------

/** Notificações do Mercado Pago. O corpo só diz "algo mudou na assinatura X":
 * buscamos o estado de verdade na API deles, então uma chamada forjada não
 * consegue alterar nada. Responde 200 pro Mercado Pago parar de reenviar. */
assinaturaRouter.post('/webhook', async (req, res) => {
  const tipo = String(req.body?.type ?? req.query.type ?? req.query.topic ?? '');
  const id = String(req.body?.data?.id ?? req.query['data.id'] ?? req.query.id ?? '');
  if (!id) return res.status(200).json({ ok: true });
  if (!assinaturaDoWebhookValida({ assinatura: req.get('x-signature'), idRequisicao: req.get('x-request-id') }, id)) {
    return res.status(401).json({ erro: 'Assinatura da notificação inválida.' });
  }

  try {
    if (tipo === 'subscription_preapproval' || tipo === 'preapproval') {
      await sincronizarAssinatura(id);
    } else if (tipo === 'subscription_authorized_payment') {
      const mpId = await assinaturaDoPagamento(id);
      if (mpId) await sincronizarAssinatura(mpId);
    }
    res.status(200).json({ ok: true });
  } catch (erro) {
    // Id que o Mercado Pago desconhece (notificação de teste ou forjada): nada a fazer.
    if (erro instanceof ErroMercadoPago && erro.status === 404) return res.status(200).json({ ok: true });
    console.error('Falha ao processar o webhook do Mercado Pago:', erro);
    // 500 faz o Mercado Pago tentar de novo mais tarde.
    res.status(500).json({ erro: 'Falha ao processar a notificação.' });
  }
});

// ----------------------------------------------------------------------------
// Área do cliente (só a conta principal)
// ----------------------------------------------------------------------------

assinaturaRouter.use(requireAuth, requireContaPrincipal);

async function carregarEmpresa(tenantId: string) {
  const loja = await prisma.tenant.findUnique({ where: { id: tenantId }, include: { empresa: true } });
  return loja?.empresa ?? null;
}

function resumo(e: NonNullable<Awaited<ReturnType<typeof carregarEmpresa>>>) {
  return {
    plano: e.planoAtual,
    status: e.assinaturaStatus,
    trialExpiraEm: e.trialExpiraEm?.toISOString() ?? null,
    acessoAte: e.acessoAte?.toISOString() ?? null,
    canceladaEm: e.canceladaEm?.toISOString() ?? null,
    planoPendente: e.planoPendente,
    acessoExpirado: motivoAcessoExpirado(e),
    precos: PRECOS_MENSAIS,
    pagamentoDisponivel: mercadoPagoConfigurado(),
  };
}

assinaturaRouter.get('/', async (req, res) => {
  const empresa = await carregarEmpresa(req.usuario!.tenantId);
  if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  res.json(resumo(empresa));
});

/** Atualiza o estado pela API do Mercado Pago. Serve quando a pessoa volta do
 * checkout (o webhook pode demorar ou não chegar, ex: ambiente local). */
assinaturaRouter.post('/sincronizar', async (req, res) => {
  const empresa = await carregarEmpresa(req.usuario!.tenantId);
  if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  try {
    for (const id of [empresa.mpCheckoutId, empresa.mpAssinaturaId]) if (id) await sincronizarAssinatura(id);
  } catch (e) {
    if (e instanceof ErroMercadoPago) return res.status(e.status).json({ erro: e.message });
    throw e;
  }
  res.json(resumo((await carregarEmpresa(req.usuario!.tenantId))!));
});

/** Histórico de cobranças da assinatura (da mais recente para a mais antiga).
 * Vem direto do Mercado Pago; sem assinatura ou sem Mercado Pago, lista vazia. */
assinaturaRouter.get('/cobrancas', async (req, res) => {
  const empresa = await carregarEmpresa(req.usuario!.tenantId);
  if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  if (!empresa.mpAssinaturaId || !mercadoPagoConfigurado()) return res.json([]);
  try {
    res.json(await listarCobrancas(empresa.mpAssinaturaId));
  } catch (e) {
    if (e instanceof ErroMercadoPago) return res.status(e.status).json({ erro: e.message });
    throw e;
  }
});

const checkoutSchema = z.object({ plano: z.string() });

/** Começa a assinatura (ou o upgrade): cria a assinatura no Mercado Pago e
 * devolve o link do checkout. O plano só muda quando o pagamento é autorizado. */
assinaturaRouter.post('/checkout', async (req, res) => {
  const parse = checkoutSchema.safeParse(req.body);
  if (!parse.success || !planoAssinavel(parse.data.plano)) {
    return res.status(400).json({ erro: 'Este plano não pode ser contratado por aqui. Fale com a equipe da Total Software.' });
  }
  const plano = parse.data.plano;

  const empresa = await carregarEmpresa(req.usuario!.tenantId);
  if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  if (empresa.assinaturaStatus === 'ATIVA' && empresa.planoAtual === plano) {
    return res.status(409).json({ erro: 'Sua empresa já está nesse plano.' });
  }

  const usuario = await prisma.usuario.findUnique({ where: { id: req.usuario!.id }, select: { email: true } });

  try {
    const notificacao = urlPublicaDaApi();
    const mp = await criarAssinatura({
      motivo: `Total Control - Plano ${plano === 'PRO' ? 'Pro' : 'Starter'}`,
      referenciaExterna: `${empresa.id}|${plano}`,
      emailPagador: usuario!.email,
      valor: PRECOS_MENSAIS[plano],
      urlDeRetorno: `${urlDoApp()}/plano?retorno=1`,
      urlDeNotificacao: notificacao ? `${notificacao}/api/assinatura/webhook` : undefined,
    });
    if (!mp.init_point) throw new ErroMercadoPago('O Mercado Pago não devolveu o link de pagamento.');
    // Checkout anterior que a pessoa abandonou: cancela pra não sobrar assinatura pendente solta.
    if (empresa.mpCheckoutId) await cancelarAssinatura(empresa.mpCheckoutId).catch(() => undefined);

    await prisma.empresa.update({
      where: { id: empresa.id },
      data: {
        mpCheckoutId: mp.id,
        planoPendente: plano,
        ...(empresa.assinaturaStatus === 'NENHUMA' ? { assinaturaStatus: 'PENDENTE' } : {}),
      },
    });
    await registrarAuditoria(req.usuario!.tenantId, req.usuario!.id, 'assinatura.iniciar', plano);
    res.json({ url: mp.init_point });
  } catch (e) {
    if (e instanceof ErroMercadoPago) return res.status(e.status).json({ erro: e.message });
    throw e;
  }
});

/** Cancela a renovação. O acesso continua até o fim do período já pago
 * (`acessoAte`); depois disso a empresa cai na tela de assinar de novo. */
assinaturaRouter.post('/cancelar', async (req, res) => {
  const empresa = await carregarEmpresa(req.usuario!.tenantId);
  if (!empresa) return res.status(404).json({ erro: 'Empresa não encontrada.' });
  if (empresa.assinaturaStatus !== 'ATIVA' || !empresa.mpAssinaturaId) {
    return res.status(409).json({ erro: 'Não há uma assinatura ativa para cancelar.' });
  }

  try {
    await cancelarAssinatura(empresa.mpAssinaturaId);
  } catch (e) {
    if (e instanceof ErroMercadoPago) return res.status(e.status).json({ erro: e.message });
    throw e;
  }

  const atualizada = await prisma.empresa.update({
    where: { id: empresa.id },
    data: { assinaturaStatus: 'CANCELADA', canceladaEm: new Date(), acessoAte: empresa.acessoAte ?? new Date() },
  });
  await registrarAuditoria(req.usuario!.tenantId, req.usuario!.id, 'assinatura.cancelar', empresa.planoAtual);
  res.json(resumo(atualizada));
});
