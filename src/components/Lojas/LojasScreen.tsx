import { useCallback, useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { definirLojaAtiva, listarLojas } from '@/services/apiService';
import { planoPermiteMultiLoja } from '@/utils/planos';
import { formatarMoeda } from '@/utils/formatters';
import { GraficoBarras } from '@/components/Common/GraficoBarras';
import type { LojaGestao } from '@/types';
import { LojaFormModal } from './LojaFormModal';
import { AcessosLojaModal } from './AcessosLojaModal';
import { ExcluirLojaModal } from './ExcluirLojaModal';

function Numero({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-lg bg-ink-700/40 px-3 py-2.5">
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{rotulo}</p>
      <p className="mt-0.5 font-display text-base font-semibold text-ink-100">{valor}</p>
    </div>
  );
}

function BotaoTexto({ children, onClick, perigo }: { children: string; onClick: () => void; perigo?: boolean }) {
  return (
    <button onClick={onClick} className={['rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors', perigo ? 'text-red-400 hover:bg-red-500/10' : 'text-ink-300 hover:bg-ink-700 hover:text-ink-100'].join(' ')}>
      {children}
    </button>
  );
}

function cidadeUf(l: LojaGestao): string {
  return [l.endereco.cidade, l.endereco.uf].filter(Boolean).join(' / ');
}

/** Gestão das lojas da empresa (plano com múltiplas lojas, só conta principal). */
export function LojasScreen() {
  const { tenant, usuarioAtual, trocarLoja, recarregarSessao } = useTenant();
  const toast = useToast();
  const confirmar = useConfirm();
  const [lojas, setLojas] = useState<LojaGestao[] | null>(null);
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<LojaGestao | null>(null);
  const [acessos, setAcessos] = useState<LojaGestao | null>(null);
  const [excluindo, setExcluindo] = useState<LojaGestao | null>(null);

  const permitido = Boolean(usuarioAtual?.raiz && tenant && planoPermiteMultiLoja(tenant.planoAtual));

  const carregar = useCallback(async () => {
    try {
      setLojas(await listarLojas());
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao carregar as lojas.');
      setLojas([]);
    }
  }, [toast]);

  useEffect(() => {
    if (permitido) carregar();
  }, [permitido, carregar]);

  if (tenant && usuarioAtual && !permitido) return <Navigate to="/" replace />;

  /** Recarrega a lista e o seletor de lojas da lateral. */
  async function depoisDeSalvar() {
    await Promise.all([carregar(), recarregarSessao()]);
  }

  async function alternarAtiva(loja: LojaGestao) {
    const desativar = loja.ativo;
    const ok = await confirmar({
      titulo: desativar ? `Desativar "${loja.nomeFantasia}"?` : `Reativar "${loja.nomeFantasia}"?`,
      descricao: desativar
        ? 'Ninguém consegue entrar nessa loja e ela some do seletor, mas nenhum dado é apagado. Você pode reativar quando quiser.'
        : 'A loja volta a ficar disponível para quem tem acesso.',
      textoConfirmar: desativar ? 'Desativar' : 'Reativar',
      perigoso: desativar,
    });
    if (!ok) return;
    try {
      await definirLojaAtiva(loja.id, !desativar);
      toast.sucesso(desativar ? 'Loja desativada.' : 'Loja reativada.');
      await depoisDeSalvar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao atualizar a loja.');
    }
  }

  async function entrar(loja: LojaGestao) {
    try {
      await trocarLoja(loja.id);
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao trocar de loja.');
    }
  }

  return (
    <AppLayout titulo="Lojas" subtitulo="Gerencie as lojas da sua empresa e quem acessa cada uma">
      <div className="mb-6 flex justify-end">
        <button onClick={() => setCriando(true)} className="rounded-lg bg-tenant px-4 py-2.5 text-sm font-semibold text-tenant-foreground hover:opacity-90">
          + Nova loja
        </button>
      </div>

      {!lojas ? (
        <LoadingState mensagem="Carregando lojas…" />
      ) : (
        <>
        {lojas.filter((l) => l.ativo).length > 1 && (
          <div className="mb-6 rounded-xl border border-ink-700 bg-ink-800 p-6">
            <p className="font-display text-base font-semibold text-ink-100">Faturamento do mês por loja</p>
            <p className="mb-4 mt-0.5 text-xs text-ink-500">Comparativo das lojas ativas neste mês.</p>
            <GraficoBarras
              destacarUltimo={false}
              pontos={lojas
                .filter((l) => l.ativo)
                .map((l) => ({ rotulo: l.nomeFantasia, valor: l.indicadores.faturamentoDoMes, descricao: `${l.nomeFantasia}: ${formatarMoeda(l.indicadores.faturamentoDoMes, tenant)} em ${l.indicadores.vendasDoMes} venda(s)` }))}
            />
          </div>
        )}
        <div className="grid gap-5 xl:grid-cols-2">
          {lojas.map((loja) => (
            <div key={loja.id} className={['rounded-xl border bg-ink-800 p-5', loja.atual ? 'border-tenant/50' : 'border-ink-700', loja.ativo ? '' : 'opacity-80'].join(' ')}>
              <div className="flex items-start gap-3">
                <img src={loja.logoDaLojaUrl} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover ring-1 ring-ink-600" />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 font-display font-semibold text-ink-100">
                    <span className="truncate">{loja.nomeFantasia}</span>
                    {loja.atual && <span className="rounded-full bg-tenant-soft px-2 py-0.5 text-[11px] font-medium text-tenant">Você está aqui</span>}
                    {!loja.ativo && <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-[11px] font-medium text-red-400">Desativada</span>}
                  </p>
                  <p className="mt-0.5 font-mono text-xs text-ink-500">{loja.cnpj}</p>
                  {cidadeUf(loja) && <p className="text-xs text-ink-400">{cidadeUf(loja)}</p>}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                <Numero rotulo="Vendas no mês" valor={String(loja.indicadores.vendasDoMes)} />
                <Numero rotulo="Faturamento" valor={formatarMoeda(loja.indicadores.faturamentoDoMes, tenant)} />
                <Numero rotulo="Produtos" valor={String(loja.indicadores.produtos)} />
                <Numero rotulo="Usuários" valor={String(loja.indicadores.usuarios)} />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-1 border-t border-ink-700 pt-3">
                {loja.ativo && !loja.atual && (
                  <button onClick={() => entrar(loja)} className="mr-1 rounded-lg bg-tenant-soft px-3 py-1.5 text-xs font-semibold text-tenant hover:bg-tenant hover:text-tenant-foreground">
                    Entrar nesta loja
                  </button>
                )}
                <BotaoTexto onClick={() => setEditando(loja)}>Editar</BotaoTexto>
                <BotaoTexto onClick={() => setAcessos(loja)}>Acessos</BotaoTexto>
                {!loja.atual && (
                  <>
                    <BotaoTexto onClick={() => alternarAtiva(loja)}>{loja.ativo ? 'Desativar' : 'Reativar'}</BotaoTexto>
                    <span className="ml-auto" />
                    <BotaoTexto perigo onClick={() => setExcluindo(loja)}>Excluir</BotaoTexto>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
        </>
      )}

      {criando && <LojaFormModal onFechar={() => setCriando(false)} onSalva={() => { setCriando(false); depoisDeSalvar(); }} />}
      {editando && <LojaFormModal loja={editando} onFechar={() => setEditando(null)} onSalva={() => { setEditando(null); depoisDeSalvar(); }} />}
      {acessos && <AcessosLojaModal loja={acessos} onFechar={() => setAcessos(null)} />}
      {excluindo && <ExcluirLojaModal loja={excluindo} onFechar={() => setExcluindo(null)} onExcluida={() => { setExcluindo(null); depoisDeSalvar(); }} />}
    </AppLayout>
  );
}
