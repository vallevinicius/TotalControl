import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTenant } from '@/contexts/TenantContext';
import { getCaixaAtual, getDashboardResumo, getResumoContas } from '@/services/apiService';
import { diasRestantesTrial } from '@/utils/planos';

const HORAS_CAIXA_ABERTO_ALERTA = 8;

interface Notificacao {
  id: string;
  mensagem: string;
  rota: string;
  urgente?: boolean;
}

/** Central de notificações in-app: estoque baixo, caixa aberto há muito
 * tempo, trial acabando. Sem push/e-mail — só o que dá pra saber olhando os
 * próprios dados já carregados normalmente pelo app. */
export function NotificationBell() {
  const { tenant } = useTenant();
  const navigate = useNavigate();
  const [aberto, setAberto] = useState(false);
  const [notificacoes, setNotificacoes] = useState<Notificacao[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    async function carregar() {
      const lista: Notificacao[] = [];

      try {
        const resumo = await getDashboardResumo();
        if (resumo.produtosComEstoqueBaixo > 0) {
          lista.push({
            id: 'estoque-baixo',
            mensagem: `${resumo.produtosComEstoqueBaixo} produto(s) com estoque baixo`,
            rota: '/estoque',
          });
        }
      } catch {
        // tela pode estar bloqueada pelo plano/permissão — só não mostra o alerta
      }

      try {
        const caixa = await getCaixaAtual();
        if (caixa) {
          const horasAberto = (Date.now() - new Date(caixa.abertoEm).getTime()) / (1000 * 60 * 60);
          if (horasAberto >= HORAS_CAIXA_ABERTO_ALERTA) {
            lista.push({
              id: 'caixa-aberto',
              mensagem: `Caixa aberto há ${Math.floor(horasAberto)}h, não esqueça de fechar`,
              rota: '/pdv',
              urgente: true,
            });
          }
        }
      } catch {
        // idem
      }

      try {
        const contas = await getResumoContas();
        if (contas.atrasadas.quantidade > 0) {
          lista.push({ id: 'contas-atrasadas', mensagem: `${contas.atrasadas.quantidade} conta(s) em atraso`, rota: '/financeiro/contas', urgente: true });
        } else if (contas.proximos7Dias.quantidade > 0) {
          lista.push({ id: 'contas-proximas', mensagem: `${contas.proximos7Dias.quantidade} conta(s) vencem nos próximos 7 dias`, rota: '/financeiro/contas' });
        }
      } catch {
        // sem permissão no financeiro ou plano sem o módulo: não mostra
      }

      const dias = diasRestantesTrial(tenant?.trialExpiraEm);
      if (dias !== null && dias <= 3) {
        lista.push({
          id: 'trial',
          mensagem: dias > 0 ? `Seu teste grátis acaba em ${dias} dia(s)` : 'Seu teste grátis expirou',
          rota: '/plano',
          urgente: true,
        });
      }

      setNotificacoes(lista);
    }
    carregar();
  }, [tenant?.trialExpiraEm]);

  useEffect(() => {
    function aoClicarFora(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setAberto(false);
    }
    document.addEventListener('mousedown', aoClicarFora);
    return () => document.removeEventListener('mousedown', aoClicarFora);
  }, []);

  return (
    <div className="relative" ref={containerRef}>
      <button
        onClick={() => setAberto((atual) => !atual)}
        aria-label="Notificações"
        className="relative flex h-9 w-9 items-center justify-center rounded-lg border border-ink-600 text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100"
      >
        <span aria-hidden className="text-base leading-none">
          ◑
        </span>
        {notificacoes.length > 0 && (
          <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
            {notificacoes.length}
          </span>
        )}
      </button>

      {aberto && (
        <div className="absolute right-0 top-11 z-30 w-72 rounded-xl border border-ink-700 bg-ink-800 p-2 shadow-xl">
          {notificacoes.length === 0 ? (
            <p className="px-3 py-4 text-center text-sm text-ink-400">Nenhuma notificação por aqui.</p>
          ) : (
            notificacoes.map((n) => (
              <button
                key={n.id}
                onClick={() => {
                  setAberto(false);
                  navigate(n.rota);
                }}
                className="flex w-full items-start gap-2 rounded-lg px-3 py-2.5 text-left text-sm hover:bg-ink-700"
              >
                <span aria-hidden className={n.urgente ? 'mt-1 text-amber-400' : 'mt-1 text-tenant'}>
                  ●
                </span>
                <span className="text-ink-200">{n.mensagem}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
