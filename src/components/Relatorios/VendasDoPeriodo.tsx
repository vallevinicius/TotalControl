import { useEffect, useState } from 'react';
import { Paginacao } from '@/components/Common/Paginacao';
import { useTenant } from '@/contexts/TenantContext';
import { getVendasDoPeriodo } from '@/services/apiService';
import { formatarDataHora, formatarFormaPagamento, formatarMoeda } from '@/utils/formatters';
import type { PaginaResultado, VendaResumo } from '@/types';

interface VendasDoPeriodoProps {
  inicio: string;
  fim: string;
}

/** Lista de vendas do período com busca (cliente, vendedor ou código) e paginação feitas no servidor. */
export function VendasDoPeriodo({ inicio, fim }: VendasDoPeriodoProps) {
  const { tenant } = useTenant();
  const [busca, setBusca] = useState('');
  const [termo, setTermo] = useState('');
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<PaginaResultado<VendaResumo> | null>(null);
  const [erro, setErro] = useState(false);

  // Espera o usuário parar de digitar antes de consultar.
  useEffect(() => {
    const espera = setTimeout(() => {
      setTermo(busca.trim());
      setPagina(1);
    }, 350);
    return () => clearTimeout(espera);
  }, [busca]);

  useEffect(() => {
    let atual = true;
    setErro(false);
    getVendasDoPeriodo(inicio, fim, termo, pagina)
      .then((r) => atual && setDados(r))
      .catch(() => atual && setErro(true));
    return () => {
      atual = false;
    };
  }, [inicio, fim, termo, pagina]);

  useEffect(() => setPagina(1), [inicio, fim]);

  return (
    <div>
      <div className="nao-imprimir mb-3 flex flex-wrap items-center justify-between gap-3">
        <p className="font-display text-base font-semibold text-ink-100">Vendas do período</p>
        <input
          type="search"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
          placeholder="Buscar por cliente, vendedor ou código"
          aria-label="Buscar vendas"
          className="w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-tenant focus:outline-none sm:w-80"
        />
      </div>
      <div className="overflow-x-auto rounded-xl border border-ink-700">
        <table className="w-full min-w-[640px] text-left text-sm">
          <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
            <tr>
              <th className="px-5 py-3 font-medium">Data</th>
              <th className="px-5 py-3 font-medium">Cliente</th>
              <th className="px-5 py-3 font-medium">Vendedor</th>
              <th className="px-5 py-3 font-medium">Forma de pagamento</th>
              <th className="px-5 py-3 text-right font-medium">Itens</th>
              <th className="px-5 py-3 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-700 bg-ink-800/40">
            {erro ? (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-red-500">
                  Não foi possível carregar as vendas. Tente de novo.
                </td>
              </tr>
            ) : !dados ? (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-ink-400">Carregando…</td>
              </tr>
            ) : dados.itens.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-6 text-center text-ink-400">
                  {termo ? 'Nenhuma venda encontrada para essa busca.' : 'Nenhuma venda no período selecionado.'}
                </td>
              </tr>
            ) : (
              dados.itens.map((venda) => (
                <tr key={venda.id} className="transition-colors hover:bg-ink-800">
                  <td className="px-5 py-3.5 text-ink-300">{formatarDataHora(venda.timestamp, tenant)}</td>
                  <td className="px-5 py-3.5 text-ink-300">{venda.clienteNome ?? '-'}</td>
                  <td className="px-5 py-3.5 text-ink-300">{venda.vendedorNome ?? '-'}</td>
                  <td className="px-5 py-3.5 text-ink-300">{formatarFormaPagamento(venda.formaPagamento)}</td>
                  <td className="px-5 py-3.5 text-right text-ink-300">{venda.quantidadeItens}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-ink-100">{formatarMoeda(venda.valorTotal, tenant)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {dados && <Paginacao pagina={dados.pagina} totalPaginas={dados.totalPaginas} total={dados.total} aoMudarPagina={setPagina} />}
    </div>
  );
}
