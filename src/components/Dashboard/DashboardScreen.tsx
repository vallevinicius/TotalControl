import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { useTenant } from '@/contexts/TenantContext';
import { getDashboardResumo, getSerieDoDashboard } from '@/services/apiService';
import { GraficoBarras } from '@/components/Common/GraficoBarras';
import { formatarMoeda } from '@/utils/formatters';
import { OnboardingChecklist } from './OnboardingChecklist';
import type { PontoDeVendas, ResumoDashboard } from '@/types';

interface CartaoMetricaProps {
  rotulo: string;
  valor: string;
  destaque?: boolean;
}

function CartaoMetrica({ rotulo, valor, destaque }: CartaoMetricaProps) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{rotulo}</p>
      <p className={['mt-2 font-display text-3xl font-semibold', destaque ? 'text-tenant' : 'text-ink-100'].join(' ')}>
        {valor}
      </p>
    </div>
  );
}

export function DashboardScreen() {
  const { tenant } = useTenant();
  const [resumo, setResumo] = useState<ResumoDashboard | null>(null);
  const [serie, setSerie] = useState<PontoDeVendas[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    if (!tenant) return;
    setCarregando(true);
    getDashboardResumo().then((dados) => {
      setResumo(dados);
      setCarregando(false);
    });
    // O gráfico é um complemento: se falhar, o painel continua inteiro.
    getSerieDoDashboard(14).then(setSerie).catch(() => setSerie([]));
  }, [tenant]);

  return (
    <AppLayout titulo="Visão Geral" subtitulo="Resumo das operações de hoje">
      {carregando || !resumo ? (
        <LoadingState mensagem="Calculando indicadores…" />
      ) : (
        <div className="space-y-6">
          <OnboardingChecklist />

          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <CartaoMetrica rotulo="Faturamento do dia" valor={formatarMoeda(resumo.faturamentoDoDia, tenant)} destaque />
            <CartaoMetrica rotulo="Vendas do dia" valor={String(resumo.quantidadeVendasDoDia)} />
            <CartaoMetrica rotulo="Ticket médio" valor={formatarMoeda(resumo.ticketMedio, tenant)} />
            <CartaoMetrica rotulo="Produtos com estoque baixo" valor={String(resumo.produtosComEstoqueBaixo)} />
          </div>

          {serie.length > 0 && (
            <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
              <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-display text-base font-semibold text-ink-100">Vendas dos últimos 14 dias</p>
                <p className="text-xs text-ink-500">
                  Total: <span className="font-mono text-ink-300">{formatarMoeda(serie.reduce((a, p) => a + p.faturamento, 0), tenant)}</span>
                </p>
              </div>
              <GraficoBarras
                pontos={serie.map((p) => ({
                  rotulo: p.data.slice(8, 10) + '/' + p.data.slice(5, 7),
                  valor: p.faturamento,
                  descricao: `${p.data.slice(8, 10)}/${p.data.slice(5, 7)}: ${formatarMoeda(p.faturamento, tenant)} em ${p.vendas} venda(s)`,
                }))}
              />
            </div>
          )}

          <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
            <p className="mb-4 font-display text-base font-semibold text-ink-100">Produtos mais vendidos hoje</p>
            {resumo.produtosMaisVendidos.length === 0 ? (
              <p className="text-sm text-ink-400">Nenhuma venda registrada hoje ainda.</p>
            ) : (
              <ul className="divide-y divide-ink-700">
                {resumo.produtosMaisVendidos.map((produto, indice) => (
                  <li key={produto.productId} className="flex items-center justify-between py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-tenant-soft text-xs font-semibold text-tenant">
                        {indice + 1}
                      </span>
                      <span className="text-sm text-ink-100">{produto.nome}</span>
                    </div>
                    <div className="flex items-center gap-6 text-sm">
                      <span className="text-ink-400">{produto.quantidadeVendida} un.</span>
                      <span className="w-24 text-right font-mono text-ink-100">
                        {formatarMoeda(produto.receitaGerada, tenant)}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </AppLayout>
  );
}
