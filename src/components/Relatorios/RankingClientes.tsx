import { useEffect, useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { getRankingClientes } from '@/services/apiService';
import { formatarData, formatarMoeda } from '@/utils/formatters';
import type { RankingClientes as Ranking } from '@/types';

interface RankingClientesProps {
  inicio: string;
  fim: string;
}

/** Quem mais comprou no período. Complemento do relatório: se falhar, a seção some. */
export function RankingClientes({ inicio, fim }: RankingClientesProps) {
  const { tenant } = useTenant();
  const [ranking, setRanking] = useState<Ranking | null>(null);

  useEffect(() => {
    let atual = true;
    getRankingClientes(inicio, fim)
      .then((r) => atual && setRanking(r))
      .catch(() => atual && setRanking(null));
    return () => {
      atual = false;
    };
  }, [inicio, fim]);

  if (!ranking) return null;
  const semCliente = ranking.semCliente;

  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
      <p className="font-display text-base font-semibold text-ink-100">Ranking de clientes</p>
      <p className="mb-4 mt-0.5 text-xs text-ink-500">Quem mais comprou no período, pelo valor total das compras.</p>
      {ranking.clientes.length === 0 ? (
        <p className="text-sm text-ink-400">Nenhuma venda com cliente identificado no período.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-700">
          <table className="w-full min-w-[520px] text-left text-sm">
            <thead className="bg-ink-900/40 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-5 py-3 font-medium">#</th>
                <th className="px-5 py-3 font-medium">Cliente</th>
                <th className="px-5 py-3 text-right font-medium">Compras</th>
                <th className="px-5 py-3 text-right font-medium">Ticket médio</th>
                <th className="px-5 py-3 text-right font-medium">Última compra</th>
                <th className="px-5 py-3 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700">
              {ranking.clientes.map((c, i) => (
                <tr key={c.clienteId}>
                  <td className="px-5 py-3 text-ink-400">{i + 1}</td>
                  <td className="px-5 py-3 text-ink-100">
                    {c.nome}
                    {c.telefone && <span className="ml-2 font-mono text-xs text-ink-500">{c.telefone}</span>}
                  </td>
                  <td className="px-5 py-3 text-right text-ink-300">{c.compras}</td>
                  <td className="px-5 py-3 text-right font-mono text-ink-300">{formatarMoeda(c.ticketMedio, tenant)}</td>
                  <td className="px-5 py-3 text-right text-ink-400">{c.ultimaCompra ? formatarData(c.ultimaCompra, tenant) : '-'}</td>
                  <td className="px-5 py-3 text-right font-mono text-ink-100">{formatarMoeda(c.total, tenant)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {semCliente.compras > 0 && (
        <p className="mt-3 text-xs text-ink-500">
          Além disso, {semCliente.compras} venda(s) sem cliente informado somaram {formatarMoeda(semCliente.total, tenant)}.
        </p>
      )}
    </div>
  );
}
