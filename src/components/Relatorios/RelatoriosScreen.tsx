import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { useTenant } from '@/contexts/TenantContext';
import { getRelatorioVendas, getRelatorioConsolidado, getSerieDiaria, getCurvaAbc, getEstoqueParado } from '@/services/apiService';
import { GraficoBarras } from '@/components/Common/GraficoBarras';
import { imprimir } from '@/utils/imprimir';
import { formatarMoeda, formatarDataHora, formatarFormaPagamento } from '@/utils/formatters';
import { baixarCsv } from '@/utils/csv';
import { planoPermiteMultiLoja } from '@/utils/planos';
import type { CurvaAbc, EstoqueParado, PontoDeVendas, RelatorioConsolidado, RelatorioVendas } from '@/types';

function inicioDoMesAtual(): string {
  const agora = new Date();
  return new Date(agora.getFullYear(), agora.getMonth(), 1).toISOString().slice(0, 10);
}

function hoje(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Desloca um período pra trás pela própria duração dele — usado pra
 * comparar "esse período" com "o mesmo tanto de dias, imediatamente antes". */
function periodoAnterior(inicio: string, fim: string): { inicio: string; fim: string } {
  const dataInicio = new Date(inicio);
  const dataFim = new Date(fim);
  const duracaoDias = Math.max(1, Math.round((dataFim.getTime() - dataInicio.getTime()) / (1000 * 60 * 60 * 24)) + 1);

  const novoFim = new Date(dataInicio);
  novoFim.setDate(novoFim.getDate() - 1);
  const novoInicio = new Date(novoFim);
  novoInicio.setDate(novoInicio.getDate() - duracaoDias + 1);

  return { inicio: novoInicio.toISOString().slice(0, 10), fim: novoFim.toISOString().slice(0, 10) };
}

function variacao(atual: number, anterior: number): string {
  if (anterior === 0) return atual > 0 ? '+100%' : '0%';
  const percentual = Math.round(((atual - anterior) / anterior) * 100);
  return `${percentual > 0 ? '+' : ''}${percentual}%`;
}

export function RelatoriosScreen() {
  const { tenant } = useTenant();
  const [inicio, setInicio] = useState(inicioDoMesAtual());
  const [fim, setFim] = useState(hoje());
  const [relatorio, setRelatorio] = useState<RelatorioVendas | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [comparar, setComparar] = useState(false);
  const [relatorioAnterior, setRelatorioAnterior] = useState<RelatorioVendas | null>(null);
  const [consolidado, setConsolidado] = useState<RelatorioConsolidado | null>(null);
  const [serie, setSerie] = useState<PontoDeVendas[]>([]);
  const [abc, setAbc] = useState<CurvaAbc | null>(null);
  const [parado, setParado] = useState<EstoqueParado | null>(null);
  const [diasParado, setDiasParado] = useState(30);

  async function carregar() {
    setCarregando(true);
    const atual = await getRelatorioVendas(inicio, fim);
    setRelatorio(atual);

    if (comparar) {
      const anterior = periodoAnterior(inicio, fim);
      setRelatorioAnterior(await getRelatorioVendas(anterior.inicio, anterior.fim));
    } else {
      setRelatorioAnterior(null);
    }

    if (tenant && planoPermiteMultiLoja(tenant.planoAtual)) {
      setConsolidado(await getRelatorioConsolidado(inicio, fim));
    }

    // Análises extras: se alguma falhar, o relatório principal continua aparecendo.
    const [pontos, curva, encalhado] = await Promise.all([
      getSerieDiaria(inicio, fim).catch(() => []),
      getCurvaAbc(inicio, fim).catch(() => null),
      getEstoqueParado(diasParado).catch(() => null),
    ]);
    setSerie(pontos);
    setAbc(curva);
    setParado(encalhado);

    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleExportarCsv() {
    if (!relatorio) return;
    baixarCsv(
      `vendas_${inicio}_a_${fim}.csv`,
      ['Data', 'Cliente', 'Vendedor', 'Forma de pagamento', 'Itens', 'Total'],
      relatorio.vendas.map((v) => [
        formatarDataHora(v.timestamp, tenant),
        v.clienteNome ?? '',
        v.vendedorNome ?? '',
        formatarFormaPagamento(v.formaPagamento),
        v.quantidadeItens,
        v.valorTotal.toFixed(2),
      ]),
    );
  }

  return (
    <AppLayout titulo="Relatórios" subtitulo="Vendas por período">
      <div className="nao-imprimir mb-6 flex flex-wrap items-end gap-4 rounded-xl border border-ink-700 bg-ink-800 p-4">
        <label className="block text-sm text-ink-300">
          De
          <input
            type="date"
            value={inicio}
            onChange={(e) => setInicio(e.target.value)}
            className="mt-1 rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
          />
        </label>
        <label className="block text-sm text-ink-300">
          Até
          <input
            type="date"
            value={fim}
            onChange={(e) => setFim(e.target.value)}
            className="mt-1 rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-ink-300">
          <input
            type="checkbox"
            checked={comparar}
            onChange={(e) => setComparar(e.target.checked)}
            className="accent-tenant"
          />
          Comparar com período anterior
        </label>
        <button
          onClick={carregar}
          className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90"
        >
          Filtrar
        </button>
        <button
          onClick={handleExportarCsv}
          disabled={!relatorio || relatorio.vendas.length === 0}
          className="rounded-lg border border-ink-600 px-4 py-2 text-sm font-semibold text-ink-200 hover:border-tenant hover:text-tenant disabled:cursor-not-allowed disabled:opacity-40"
        >
          Exportar CSV
        </button>
        <button
          onClick={() => imprimir('relatorio')}
          disabled={!relatorio}
          className="rounded-lg border border-ink-600 px-4 py-2 text-sm font-semibold text-ink-200 hover:border-tenant hover:text-tenant disabled:cursor-not-allowed disabled:opacity-40"
        >
          Imprimir / salvar PDF
        </button>
      </div>

      {carregando || !relatorio ? (
        <LoadingState mensagem="Calculando relatório…" />
      ) : (
        <div className="area-relatorio space-y-6">
          <div className="hidden print:block">
            <p className="font-display text-xl font-bold">{tenant?.nomeFantasia}: relatório de vendas</p>
            <p className="text-sm">Período: {new Date(`${inicio}T00:00:00`).toLocaleDateString('pt-BR')} a {new Date(`${fim}T00:00:00`).toLocaleDateString('pt-BR')}</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Faturamento no período</p>
              <p className="mt-2 font-display text-2xl font-semibold text-tenant">
                {formatarMoeda(relatorio.faturamentoTotal, tenant)}
              </p>
              {relatorioAnterior && (
                <p className="mt-1 text-xs text-ink-500">
                  {variacao(relatorio.faturamentoTotal, relatorioAnterior.faturamentoTotal)} vs. período anterior
                </p>
              )}
            </div>
            <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Vendas</p>
              <p className="mt-2 font-display text-2xl font-semibold text-ink-100">{relatorio.quantidadeVendas}</p>
              {relatorioAnterior && (
                <p className="mt-1 text-xs text-ink-500">
                  {variacao(relatorio.quantidadeVendas, relatorioAnterior.quantidadeVendas)} vs. período anterior
                </p>
              )}
            </div>
            <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
              <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Ticket médio</p>
              <p className="mt-2 font-display text-2xl font-semibold text-ink-100">
                {formatarMoeda(relatorio.ticketMedio, tenant)}
              </p>
              {relatorioAnterior && (
                <p className="mt-1 text-xs text-ink-500">
                  {variacao(relatorio.ticketMedio, relatorioAnterior.ticketMedio)} vs. período anterior
                </p>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
            <p className="mb-4 font-display text-base font-semibold text-ink-100">Faturamento por dia</p>
            <GraficoBarras
              destacarUltimo={false}
              pontos={serie.map((p) => ({
                rotulo: p.data.slice(8, 10) + '/' + p.data.slice(5, 7),
                valor: p.faturamento,
                descricao: `${p.data.slice(8, 10)}/${p.data.slice(5, 7)}: ${formatarMoeda(p.faturamento, tenant)} em ${p.vendas} venda(s)`,
              }))}
            />
          </div>

          {consolidado && (
            <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
              <p className="mb-4 font-display text-base font-semibold text-ink-100">
                Consolidado de todas as lojas: {formatarMoeda(consolidado.faturamentoTotal, tenant)} (
                {consolidado.quantidadeVendasTotal} vendas)
              </p>
              <div className="overflow-hidden rounded-xl border border-ink-700">
                <table className="w-full text-left text-sm">
                  <thead className="bg-ink-900/40 text-xs uppercase tracking-wide text-ink-400">
                    <tr>
                      <th className="px-5 py-3 font-medium">Loja</th>
                      <th className="px-5 py-3 font-medium text-right">Vendas</th>
                      <th className="px-5 py-3 font-medium text-right">Faturamento</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-700">
                    {consolidado.lojas.map((l) => (
                      <tr key={l.tenantId}>
                        <td className="px-5 py-3.5 font-medium text-ink-100">{l.nomeFantasia}</td>
                        <td className="px-5 py-3.5 text-right text-ink-300">{l.quantidadeVendas}</td>
                        <td className="px-5 py-3.5 text-right font-mono text-ink-100">
                          {formatarMoeda(l.faturamento, tenant)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
              <p className="mb-4 font-display text-base font-semibold text-ink-100">Por forma de pagamento</p>
              {Object.keys(relatorio.totaisPorFormaPagamento).length === 0 ? (
                <p className="text-sm text-ink-400">Sem vendas no período.</p>
              ) : (
                <ul className="space-y-2">
                  {Object.entries(relatorio.totaisPorFormaPagamento).map(([forma, total]) => (
                    <li key={forma} className="flex justify-between text-sm">
                      <span className="text-ink-300">{formatarFormaPagamento(forma)}</span>
                      <span className="font-mono text-ink-100">{formatarMoeda(total, tenant)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
              <p className="mb-4 font-display text-base font-semibold text-ink-100">Produtos mais vendidos</p>
              {relatorio.produtosMaisVendidos.length === 0 ? (
                <p className="text-sm text-ink-400">Sem vendas no período.</p>
              ) : (
                <ul className="space-y-2">
                  {relatorio.produtosMaisVendidos.map((p) => (
                    <li key={p.productId} className="flex justify-between text-sm">
                      <span className="truncate text-ink-300">{p.nome}</span>
                      <span className="font-mono text-ink-100">{p.quantidadeVendida} un.</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
            <p className="mb-4 font-display text-base font-semibold text-ink-100">Vendas por vendedor</p>
            {relatorio.vendasPorVendedor.length === 0 ? (
              <p className="text-sm text-ink-400">Nenhuma venda com vendedor identificado no período.</p>
            ) : (
              <div className="overflow-hidden rounded-xl border border-ink-700">
                <table className="w-full text-left text-sm">
                  <thead className="bg-ink-900/40 text-xs uppercase tracking-wide text-ink-400">
                    <tr>
                      <th className="px-5 py-3 font-medium">Vendedor</th>
                      <th className="px-5 py-3 font-medium text-right">Vendas</th>
                      <th className="px-5 py-3 font-medium text-right">Total vendido</th>
                      <th className="px-5 py-3 font-medium text-right">Comissão</th>
                      <th className="px-5 py-3 font-medium text-right">A pagar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-700">
                    {relatorio.vendasPorVendedor.map((v) => (
                      <tr key={v.vendedorId} className="transition-colors hover:bg-ink-700/40">
                        <td className="px-5 py-3.5 font-medium text-ink-100">{v.nome}</td>
                        <td className="px-5 py-3.5 text-right text-ink-300">{v.quantidadeVendas}</td>
                        <td className="px-5 py-3.5 text-right font-mono text-ink-100">
                          {formatarMoeda(v.totalVendido, tenant)}
                        </td>
                        <td className="px-5 py-3.5 text-right text-ink-300">{v.comissaoPercentual}%</td>
                        <td className="px-5 py-3.5 text-right font-mono text-tenant">
                          {formatarMoeda(v.comissaoAPagar, tenant)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {abc && abc.itens.length > 0 && (
            <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
              <p className="font-display text-base font-semibold text-ink-100">Curva ABC de produtos</p>
              <p className="mb-4 mt-0.5 text-xs text-ink-500">
                A: os que somam até 80% do faturamento (sustentam a loja). B: até 95%. C: o resto, com pouco peso.
              </p>
              <div className="overflow-x-auto rounded-xl border border-ink-700">
                <table className="w-full min-w-[480px] text-left text-sm">
                  <thead className="bg-ink-900/40 text-xs uppercase tracking-wide text-ink-400">
                    <tr>
                      <th className="px-5 py-3 font-medium">Classe</th>
                      <th className="px-5 py-3 font-medium">Produto</th>
                      <th className="px-5 py-3 text-right font-medium">Faturamento</th>
                      <th className="px-5 py-3 text-right font-medium">% do total</th>
                      <th className="px-5 py-3 text-right font-medium">% acumulado</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-700">
                    {abc.itens.slice(0, 30).map((i) => (
                      <tr key={i.productId}>
                        <td className="px-5 py-3">
                          <span className={['rounded-full px-2.5 py-0.5 text-xs font-bold', i.classe === 'A' ? 'bg-emerald-500/15 text-emerald-500' : i.classe === 'B' ? 'bg-amber-500/15 text-amber-500' : 'bg-ink-700 text-ink-300'].join(' ')}>{i.classe}</span>
                        </td>
                        <td className="px-5 py-3 text-ink-100">{i.nome}</td>
                        <td className="px-5 py-3 text-right font-mono text-ink-100">{formatarMoeda(i.receita, tenant)}</td>
                        <td className="px-5 py-3 text-right text-ink-300">{i.participacao.toLocaleString('pt-BR')}%</td>
                        <td className="px-5 py-3 text-right text-ink-400">{i.acumulado.toLocaleString('pt-BR')}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {abc.itens.length > 30 && <p className="mt-2 text-xs text-ink-500">Mostrando os 30 primeiros de {abc.itens.length} produtos vendidos.</p>}
            </div>
          )}

          {parado && (
            <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="font-display text-base font-semibold text-ink-100">Estoque parado</p>
                  <p className="mt-0.5 text-xs text-ink-500">Produtos com saldo que não venderam nenhuma unidade nos últimos {parado.dias} dias.</p>
                </div>
                <div className="nao-imprimir flex items-center gap-2 text-sm text-ink-300">
                  Sem venda há
                  <select
                    value={diasParado}
                    onChange={async (e) => {
                      const dias = Number(e.target.value);
                      setDiasParado(dias);
                      setParado(await getEstoqueParado(dias).catch(() => null));
                    }}
                    className="rounded-lg border border-ink-600 bg-ink-700 px-2 py-1 text-sm text-ink-100 focus:border-tenant focus:outline-none"
                  >
                    {[15, 30, 60, 90, 180].map((d) => (
                      <option key={d} value={d}>{d} dias</option>
                    ))}
                  </select>
                </div>
              </div>
              {parado.itens.length === 0 ? (
                <p className="mt-4 text-sm text-emerald-500">Nenhum produto encalhado nesse prazo.</p>
              ) : (
                <>
                  <p className="mt-3 text-sm text-ink-300">
                    Dinheiro parado no estoque: <span className="font-mono font-semibold text-amber-500">{formatarMoeda(parado.valorTotal, tenant)}</span> ({parado.itens.length} produto(s), ao preço de custo)
                  </p>
                  <div className="mt-3 overflow-x-auto rounded-xl border border-ink-700">
                    <table className="w-full min-w-[420px] text-left text-sm">
                      <thead className="bg-ink-900/40 text-xs uppercase tracking-wide text-ink-400">
                        <tr>
                          <th className="px-5 py-3 font-medium">Produto</th>
                          <th className="px-5 py-3 text-right font-medium">Em estoque</th>
                          <th className="px-5 py-3 text-right font-medium">Valor parado</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-ink-700">
                        {parado.itens.slice(0, 30).map((i) => (
                          <tr key={i.productId}>
                            <td className="px-5 py-3 text-ink-100">{i.nome} <span className="font-mono text-xs text-ink-500">{i.sku}</span></td>
                            <td className="px-5 py-3 text-right font-mono text-ink-300">{i.quantidade}</td>
                            <td className="px-5 py-3 text-right font-mono text-ink-100">{formatarMoeda(i.valorParado, tenant)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-ink-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-5 py-3 font-medium">Data</th>
                  <th className="px-5 py-3 font-medium">Cliente</th>
                  <th className="px-5 py-3 font-medium">Vendedor</th>
                  <th className="px-5 py-3 font-medium">Forma de pagamento</th>
                  <th className="px-5 py-3 font-medium text-right">Itens</th>
                  <th className="px-5 py-3 font-medium text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700 bg-ink-800/40">
                {relatorio.vendas.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-ink-400">
                      Nenhuma venda no período selecionado.
                    </td>
                  </tr>
                ) : (
                  relatorio.vendas.map((venda) => (
                    <tr key={venda.id} className="transition-colors hover:bg-ink-800">
                      <td className="px-5 py-3.5 text-ink-300">{formatarDataHora(venda.timestamp, tenant)}</td>
                      <td className="px-5 py-3.5 text-ink-300">{venda.clienteNome ?? '-'}</td>
                      <td className="px-5 py-3.5 text-ink-300">{venda.vendedorNome ?? '-'}</td>
                      <td className="px-5 py-3.5 text-ink-300">{formatarFormaPagamento(venda.formaPagamento)}</td>
                      <td className="px-5 py-3.5 text-right text-ink-300">{venda.quantidadeItens}</td>
                      <td className="px-5 py-3.5 text-right font-mono text-ink-100">
                        {formatarMoeda(venda.valorTotal, tenant)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
