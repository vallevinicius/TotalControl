import { formatarMoeda } from '@/utils/formatters';
import type { VendaNaFila } from '@/lib/offline';
import type { Tenant } from '@/types';

interface Props {
  online: boolean;
  fila: VendaNaFila[];
  tenant: Tenant | null;
  sincronizando: boolean;
  aoEnviar: () => void;
  aoTentarDeNovo: (idLocal: string) => void;
  aoDescartar: (venda: VendaNaFila) => void;
}

/** Avisa que o caixa está sem internet e mostra as vendas guardadas aguardando envio (ou recusadas). */
export function OfflineBanner({ online, fila, tenant, sincronizando, aoEnviar, aoTentarDeNovo, aoDescartar }: Props) {
  const pendentes = fila.filter((v) => !v.erro);
  const recusadas = fila.filter((v) => v.erro);
  if (online && fila.length === 0) return null;

  const totalPendente = pendentes.reduce((s, v) => s + v.total, 0);

  return (
    <div className="mb-4 space-y-2">
      {!online && (
        <div role="status" className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-ink-100">
          <p className="font-medium">Sem conexão com a internet</p>
          <p className="mt-0.5 text-xs text-ink-300">
            Pode continuar vendendo. As vendas ficam guardadas neste aparelho e são enviadas sozinhas quando a internet voltar. Fechar o caixa, cancelar venda e sangria precisam de conexão.
          </p>
        </div>
      )}

      {pendentes.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-800 px-4 py-3 text-sm">
          <p className="text-ink-200">
            <span className="font-medium">{pendentes.length}</span> venda(s) aguardando envio
            <span className="ml-1 text-ink-400">({formatarMoeda(totalPendente, tenant)})</span>
          </p>
          <button
            onClick={aoEnviar}
            disabled={!online || sincronizando}
            className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant disabled:cursor-not-allowed disabled:opacity-40"
          >
            {sincronizando ? 'Enviando…' : 'Enviar agora'}
          </button>
        </div>
      )}

      {recusadas.map((v) => (
        <div key={v.idLocal} className="rounded-xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          <p className="font-medium text-red-500">
            Venda de {formatarMoeda(v.total, tenant)} não foi aceita ({new Date(v.criadoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })})
          </p>
          <p className="mt-0.5 text-xs text-ink-300">{v.erro}</p>
          <p className="mt-0.5 text-xs text-ink-400">{v.resumo}</p>
          <div className="mt-2 flex gap-2">
            <button onClick={() => aoTentarDeNovo(v.idLocal)} disabled={!online} className="rounded-lg border border-red-400/40 px-3 py-1 text-xs text-ink-100 hover:bg-red-500/10 disabled:opacity-40">
              Tentar de novo
            </button>
            <button onClick={() => aoDescartar(v)} className="rounded-lg px-3 py-1 text-xs text-red-500 hover:underline">
              Descartar
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
