import { useState, type FormEvent } from 'react';
import { ModalFundo } from '@/components/Admin/AdminModais';
import { useTenant } from '@/contexts/TenantContext';
import { formatarMoeda } from '@/utils/formatters';
import type { VendaResumo } from '@/types';

/** Cancelamento de uma venda do turno: pede o motivo, que fica registrado junto com quem cancelou. */
export function CancelarVendaModal({ venda, aoFechar, aoConfirmar }: { venda: VendaResumo; aoFechar: () => void; aoConfirmar: (motivo: string) => Promise<void> }) {
  const { tenant } = useTenant();
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (motivo.trim().length < 3) return;
    setEnviando(true);
    try {
      await aoConfirmar(motivo.trim());
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
        <p className="font-display text-lg font-semibold text-ink-100">Cancelar esta venda?</p>
        <p className="mt-1 text-sm text-ink-400">
          Venda de <span className="font-mono text-ink-200">{formatarMoeda(venda.valorTotal, tenant)}</span> às {new Date(venda.timestamp).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}. Os produtos voltam ao estoque e ela deixa de contar nos totais. O registro fica guardado.
        </p>
        <label className="mt-4 block text-sm text-ink-300">
          Motivo do cancelamento
          <input autoFocus required minLength={3} maxLength={191} placeholder="Cliente desistiu, erro de preço…" value={motivo} onChange={(e) => setMotivo(e.target.value)} className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-red-500 focus:outline-none" />
        </label>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
            Voltar
          </button>
          <button type="submit" disabled={enviando || motivo.trim().length < 3} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
            {enviando ? 'Cancelando…' : 'Cancelar venda'}
          </button>
        </div>
      </form>
    </ModalFundo>
  );
}
