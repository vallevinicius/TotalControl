import { useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { formatarMoeda, formatarFormaPagamento } from '@/utils/formatters';
import type { Caixa } from '@/types';

const SEM_SPINNER_NATIVO =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

interface FecharCaixaModalProps {
  caixa: Caixa;
  aoFechar: () => void;
  aoConfirmar: (valorContado?: number, observacao?: string) => Promise<void>;
}

export function FecharCaixaModal({ caixa, aoFechar, aoConfirmar }: FecharCaixaModalProps) {
  const { tenant } = useTenant();
  const [valorContado, setValorContado] = useState<number>(0);
  const [informarContagem, setInformarContagem] = useState(false);
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);

  // O servidor já considera vendas em dinheiro, suprimentos e sangrias.
  const valorEsperado = caixa.resumo.valorEsperadoEmDinheiro ?? Number((caixa.valorAbertura + (caixa.resumo.totaisPorFormaPagamento?.DINHEIRO ?? 0)).toFixed(2));
  const diferenca = informarContagem ? Number((valorContado - valorEsperado).toFixed(2)) : 0;

  async function handleConfirmar() {
    setEnviando(true);
    try {
      await aoConfirmar(informarContagem ? valorContado : undefined, observacao || undefined);
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-800 p-6">
        <p className="font-display text-lg font-semibold text-ink-100">Fechar caixa</p>
        <p className="mt-1 text-sm text-ink-400">
          Aberto às {new Date(caixa.abertoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} por{' '}
          {caixa.abertoPorNome}.
        </p>

        <div className="mt-4 space-y-2 rounded-lg border border-ink-700 bg-ink-900/40 p-4 text-sm">
          <div className="flex justify-between text-ink-300">
            <span>Valor de abertura</span>
            <span className="font-mono">{formatarMoeda(caixa.valorAbertura, tenant)}</span>
          </div>
          <div className="flex justify-between text-ink-300">
            <span>Vendas no turno ({caixa.resumo.quantidadeVendas})</span>
            <span className="font-mono">{formatarMoeda(caixa.resumo.totalVendido, tenant)}</span>
          </div>
          {caixa.resumo.totaisPorFormaPagamento &&
            Object.entries(caixa.resumo.totaisPorFormaPagamento).map(([forma, valor]) => (
              <div key={forma} className="flex justify-between pl-3 text-xs text-ink-500">
                <span>{formatarFormaPagamento(forma)}</span>
                <span className="font-mono">{formatarMoeda(valor, tenant)}</span>
              </div>
            ))}
          {(caixa.resumo.totalSuprimentos ?? 0) > 0 && (
            <div className="flex justify-between text-ink-300">
              <span>(+) Suprimentos</span>
              <span className="font-mono">{formatarMoeda(caixa.resumo.totalSuprimentos ?? 0, tenant)}</span>
            </div>
          )}
          {(caixa.resumo.totalSangrias ?? 0) > 0 && (
            <div className="flex justify-between text-ink-300">
              <span>(-) Sangrias</span>
              <span className="font-mono">-{formatarMoeda(caixa.resumo.totalSangrias ?? 0, tenant)}</span>
            </div>
          )}
          <div className="my-1 border-t border-ink-700" />
          <div className="flex justify-between font-medium text-ink-100">
            <span>Esperado em dinheiro no caixa</span>
            <span className="font-mono">{formatarMoeda(valorEsperado, tenant)}</span>
          </div>
        </div>

        <label className="mt-4 flex items-center gap-2 text-sm text-ink-300">
          <input
            type="checkbox"
            checked={informarContagem}
            onChange={(e) => setInformarContagem(e.target.checked)}
            className="accent-tenant"
          />
          Informar contagem do dinheiro
        </label>

        {informarContagem && (
          <div className="mt-2">
            <div className="flex items-center rounded-lg border border-ink-600 bg-ink-700 px-3 py-2">
              <span className="text-ink-400">R$</span>
              <input
                autoFocus
                type="number"
                min={0}
                step={0.01}
                value={valorContado === 0 ? '' : valorContado}
                onChange={(e) => setValorContado(Number(e.target.value) || 0)}
                className={['ml-2 w-full bg-transparent text-right font-mono text-ink-100 outline-none', SEM_SPINNER_NATIVO].join(' ')}
              />
            </div>
            {valorContado > 0 && diferenca !== 0 && (
              <p className={['mt-1 text-xs', diferenca < 0 ? 'text-red-400' : 'text-emerald-400'].join(' ')}>
                {diferenca < 0 ? 'Faltam' : 'Sobram'} {formatarMoeda(Math.abs(diferenca), tenant)} em relação ao esperado.
              </p>
            )}
          </div>
        )}

        <label className="mt-4 block text-sm text-ink-300">
          Observação (opcional)
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
          />
        </label>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
            Cancelar
          </button>
          <button
            onClick={handleConfirmar}
            disabled={enviando}
            className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando ? 'Fechando…' : 'Fechar caixa'}
          </button>
        </div>
      </div>
    </div>
  );
}
