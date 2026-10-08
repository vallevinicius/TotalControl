import type { PlanoSaaS } from '@prisma/client';

/** Duração do trial dado no cadastro self-service (hoje: STARTER). O trial
 * é uma propriedade de `Empresa.trialExpiraEm`, independente do plano — não
 * é exclusivo do plano FREE (que hoje só existe como opção residual
 * atribuível manualmente pelo admin, ex: conta de cortesia). */
export const DIAS_TRIAL = 14;

export type FeaturePlano = 'financeiro' | 'relatorios' | 'vendedores' | 'multiLoja';

export interface LimitesPlano {
  maxUsuarios: number | null;
  maxProdutos: number | null;
  features: Record<FeaturePlano, boolean>;
}

/** Fonte única de verdade dos limites/recursos de cada plano do SaaS. */
export const LIMITES_POR_PLANO: Record<PlanoSaaS, LimitesPlano> = {
  FREE: {
    maxUsuarios: 1,
    maxProdutos: 30,
    features: { financeiro: false, relatorios: false, vendedores: false, multiLoja: false },
  },
  STARTER: {
    maxUsuarios: 3,
    maxProdutos: 300,
    features: { financeiro: true, relatorios: true, vendedores: false, multiLoja: false },
  },
  PRO: {
    maxUsuarios: 10,
    maxProdutos: null,
    features: { financeiro: true, relatorios: true, vendedores: true, multiLoja: false },
  },
  ENTERPRISE: {
    maxUsuarios: null,
    maxProdutos: null,
    features: { financeiro: true, relatorios: true, vendedores: true, multiLoja: true },
  },
};

export function calcularTrialExpiraEm(): Date {
  const data = new Date();
  data.setDate(data.getDate() + DIAS_TRIAL);
  return data;
}

/** Preço mensal (R$) dos planos vendidos com assinatura automática pelo
 * Mercado Pago. O Enterprise fica de fora de propósito: tem preço "a partir de"
 * e cobrança por loja adicional, então é negociado com a equipe. Mantenha
 * em sincronia com src/components/Marketing/LandingPricing.tsx. */
export const PRECOS_MENSAIS = { STARTER: 59.9, PRO: 129.9 } as const;
export type PlanoAssinavel = keyof typeof PRECOS_MENSAIS;

export function planoAssinavel(valor: unknown): valor is PlanoAssinavel {
  return valor === 'STARTER' || valor === 'PRO';
}

interface EmpresaParaAcesso {
  trialExpiraEm: Date | null;
  assinaturaStatus: string;
  acessoAte: Date | null;
}

/** Por que o acesso da empresa acabou (ou null se está liberado):
 * - TRIAL: o teste grátis terminou e não há assinatura ativa;
 * - ASSINATURA: cancelou (ou a cobrança falhou) e o período já pago acabou.
 * Nos dois casos o login continua funcionando, mas só a tela do plano abre,
 * pra pessoa poder assinar de novo. */
export function motivoAcessoExpirado(e: EmpresaParaAcesso, agora = new Date()): 'TRIAL' | 'ASSINATURA' | null {
  if (e.assinaturaStatus === 'CANCELADA' || e.assinaturaStatus === 'PAUSADA') {
    return !e.acessoAte || e.acessoAte < agora ? 'ASSINATURA' : null;
  }
  if (e.assinaturaStatus !== 'ATIVA' && e.trialExpiraEm && e.trialExpiraEm < agora) return 'TRIAL';
  return null;
}
