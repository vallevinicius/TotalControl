import { useEffect, useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { getLucroDoDashboard } from '@/services/apiService';
import { formatarMoeda } from '@/utils/formatters';
import type { ResumoDeLucro, ResumoDoPeriodo } from '@/types';

function CartaoLucro({ rotulo, dados }: { rotulo: string; dados: ResumoDoPeriodo }) {
  const { tenant } = useTenant();
  const margem = dados.faturamento > 0 ? Math.round((dados.lucro / dados.faturamento) * 100) : null;
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{rotulo}</p>
      <p className={['mt-2 font-display text-3xl font-semibold', dados.lucro < 0 ? 'text-red-500' : 'text-tenant'].join(' ')}>
        {formatarMoeda(dados.lucro, tenant)}
      </p>
      <p className="mt-2 text-xs text-ink-500">
        Vendeu {formatarMoeda(dados.faturamento, tenant)} em {dados.vendas} venda(s)
        {margem !== null && ` · margem ${margem}%`}
      </p>
    </div>
  );
}

/** Lucro de hoje, da semana e do mês. É um complemento: se a consulta falhar (ou o usuário
 * não tiver acesso), some em vez de derrubar o painel. */
export function LucroCards() {
  const { tenant } = useTenant();
  const [lucro, setLucro] = useState<ResumoDeLucro | null>(null);

  useEffect(() => {
    if (!tenant) return;
    getLucroDoDashboard().then(setLucro).catch(() => setLucro(null));
  }, [tenant]);

  if (!lucro) return null;
  return (
    <section aria-label="Lucro">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <CartaoLucro rotulo="Lucro de hoje" dados={lucro.hoje} />
        <CartaoLucro rotulo="Lucro da semana" dados={lucro.semana} />
        <CartaoLucro rotulo="Lucro do mês" dados={lucro.mes} />
      </div>
      <p className="mt-2 text-xs text-ink-500">
        Lucro = vendas menos o custo dos produtos vendidos (não desconta despesas). A semana começa na segunda-feira.
      </p>
    </section>
  );
}
