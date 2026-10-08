import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import { encerrarSessao, getSessoesAtivas, type SessaoAtiva } from '@/services/apiService';

/** "Chrome em macOS" a partir do user-agent (só o suficiente para a pessoa reconhecer o aparelho). */
function descreverAparelho(ua?: string): string {
  if (!ua) return 'Aparelho desconhecido';
  const navegador = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Navegador';
  const sistema = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS' : /Mac OS/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return sistema ? `${navegador} em ${sistema}` : navegador;
}

/** Lista onde a conta está logada e deixa encerrar as sessões esquecidas (PC emprestado, aparelho perdido). */
export function SessoesAtivas() {
  const toast = useToast();
  const [sessoes, setSessoes] = useState<SessaoAtiva[] | null>(null);

  const carregar = useCallback(async () => {
    try {
      setSessoes(await getSessoesAtivas());
    } catch {
      setSessoes([]);
    }
  }, []);
  useEffect(() => {
    carregar();
  }, [carregar]);

  async function encerrar(id: string) {
    try {
      await encerrarSessao(id);
      toast.sucesso('Sessão encerrada.');
      await carregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao encerrar a sessão.');
    }
  }

  const outras = (sessoes ?? []).filter((s) => !s.atual);

  return (
    <div className="mt-6 rounded-xl border border-ink-700 bg-ink-800 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-base font-semibold text-ink-100">Onde você está logado</p>
          <p className="mt-0.5 text-xs text-ink-400">Se não reconhecer um aparelho, encerre a sessão e troque a senha.</p>
        </div>
        {outras.length > 0 && (
          <button onClick={() => encerrar('outras')} className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-red-400 hover:text-red-400">
            Encerrar todas as outras
          </button>
        )}
      </div>
      <ul className="mt-4 divide-y divide-ink-700">
        {(sessoes ?? []).map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
            <div className="min-w-0">
              <p className="truncate text-ink-100">
                {descreverAparelho(s.dispositivo)}
                {s.atual && <span className="ml-2 rounded-full bg-tenant/15 px-2 py-0.5 text-[10px] font-medium text-tenant">Este aparelho</span>}
              </p>
              <p className="text-xs text-ink-400">
                {s.ip ? `${s.ip}, ` : ''}entrou em {new Date(s.criadaEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </p>
            </div>
            {!s.atual && (
              <button onClick={() => encerrar(s.id)} className="shrink-0 text-xs text-ink-300 hover:text-red-400">
                Encerrar
              </button>
            )}
          </li>
        ))}
        {sessoes === null && <li className="py-3 text-sm text-ink-400">Carregando…</li>}
      </ul>
    </div>
  );
}
