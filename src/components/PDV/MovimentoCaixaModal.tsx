import { useState, type FormEvent } from 'react';
import { ModalFundo } from '@/components/Admin/AdminModais';
import { useTenant } from '@/contexts/TenantContext';
import { formatarMoeda } from '@/utils/formatters';

/** Sangria (retirar dinheiro da gaveta: levar ao cofre, pagar fornecedor) ou suprimento (colocar troco). */
export function MovimentoCaixaModal({ tipo, esperadoNaGaveta, aoFechar, aoConfirmar }: { tipo: 'SANGRIA' | 'SUPRIMENTO'; esperadoNaGaveta: number; aoFechar: () => void; aoConfirmar: (valor: number, motivo: string) => Promise<void> }) {
  const { tenant } = useTenant();
  const [valor, setValor] = useState(0);
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const sangria = tipo === 'SANGRIA';
  const passou = sangria && valor > esperadoNaGaveta + 0.004;
  const campo = 'mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none';

  async function enviar(e: FormEvent) {
    e.preventDefault();
    if (valor <= 0 || motivo.trim().length < 3 || passou) return;
    setEnviando(true);
    try {
      await aoConfirmar(valor, motivo.trim());
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
        <p className="font-display text-lg font-semibold text-ink-100">{sangria ? 'Sangria' : 'Suprimento'}</p>
        <p className="mt-1 text-sm text-ink-400">
          {sangria ? 'Dinheiro que sai da gaveta durante o turno.' : 'Dinheiro que entra na gaveta (por exemplo, troco).'} Hoje deveria haver{' '}
          <span className="font-mono text-ink-200">{formatarMoeda(esperadoNaGaveta, tenant)}</span> em dinheiro.
        </p>
        <label className="mt-4 block text-sm text-ink-300">
          Valor
          <input autoFocus type="number" min={0.01} step={0.01} value={valor === 0 ? '' : valor} onChange={(e) => setValor(Number(e.target.value) || 0)} className={campo} />
        </label>
        {passou && <p className="mt-1 text-xs text-red-400">A sangria não pode passar do dinheiro que há na gaveta.</p>}
        <label className="mt-3 block text-sm text-ink-300">
          Motivo
          <input required minLength={3} maxLength={191} placeholder={sangria ? 'Levado ao cofre, pagamento de fornecedor…' : 'Troco para o caixa…'} value={motivo} onChange={(e) => setMotivo(e.target.value)} className={campo} />
        </label>
        <div className="mt-5 flex justify-end gap-3">
          <button type="button" onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
            Cancelar
          </button>
          <button type="submit" disabled={enviando || valor <= 0 || motivo.trim().length < 3 || passou} className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
            {enviando ? 'Registrando…' : `Registrar ${sangria ? 'sangria' : 'suprimento'}`}
          </button>
        </div>
      </form>
    </ModalFundo>
  );
}
