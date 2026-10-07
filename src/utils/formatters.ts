import type { Tenant } from '@/types';

/**
 * Formata valores monetários respeitando a moeda configurada pelo tenant
 * (nunca hardcoded como "R$" fixo em cada componente).
 */
export function formatarMoeda(valor: number, tenant: Tenant | null): string {
  const moeda = tenant?.configuracoes.moeda ?? 'BRL';
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: moeda }).format(valor);
}

/**
 * Formata data/hora respeitando o fuso horário configurado pelo tenant.
 */
export function formatarDataHora(isoString: string, tenant: Tenant | null): string {
  const fusoHorario = tenant?.configuracoes.fusoHorario ?? 'America/Sao_Paulo';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fusoHorario,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoString));
}

export function formatarHora(isoString: string, tenant: Tenant | null): string {
  const fusoHorario = tenant?.configuracoes.fusoHorario ?? 'America/Sao_Paulo';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: fusoHorario,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(isoString));
}

const rotulosFormaPagamento: Record<string, string> = {
  PIX: 'Pix',
  CARTAO_CREDITO: 'Cartão de Crédito',
  CARTAO_DEBITO: 'Cartão de Débito',
  DINHEIRO: 'Dinheiro',
  BOLETO: 'Boleto',
  OUTRO: 'Outro',
};

export function formatarFormaPagamento(forma?: string): string {
  if (!forma) return '-';
  return rotulosFormaPagamento[forma] ?? forma;
}
