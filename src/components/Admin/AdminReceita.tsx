import { useEffect, useState } from 'react';
import { adminReceita, type ReceitaAdmin } from '@/services/apiService';
import { formatarMoeda } from '@/utils/formatters';

/** Receita recorrente e saúde da base de clientes (o Enterprise é negociado à mão, então fica fora do MRR). */
export function AdminReceita() {
  const [r, setR] = useState<ReceitaAdmin | null>(null);
  useEffect(() => {
    adminReceita().then(setR).catch(() => setR(null));
  }, []);
  if (!r) return null;

  const cartoes = [
    { rotulo: 'Receita mensal (MRR)', valor: formatarMoeda(r.mrr, null), detalhe: `${formatarMoeda(r.arr, null)} por ano`, destaque: true },
    {
      rotulo: 'Assinantes ativos',
      valor: String(r.assinantesAtivos),
      detalhe: `${r.assinantesPorPlano.STARTER} Starter, ${r.assinantesPorPlano.PRO} Pro, ${r.assinantesPorPlano.ENTERPRISE} Enterprise (fora do MRR)`,
    },
    { rotulo: 'Cancelamentos em 30 dias', valor: String(r.canceladas30d), detalhe: `churn de ${r.churn30d.toLocaleString('pt-BR')}%` },
    { rotulo: 'Cobrança falhou', valor: String(r.cobrancaFalhou), detalhe: 'assinaturas pausadas' },
    { rotulo: 'Teste virou assinatura', valor: `${r.conversaoTrial.toLocaleString('pt-BR')}%`, detalhe: `${r.emTrial} em teste, ${r.trialExpiradoSemAssinar} perdidos` },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
      {cartoes.map((c) => (
        <div key={c.rotulo} className="rounded-xl border border-ink-700 bg-ink-800 p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{c.rotulo}</p>
          <p className={['mt-1.5 font-display text-2xl font-semibold', c.destaque ? 'text-tenant' : 'text-ink-100'].join(' ')}>{c.valor}</p>
          <p className="mt-0.5 text-xs text-ink-500">{c.detalhe}</p>
        </div>
      ))}
    </div>
  );
}
