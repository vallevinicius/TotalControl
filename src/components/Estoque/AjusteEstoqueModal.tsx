import { useState, type FormEvent } from 'react';
import { ModalFundo } from '@/components/Admin/AdminModais';
import type { Produto } from '@/types';

/** Ajuste de inventário: informa a quantidade REAL contada e o motivo. A diferença
 * vira uma linha no histórico do produto e na auditoria. */
export function AjusteEstoqueModal({ produto, aoFechar, aoConfirmar }: { produto: Produto; aoFechar: () => void; aoConfirmar: (novaQuantidade: number, motivo: string) => Promise<void> }) {
  const [quantidade, setQuantidade] = useState<string>(String(produto.quantidadeEmEstoque));
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const nova = Number(quantidade);
  const valida = quantidade !== '' && Number.isInteger(nova) && nova >= 0;
  const diferenca = valida ? nova - produto.quantidadeEmEstoque : 0;
  const campo = 'mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none';

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (!valida || diferenca === 0 || motivo.trim().length < 3) return;
    setEnviando(true);
    try {
      await aoConfirmar(nova, motivo.trim());
      aoFechar();
    } catch {
      // O erro já foi mostrado por quem chamou; o modal fica aberto pra tentar de novo.
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalFundo onFechar={aoFechar}>
      <form onSubmit={enviar} className="w-full max-w-sm rounded-xl border border-ink-700 bg-ink-800 p-6">
        <p className="font-display text-lg font-semibold text-ink-100">Ajustar estoque</p>
        <p className="mt-1 text-sm text-ink-400">{produto.nome}</p>
        <p className="mt-3 text-sm text-ink-300">
          No sistema: <span className="font-mono text-ink-100">{produto.quantidadeEmEstoque}</span>
        </p>
        <label className="mt-3 block text-sm text-ink-300">
          Quantidade contada
          <input autoFocus type="number" min={0} step={1} value={quantidade} onChange={(e) => setQuantidade(e.target.value)} className={campo} />
        </label>
        {valida && diferenca !== 0 && (
          <p className={['mt-2 text-sm font-medium', diferenca > 0 ? 'text-emerald-400' : 'text-red-400'].join(' ')}>
            {diferenca > 0 ? `Sobra de ${diferenca} un.` : `Falta de ${-diferenca} un.`}
          </p>
        )}
        <label className="mt-3 block text-sm text-ink-300">
          Motivo
          <input required minLength={3} maxLength={191} placeholder="Contagem do inventário, quebra, perda…" value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campo} />
        </label>
        <p className="mt-2 text-[11px] text-ink-500">Fica registrado no histórico do produto e na auditoria.</p>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
            Cancelar
          </button>
          <button type="submit" disabled={enviando || !valida || diferenca === 0 || motivo.trim().length < 3} className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
            {enviando ? 'Salvando…' : 'Confirmar ajuste'}
          </button>
        </div>
      </form>
    </ModalFundo>
  );
}
