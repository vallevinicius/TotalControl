import { useEffect, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { getLojasDestino, transferirEstoque } from '@/services/apiService';
import type { Produto } from '@/types';

const CAMPO = 'mt-1 w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none';

interface Props {
  produto: Produto;
  aoFechar: () => void;
  aoConcluir: () => void;
}

/** Manda parte do saldo deste produto para outra loja da mesma empresa. */
export function TransferirEstoqueModal({ produto, aoFechar, aoConcluir }: Props) {
  const toast = useToast();
  const [lojas, setLojas] = useState<Array<{ id: string; nomeFantasia: string }> | null>(null);
  const [destino, setDestino] = useState('');
  const [quantidade, setQuantidade] = useState(1);
  const [observacao, setObservacao] = useState('');
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    getLojasDestino()
      .then((l) => {
        setLojas(l);
        setDestino(l[0]?.id ?? '');
      })
      .catch(() => setLojas([]));
  }, []);

  const invalido = !destino || quantidade < 1 || quantidade > produto.quantidadeEmEstoque;

  async function confirmar() {
    setEnviando(true);
    try {
      const r = await transferirEstoque({ destinoTenantId: destino, itens: [{ productId: produto.id, quantidade }], observacao: observacao.trim() || undefined });
      toast.sucesso(`${quantidade} un. de "${produto.nome}" enviadas para ${r.destino}.`);
      aoConcluir();
      aoFechar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao transferir.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-xl border border-ink-700 bg-ink-800 p-6">
        <p className="font-display text-lg font-semibold text-ink-100">Transferir para outra loja</p>
        <p className="mt-1 text-sm text-ink-400">
          {produto.nome} ({produto.quantidadeEmEstoque} em estoque)
        </p>

        {lojas && lojas.length === 0 ? (
          <p className="mt-5 text-sm text-ink-300">Você não tem acesso a nenhuma outra loja da empresa. Peça ao responsável para liberar em Lojas.</p>
        ) : (
          <div className="mt-5 space-y-4">
            <label className="block text-sm text-ink-300">
              Loja de destino
              <select value={destino} onChange={(e) => setDestino(e.target.value)} className={CAMPO}>
                {(lojas ?? []).map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nomeFantasia}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm text-ink-300">
              Quantidade
              <input type="number" min={1} max={produto.quantidadeEmEstoque} value={quantidade || ''} onChange={(e) => setQuantidade(Number(e.target.value) || 0)} className={CAMPO} />
            </label>
            <label className="block text-sm text-ink-300">
              Observação (opcional)
              <input value={observacao} onChange={(e) => setObservacao(e.target.value)} maxLength={191} className={CAMPO} />
            </label>
            <p className="text-[11px] text-ink-500">Se o produto ainda não existir na outra loja, ele é criado lá com os mesmos dados (o SKU liga os dois).</p>
          </div>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
            Cancelar
          </button>
          <button
            onClick={confirmar}
            disabled={enviando || invalido}
            className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando ? 'Enviando…' : 'Transferir'}
          </button>
        </div>
      </div>
    </div>
  );
}
