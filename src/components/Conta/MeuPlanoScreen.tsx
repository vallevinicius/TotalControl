import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  cancelarAssinatura,
  getAssinatura,
  getCobrancas,
  getUsuarios,
  iniciarCheckoutAssinatura,
  searchProducts,
  sincronizarAssinatura,
} from '@/services/apiService';
import { LIMITES_POR_PLANO, diasRestantesTrial } from '@/utils/planos';
import { linkWhatsapp } from '@/utils/contato';
import { formatarMoeda } from '@/utils/formatters';
import type { AssinaturaResumo, CobrancaAssinatura, PlanoSaaS } from '@/types';

const ROTULOS_PLANO: Record<PlanoSaaS, string> = {
  FREE: 'Free',
  STARTER: 'Starter',
  PRO: 'Pro',
  ENTERPRISE: 'Enterprise',
};

const NIVEL: Record<PlanoSaaS, number> = { FREE: 0, STARTER: 1, PRO: 2, ENTERPRISE: 3 };

const dataCurta = (iso: string) => new Date(iso).toLocaleDateString('pt-BR');

function BarraUso({ atual, limite, rotulo }: { atual: number; limite: number | null; rotulo: string }) {
  const percentual = limite ? Math.min(100, Math.round((atual / limite) * 100)) : 0;
  const perto = limite !== null && atual / limite >= 0.8;

  return (
    <div>
      <div className="flex items-center justify-between text-sm">
        <span className="text-ink-300">{rotulo}</span>
        <span className={perto ? 'font-medium text-amber-400' : 'text-ink-400'}>
          {atual}
          {limite !== null ? ` / ${limite}` : ' (ilimitado)'}
        </span>
      </div>
      {limite !== null && (
        <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-ink-700">
          <div className={['h-full rounded-full', perto ? 'bg-amber-400' : 'bg-tenant'].join(' ')} style={{ width: `${percentual}%` }} />
        </div>
      )}
    </div>
  );
}

function recursosDoPlano(plano: PlanoSaaS): string[] {
  const { maxUsuarios, maxProdutos, features } = LIMITES_POR_PLANO[plano];
  const itens = [maxUsuarios ? `${maxUsuarios} usuário(s)` : 'Usuários ilimitados', maxProdutos ? `${maxProdutos} produtos` : 'Produtos ilimitados'];
  if (features.financeiro) itens.push('Financeiro');
  if (features.relatorios) itens.push('Relatórios');
  if (features.vendedores) itens.push('Vendedores e comissão');
  if (features.multiLoja) itens.push('Múltiplas lojas');
  return itens;
}

/** Frase de situação da assinatura, mostrada no card do plano atual. */
function situacao(a: AssinaturaResumo): { texto: string; tom: 'ok' | 'aviso' | 'erro' } | null {
  const ate = a.acessoAte ? dataCurta(a.acessoAte) : null;
  if (a.acessoExpirado === 'TRIAL') return { texto: 'Teste grátis encerrado', tom: 'erro' };
  if (a.acessoExpirado === 'ASSINATURA') return { texto: 'Assinatura encerrada', tom: 'erro' };
  if (a.status === 'ATIVA') return { texto: ate ? `Assinatura ativa · próxima cobrança em ${ate}` : 'Assinatura ativa', tom: 'ok' };
  if (a.status === 'CANCELADA') return { texto: ate ? `Cancelada · você usa até ${ate}` : 'Cancelada', tom: 'aviso' };
  if (a.status === 'PAUSADA') return { texto: 'Pagamento pendente · regularize no Mercado Pago', tom: 'aviso' };
  if (a.status === 'PENDENTE') return { texto: 'Pagamento em andamento', tom: 'aviso' };
  return null;
}

export function MeuPlanoScreen() {
  const { tenant, lojas, usuarioAtual, recarregarSessao } = useTenant();
  const toast = useToast();
  const confirmar = useConfirm();
  const [params, setParams] = useSearchParams();
  const [assinatura, setAssinatura] = useState<AssinaturaResumo | null>(null);
  const [totalUsuarios, setTotalUsuarios] = useState(0);
  const [totalProdutos, setTotalProdutos] = useState(0);
  const [cobrancas, setCobrancas] = useState<CobrancaAssinatura[]>([]);
  const [trabalhando, setTrabalhando] = useState<string | null>(null);
  const voltouDoCheckout = useRef(params.get('retorno') === '1');

  const expirado = Boolean(tenant?.acessoExpirado);
  const contaPrincipal = Boolean(usuarioAtual?.raiz);

  const carregar = useCallback(async () => {
    const resumo = await getAssinatura();
    setAssinatura(resumo);
    return resumo;
  }, []);

  // Uso (usuários/produtos): com o acesso expirado essas rotas ficam bloqueadas.
  useEffect(() => {
    if (!tenant) return;
    if (!expirado) {
      Promise.all([getUsuarios(), searchProducts('', 1, 1)]).then(([usuarios, produtos]) => {
        setTotalUsuarios(usuarios.length);
        setTotalProdutos(produtos.total);
      }).catch(() => undefined); // sem permissão para ver o uso: a tela segue sem as barras
    }
    carregar()
      .then((resumo) => (resumo.status === 'NENHUMA' || resumo.status === 'PENDENTE' ? [] : getCobrancas()))
      .then(setCobrancas)
      .catch((e) => toast.erro(e instanceof Error ? e.message : 'Erro ao carregar o plano.'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant?.id, expirado]);

  // Voltando do checkout do Mercado Pago: confirma o pagamento direto na fonte
  // (o aviso automático pode demorar) e tenta algumas vezes antes de desistir.
  useEffect(() => {
    if (!voltouDoCheckout.current || !contaPrincipal) return;
    voltouDoCheckout.current = false;
    setParams({}, { replace: true });

    let ativo = true;
    (async () => {
      for (let tentativa = 0; tentativa < 6 && ativo; tentativa++) {
        try {
          const resumo = await sincronizarAssinatura();
          setAssinatura(resumo);
          if (resumo.status === 'ATIVA' && !resumo.planoPendente) {
            toast.sucesso(`Assinatura confirmada! Plano ${ROTULOS_PLANO[resumo.plano]} ativo.`);
            await recarregarSessao();
            return;
          }
        } catch {
          // segue tentando
        }
        await new Promise((r) => setTimeout(r, 3000));
      }
      if (ativo) toast.sucesso('Recebemos seu pedido. Assim que o Mercado Pago confirmar o pagamento, o plano é atualizado.');
    })();
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contaPrincipal]);

  async function assinar(plano: 'STARTER' | 'PRO') {
    setTrabalhando(plano);
    try {
      const { url } = await iniciarCheckoutAssinatura(plano);
      window.location.href = url;
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível iniciar o pagamento.');
      setTrabalhando(null);
    }
  }

  async function cancelar() {
    if (!assinatura) return;
    const ate = assinatura.acessoAte ? dataCurta(assinatura.acessoAte) : 'o fim do período pago';
    const ok = await confirmar({
      titulo: 'Cancelar a assinatura?',
      descricao: `Você continua usando o plano ${ROTULOS_PLANO[assinatura.plano]} até ${ate}, sem novas cobranças. Depois disso o acesso é pausado (seus dados ficam guardados) e você pode assinar de novo quando quiser.`,
      textoConfirmar: 'Cancelar assinatura',
      textoCancelar: 'Manter assinatura',
      perigoso: true,
    });
    if (!ok) return;
    setTrabalhando('cancelar');
    try {
      setAssinatura(await cancelarAssinatura());
      toast.sucesso('Assinatura cancelada. Você usa o plano até o fim do período pago.');
      await recarregarSessao();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível cancelar.');
    } finally {
      setTrabalhando(null);
    }
  }

  if (!tenant) return null;

  const limites = LIMITES_POR_PLANO[tenant.planoAtual];
  const dias = diasRestantesTrial(tenant.trialExpiraEm);
  const estado = assinatura ? situacao(assinatura) : null;
  const gerenciadoPelaEquipe = tenant.planoAtual === 'ENTERPRISE';
  const tonsSituacao = { ok: 'bg-emerald-500/15 text-emerald-400', aviso: 'bg-amber-500/15 text-amber-400', erro: 'bg-red-500/15 text-red-400' };

  function rotuloBotao(alvo: 'STARTER' | 'PRO'): { texto: string; desabilitado: boolean } {
    if (!assinatura) return { texto: 'Assinar', desabilitado: true };
    if (assinatura.status === 'ATIVA') {
      if (assinatura.plano === alvo) return { texto: 'Plano atual', desabilitado: true };
      return { texto: NIVEL[alvo] > NIVEL[assinatura.plano] ? 'Fazer upgrade' : 'Mudar para este plano', desabilitado: false };
    }
    return { texto: 'Assinar', desabilitado: false };
  }

  return (
    <AppLayout titulo="Meu plano" subtitulo="Assinatura, uso da conta e o que o plano inclui">
      {!assinatura ? (
        <LoadingState mensagem="Carregando…" />
      ) : (
        <div className="mx-auto max-w-4xl space-y-6">
          {expirado && (
            <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-5">
              <p className="font-display font-semibold text-red-300">
                {tenant.acessoExpirado === 'TRIAL' ? 'Seu teste grátis terminou' : 'Sua assinatura terminou'}
              </p>
              <p className="mt-1 text-sm text-red-200/80">
                {contaPrincipal
                  ? 'Escolha um plano abaixo para voltar a usar o sistema. Seus dados continuam guardados.'
                  : 'Peça ao responsável pela conta para escolher um plano e liberar o acesso de volta.'}
              </p>
            </div>
          )}

          <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-xs uppercase tracking-wide text-ink-500">Plano atual</p>
                <p className="font-display text-2xl font-semibold text-ink-100">{ROTULOS_PLANO[tenant.planoAtual]}</p>
                <p className="mt-0.5 text-xs text-ink-400">
                  {assinatura.status === 'ATIVA'
                    ? `${formatarMoeda(assinatura.precos[tenant.planoAtual as 'STARTER' | 'PRO'] ?? 0, tenant)} por mês, cobrado no Mercado Pago`
                    : assinatura.status === 'CANCELADA'
                      ? 'Assinatura cancelada'
                      : gerenciadoPelaEquipe
                        ? 'Plano combinado com a equipe'
                        : 'Sem cobrança recorrente ativa (teste ou cortesia)'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {estado && <span className={`rounded-full px-3 py-1 text-xs font-medium ${tonsSituacao[estado.tom]}`}>{estado.texto}</span>}
                {dias !== null && !expirado && assinatura.status !== 'ATIVA' && (
                  <span className={['rounded-full px-3 py-1 text-xs font-medium', dias > 3 ? 'bg-tenant-soft text-tenant' : 'bg-amber-500/15 text-amber-400'].join(' ')}>
                    Teste grátis: faltam {dias} dia(s)
                  </span>
                )}
              </div>
            </div>

            {!expirado && (
              <div className="mt-6 space-y-5">
                <BarraUso atual={totalUsuarios} limite={limites.maxUsuarios} rotulo="Usuários" />
                <BarraUso atual={totalProdutos} limite={limites.maxProdutos} rotulo="Produtos" />
                {limites.features.multiLoja && <BarraUso atual={lojas.length} limite={null} rotulo="Lojas" />}
              </div>
            )}
          </div>

          {gerenciadoPelaEquipe ? (
            <div className="rounded-xl border border-dashed border-ink-700 p-6 text-center">
              <p className="text-sm text-ink-300">O plano Enterprise é combinado diretamente com a nossa equipe.</p>
              <p className="mt-1 text-xs text-ink-500">Para mudar de plano, ajustar as lojas ou cancelar, fale com a gente.</p>
              <a
                href={linkWhatsapp('Olá! Preciso ajustar o plano Enterprise do Total Control.')}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 inline-block rounded-lg bg-tenant px-5 py-2.5 text-sm font-semibold text-tenant-foreground hover:opacity-90"
              >
                Falar com a equipe
              </a>
            </div>
          ) : (
            <div>
              <p className="mb-4 text-center font-display text-xl font-semibold text-ink-100">
                {assinatura.status === 'ATIVA' ? 'Mudar de plano' : 'Escolha seu plano'}
              </p>
              {!assinatura.pagamentoDisponivel && (
                <p className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
                  O pagamento online ainda está sendo configurado. Enquanto isso, fale com a gente para contratar.
                </p>
              )}
              <div className="grid gap-4 md:grid-cols-3">
                {(['STARTER', 'PRO'] as const).map((plano) => {
                  const botao = rotuloBotao(plano);
                  const atual = tenant.planoAtual === plano;
                  return (
                    <div key={plano} className={['flex flex-col rounded-xl border bg-ink-800 p-5', atual ? 'border-tenant' : 'border-ink-700'].join(' ')}>
                      <p className="flex items-center gap-2 font-display text-lg font-semibold text-ink-100">
                        {ROTULOS_PLANO[plano]}
                        {atual && <span className="rounded-full bg-tenant/15 px-2 py-0.5 font-sans text-[10px] font-medium text-tenant">Seu plano</span>}
                      </p>
                      <p className="mt-2">
                        <span className="font-display text-2xl font-bold text-ink-100">{formatarMoeda(assinatura.precos[plano], tenant)}</span>
                        <span className="ml-1 text-sm text-ink-400">/mês</span>
                      </p>
                      <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink-300">
                        {recursosDoPlano(plano).map((r) => (
                          <li key={r} className="flex items-center gap-2">
                            <span aria-hidden className="text-tenant">✓</span>
                            {r}
                          </li>
                        ))}
                      </ul>
                      <button
                        onClick={() => assinar(plano)}
                        disabled={botao.desabilitado || !contaPrincipal || !assinatura.pagamentoDisponivel || trabalhando !== null}
                        className="mt-5 rounded-lg bg-tenant py-2.5 text-sm font-semibold text-tenant-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {trabalhando === plano ? 'Abrindo o pagamento…' : botao.texto}
                      </button>
                    </div>
                  );
                })}

                <div className="flex flex-col rounded-xl border border-ink-700 bg-ink-800 p-5">
                  <p className="font-display text-lg font-semibold text-ink-100">Enterprise</p>
                  <p className="mt-2 font-display text-lg font-bold text-ink-100">Sob consulta</p>
                  <ul className="mt-4 flex-1 space-y-1.5 text-sm text-ink-300">
                    {recursosDoPlano('ENTERPRISE').map((r) => (
                      <li key={r} className="flex items-center gap-2">
                        <span aria-hidden className="text-tenant">✓</span>
                        {r}
                      </li>
                    ))}
                  </ul>
                  <a
                    href={linkWhatsapp('Olá! Quero saber mais sobre o plano Enterprise do Total Control.')}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-5 rounded-lg border border-ink-600 py-2.5 text-center text-sm font-semibold text-ink-200 hover:border-ink-500 hover:text-ink-100"
                  >
                    Falar com a gente
                  </a>
                </div>
              </div>
              {!contaPrincipal && <p className="mt-3 text-center text-xs text-ink-500">Só a conta principal da empresa pode contratar ou mudar de plano.</p>}
              <p className="mt-4 text-center text-xs text-ink-500">
                O pagamento é feito no Mercado Pago, com cobrança mensal recorrente. Ao mudar de plano, a assinatura anterior é encerrada.
              </p>
            </div>
          )}

          {!expirado && (
            <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
              <p className="mb-4 text-sm font-medium text-ink-200">O que o plano {ROTULOS_PLANO[tenant.planoAtual]} inclui</p>
              <ul className="space-y-2 text-sm">
                {[
                  { rotulo: 'Financeiro', ativo: limites.features.financeiro },
                  { rotulo: 'Relatórios', ativo: limites.features.relatorios },
                  { rotulo: 'Vendedores e comissão', ativo: limites.features.vendedores },
                  { rotulo: 'Múltiplas lojas', ativo: limites.features.multiLoja },
                ].map((item) => (
                  <li key={item.rotulo} className="flex items-center gap-2">
                    <span aria-hidden className={item.ativo ? 'text-tenant' : 'text-ink-600'}>{item.ativo ? '✓' : '✕'}</span>
                    <span className={item.ativo ? 'text-ink-200' : 'text-ink-500 line-through'}>{item.rotulo}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {contaPrincipal && cobrancas.length > 0 && (
            <div className="rounded-xl border border-ink-700 bg-ink-800 p-6">
              <p className="mb-4 font-display text-lg font-semibold text-ink-100">Cobranças</p>
              <div className="overflow-hidden rounded-lg border border-ink-700">
                <table className="w-full text-sm">
                  <thead className="bg-ink-700/40 text-left text-xs uppercase tracking-wide text-ink-400">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">Data</th>
                      <th className="px-4 py-2.5 font-medium">Situação</th>
                      <th className="px-4 py-2.5 text-right font-medium">Valor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-700">
                    {cobrancas.map((c) => {
                      const paga = c.statusDoPagamento === 'approved';
                      const recusada = c.statusDoPagamento === 'rejected' || c.statusDoPagamento === 'cancelled';
                      return (
                        <tr key={c.id}>
                          <td className="px-4 py-2.5 text-ink-300">{c.data ? dataCurta(c.data) : '-'}</td>
                          <td className="px-4 py-2.5">
                            <span className={['rounded-full px-2 py-0.5 text-xs font-medium', paga ? 'bg-emerald-500/15 text-emerald-400' : recusada ? 'bg-red-500/15 text-red-400' : 'bg-ink-700 text-ink-300'].join(' ')}>
                              {paga ? 'Paga' : recusada ? 'Recusada' : c.status === 'scheduled' ? 'Agendada' : 'Em processamento'}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono text-ink-100">{formatarMoeda(c.valor, tenant)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {contaPrincipal && !gerenciadoPelaEquipe && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 p-5">
              <div>
                <p className="text-sm font-medium text-ink-200">Cancelar assinatura</p>
                <p className="text-xs text-ink-500">
                  {assinatura.status === 'ATIVA'
                    ? 'Você continua usando até o fim do período já pago. Sem multa.'
                    : assinatura.status === 'CANCELADA'
                      ? `Já cancelada${assinatura.acessoAte ? `: você usa até ${dataCurta(assinatura.acessoAte)}` : ''}.`
                      : 'Você não tem uma assinatura paga ativa para cancelar. Ao assinar um plano acima, o cancelamento aparece aqui.'}
                </p>
              </div>
              <button
                onClick={cancelar}
                disabled={assinatura.status !== 'ATIVA' || trabalhando !== null}
                className="rounded-lg border border-red-500/40 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {trabalhando === 'cancelar' ? 'Cancelando…' : 'Cancelar assinatura'}
              </button>
            </div>
          )}
        </div>
      )}
    </AppLayout>
  );
}
