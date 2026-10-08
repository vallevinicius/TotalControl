import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTenant } from '@/contexts/TenantContext';
import { diasRestantesTrial } from '@/utils/planos';

const CHAVE = 'tc-aviso-assinatura-fechado';
const ate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR') : '');

/** Faixa no topo do app avisando o que pede ação sobre a assinatura: cobrança
 * recusada, teste grátis acabando ou assinatura cancelada perto do fim. */
export function AvisoAssinatura() {
  const { tenant, usuarioAtual } = useTenant();
  const [fechado, setFechado] = useState(() => {
    try {
      return sessionStorage.getItem(CHAVE) ?? '';
    } catch {
      return '';
    }
  });
  if (!tenant || tenant.acessoExpirado) return null;

  const status = tenant.assinatura?.status;
  const dias = diasRestantesTrial(tenant.trialExpiraEm);
  const acessoAte = tenant.assinatura?.acessoAte;
  const diasParaFim = acessoAte ? Math.ceil((new Date(acessoAte).getTime() - Date.now()) / 86_400_000) : null;

  let chave = '';
  let tom: 'erro' | 'aviso' = 'aviso';
  let texto = '';
  if (status === 'PAUSADA') {
    chave = 'pausada';
    tom = 'erro';
    texto = 'Não conseguimos cobrar sua assinatura. Regularize o pagamento para não perder o acesso.';
  } else if (status === 'CANCELADA' && diasParaFim !== null && diasParaFim <= 7) {
    chave = 'cancelada';
    texto = `Sua assinatura foi cancelada e o acesso vai até ${ate(acessoAte)}. Reative para continuar usando.`;
  } else if (status !== 'ATIVA' && dias !== null && dias <= 3 && dias > 0) {
    chave = 'trial';
    texto = `Seu teste grátis termina em ${dias} dia(s). Escolha um plano para não perder o acesso.`;
  }
  if (!chave || fechado === chave) return null;

  const podeResolver = Boolean(usuarioAtual?.raiz);
  const cores = tom === 'erro' ? 'border-red-500/30 bg-red-500/10 text-red-300' : 'border-amber-500/30 bg-amber-500/10 text-amber-300';

  return (
    <div className={`mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border px-4 py-3 text-sm ${cores}`} role="status">
      <p>{texto}</p>
      <div className="flex items-center gap-3">
        {podeResolver && (
          <Link to="/plano" className="rounded-md bg-white/10 px-3 py-1 font-medium hover:bg-white/20">
            Ver plano
          </Link>
        )}
        <button
          onClick={() => {
            setFechado(chave);
            try {
              sessionStorage.setItem(CHAVE, chave);
            } catch {
              // sem armazenamento: o aviso só volta no próximo carregamento
            }
          }}
          aria-label="Dispensar aviso"
          className="opacity-70 hover:opacity-100"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
