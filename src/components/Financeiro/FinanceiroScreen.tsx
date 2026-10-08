import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { useTenant } from '@/contexts/TenantContext';
import { getResumoFinanceiro, getLancamentos, getDre, getResumoContas } from '@/services/apiService';
import { formatarMoeda, formatarDataHora } from '@/utils/formatters';
import type { Dre, LancamentoFinanceiro, ResumoContas, ResumoFinanceiro } from '@/types';
import { FiltroPeriodo, hoje, inicioDoMesAtual } from './FiltroPeriodo';

function Cartao({ rotulo, valor, tom, destaque }: { rotulo: string; valor: string; tom?: 'verde' | 'vermelho'; destaque?: boolean }) {
  const cor = destaque ? 'text-tenant' : tom === 'verde' ? 'text-emerald-400' : tom === 'vermelho' ? 'text-red-400' : 'text-ink-100';
  return (
    <div className={['rounded-xl border p-5', destaque ? 'border-tenant bg-tenant-soft' : 'border-ink-700 bg-ink-800'].join(' ')}>
      <p className={['text-xs font-medium uppercase tracking-wide', destaque ? 'text-ink-300' : 'text-ink-400'].join(' ')}>{rotulo}</p>
      <p className={['mt-2 font-display text-xl font-semibold', cor].join(' ')}>{valor}</p>
    </div>
  );
}

function LinhaDre({ rotulo, valor, suave, forte, destaque }: { rotulo: string; valor: string; suave?: boolean; forte?: boolean; destaque?: 'verde' | 'vermelho' }) {
  const cor = destaque === 'verde' ? 'text-emerald-400' : destaque === 'vermelho' ? 'text-red-400' : suave ? 'text-ink-300' : 'text-ink-100';
  return (
    <div className={['flex items-center justify-between gap-4 px-5 py-2.5', forte ? 'bg-ink-700/30' : ''].join(' ')}>
      <dt className={[forte ? 'font-medium text-ink-100' : 'text-ink-300'].join(' ')}>{rotulo}</dt>
      <dd className={['font-mono', forte ? 'font-semibold' : '', cor].join(' ')}>{valor}</dd>
    </div>
  );
}

/** Financeiro > Visão geral: números do período e os últimos lançamentos. A
 * lista completa (e o formulário de novo lançamento) fica em "Lançamentos". */
export function FinanceiroScreen() {
  const { tenant } = useTenant();
  const [inicio, setInicio] = useState(inicioDoMesAtual());
  const [fim, setFim] = useState(hoje());
  const [resumo, setResumo] = useState<ResumoFinanceiro | null>(null);
  const [recentes, setRecentes] = useState<LancamentoFinanceiro[]>([]);
  const [dre, setDre] = useState<Dre | null>(null);
  const [contas, setContas] = useState<ResumoContas | null>(null);
  const [carregando, setCarregando] = useState(true);

  async function carregar() {
    setCarregando(true);
    const [resumoCarregado, lancamentos, dreCarregada, contasCarregadas] = await Promise.all([
      getResumoFinanceiro(inicio, fim),
      getLancamentos(inicio, fim),
      getDre(inicio, fim),
      getResumoContas(),
    ]);
    setResumo(resumoCarregado);
    setDre(dreCarregada);
    setContas(contasCarregadas);
    setRecentes(lancamentos.slice(0, 5));
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entradas = resumo ? resumo.receitaVendas + resumo.receitasAvulsas : 0;
  const saidas = resumo ? resumo.custoEstoque + resumo.despesasAvulsas : 0;
  const percentualEntradas = entradas + saidas > 0 ? (entradas / (entradas + saidas)) * 100 : 50;

  return (
    <AppLayout titulo="Financeiro" subtitulo="Visão geral do fluxo de caixa">
      <FiltroPeriodo inicio={inicio} fim={fim} onInicio={setInicio} onFim={setFim} onFiltrar={carregar} />

      {carregando || !resumo ? (
        <LoadingState mensagem="Calculando o financeiro…" />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Cartao rotulo="Receita de vendas" valor={formatarMoeda(resumo.receitaVendas, tenant)} tom="verde" />
            <Cartao rotulo="Custo de estoque" valor={formatarMoeda(resumo.custoEstoque, tenant)} tom="vermelho" />
            <Cartao rotulo="Receitas avulsas" valor={formatarMoeda(resumo.receitasAvulsas, tenant)} tom="verde" />
            <Cartao rotulo="Despesas avulsas" valor={formatarMoeda(resumo.despesasAvulsas, tenant)} tom="vermelho" />
            <Cartao rotulo="Saldo do período" valor={formatarMoeda(resumo.saldo, tenant)} destaque />
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-800 p-5">
            <div className="flex items-center justify-between text-sm">
              <p className="font-medium text-ink-100">Entradas x saídas</p>
              <p className="text-ink-400">
                {formatarMoeda(entradas, tenant)} entrou · {formatarMoeda(saidas, tenant)} saiu
              </p>
            </div>
            <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-red-500/40">
              <div className="h-full rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${percentualEntradas}%` }} />
            </div>
          </div>

          {contas && (contas.atrasadas.quantidade > 0 || contas.proximos7Dias.quantidade > 0) && (
            <Link to="/financeiro/contas" className={['flex flex-wrap items-center justify-between gap-2 rounded-xl border px-5 py-3.5 text-sm transition-colors', contas.atrasadas.quantidade > 0 ? 'border-red-500/30 bg-red-500/10 text-red-300 hover:bg-red-500/15' : 'border-amber-500/30 bg-amber-500/10 text-amber-300 hover:bg-amber-500/15'].join(' ')}>
              <span>
                {contas.atrasadas.quantidade > 0
                  ? `${contas.atrasadas.quantidade} conta(s) em atraso, somando ${formatarMoeda(contas.atrasadas.valor, tenant)}.`
                  : `${contas.proximos7Dias.quantidade} conta(s) vencem nos próximos 7 dias, somando ${formatarMoeda(contas.proximos7Dias.valor, tenant)}.`}
              </span>
              <span className="font-medium underline">Ver contas</span>
            </Link>
          )}

          {dre && (
            <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-800">
              <div className="border-b border-ink-700 px-5 py-3.5">
                <p className="font-display text-sm font-semibold text-ink-100">Resultado do período</p>
                <p className="text-xs text-ink-500">Custo das mercadorias estimado pelo preço de custo atual de cada produto.</p>
              </div>
              <dl className="divide-y divide-ink-700 text-sm">
                <LinhaDre rotulo="Vendas (valor cheio)" valor={formatarMoeda(dre.vendasBrutas, tenant)} />
                <LinhaDre rotulo="(-) Descontos dados" valor={`-${formatarMoeda(dre.descontos, tenant)}`} suave />
                <LinhaDre rotulo="(+) Taxas cobradas no cartão" valor={formatarMoeda(dre.taxasCobradas, tenant)} suave />
                <LinhaDre rotulo="= Receita de vendas" valor={formatarMoeda(dre.receitaDeVendas, tenant)} forte />
                <LinhaDre rotulo="(-) Custo das mercadorias vendidas" valor={`-${formatarMoeda(dre.custoMercadorias, tenant)}`} suave />
                <LinhaDre rotulo={`= Lucro bruto (margem ${dre.margemBruta.toLocaleString('pt-BR')}%)`} valor={formatarMoeda(dre.lucroBruto, tenant)} forte />
                {dre.despesas.map((d) => (
                  <LinhaDre key={`d-${d.categoria}`} rotulo={`(-) ${d.categoria}`} valor={`-${formatarMoeda(d.valor, tenant)}`} suave />
                ))}
                {dre.outrasReceitas.map((d) => (
                  <LinhaDre key={`r-${d.categoria}`} rotulo={`(+) ${d.categoria}`} valor={formatarMoeda(d.valor, tenant)} suave />
                ))}
                <LinhaDre rotulo="= Resultado do período" valor={formatarMoeda(dre.resultado, tenant)} forte destaque={dre.resultado >= 0 ? 'verde' : 'vermelho'} />
              </dl>
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-ink-700 bg-ink-800/40">
            <div className="flex items-center justify-between border-b border-ink-700 bg-ink-800 px-5 py-3.5">
              <p className="font-display text-sm font-semibold text-ink-100">Últimos lançamentos</p>
              <Link to="/financeiro/lancamentos" className="text-xs font-medium text-tenant hover:underline">
                Ver todos
              </Link>
            </div>
            {recentes.length === 0 ? (
              <p className="px-5 py-6 text-center text-sm text-ink-400">Nenhum lançamento avulso no período selecionado.</p>
            ) : (
              <ul className="divide-y divide-ink-700">
                {recentes.map((l) => (
                  <li key={l.id} className="flex items-center justify-between gap-4 px-5 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="truncate text-ink-100">{l.categoria}</p>
                      <p className="text-xs text-ink-500">{formatarDataHora(l.data, tenant)}</p>
                    </div>
                    <p className={['font-mono', l.tipo === 'RECEITA' ? 'text-emerald-400' : 'text-red-400'].join(' ')}>
                      {l.tipo === 'RECEITA' ? '+' : '-'} {formatarMoeda(l.valor, tenant)}
                    </p>
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
