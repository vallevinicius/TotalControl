import { ModalFundo } from '@/components/Admin/AdminModais';
import { useTenant } from '@/contexts/TenantContext';
import { formatarMoeda } from '@/utils/formatters';
import type { VendaEmEspera } from './emEspera';

const totalDe = (v: VendaEmEspera) => v.itens.reduce((a, i) => a + i.precoUnitario * i.quantidade, 0) * (1 - v.descontoPercentual / 100);

/** Vendas guardadas: retomar uma (volta para o carrinho) ou descartar. */
export function VendasEmEsperaModal({ vendas, aoRetomar, aoDescartar, aoFechar }: { vendas: VendaEmEspera[]; aoRetomar: (v: VendaEmEspera) => void; aoDescartar: (v: VendaEmEspera) => void; aoFechar: () => void }) {
  const { tenant } = useTenant();
  return (
    <ModalFundo onFechar={aoFechar}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-ink-700 bg-ink-800">
        <div className="border-b border-ink-700 px-6 py-4">
          <p className="font-display text-lg font-semibold text-ink-100">Vendas em espera</p>
          <p className="text-sm text-ink-400">Ficam guardadas neste computador até o caixa ser fechado (no máximo 24 horas).</p>
        </div>
        <ul className="flex-1 divide-y divide-ink-700 overflow-y-auto px-6">
          {vendas.length === 0 && <li className="py-8 text-center text-sm text-ink-500">Nenhuma venda em espera.</li>}
          {vendas.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium text-ink-100">{v.rotulo}</p>
                <p className="text-xs text-ink-500">
                  {v.itens.reduce((a, i) => a + i.quantidade, 0)} item(ns) · {formatarMoeda(totalDe(v), tenant)} · guardada às {new Date(v.criadaEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                <button onClick={() => aoRetomar(v)} className="rounded-lg bg-tenant px-3 py-1.5 text-xs font-semibold text-tenant-foreground hover:opacity-90">
                  Retomar
                </button>
                <button onClick={() => aoDescartar(v)} className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-300 hover:border-red-400 hover:text-red-400">
                  Descartar
                </button>
              </div>
            </li>
          ))}
        </ul>
        <div className="flex justify-end border-t border-ink-700 px-6 py-3">
          <button onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
            Fechar
          </button>
        </div>
      </div>
    </ModalFundo>
  );
}
