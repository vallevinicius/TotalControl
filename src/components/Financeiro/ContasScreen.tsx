import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { baixarConta, criarConta, deleteLancamento, getContas, getResumoContas, reabrirConta } from '@/services/apiService';
import { formatarMoeda } from '@/utils/formatters';
import type { LancamentoFinanceiro, ResumoContas, TipoLancamentoFinanceiro } from '@/types';

type Situacao = 'abertas' | 'pagas' | 'todas';

const hoje = () => new Date().toISOString().slice(0, 10);
const dataCurta = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'UTC' }) : '-');

function Cartao({ rotulo, valor, detalhe, tom }: { rotulo: string; valor: string; detalhe?: string; tom?: 'verde' | 'vermelho' | 'ambar' }) {
  const cor = tom === 'verde' ? 'text-emerald-400' : tom === 'vermelho' ? 'text-red-400' : tom === 'ambar' ? 'text-amber-400' : 'text-ink-100';
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800 p-5">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-400">{rotulo}</p>
      <p className={['mt-2 font-display text-xl font-semibold', cor].join(' ')}>{valor}</p>
      {detalhe && <p className="mt-0.5 text-xs text-ink-500">{detalhe}</p>}
    </div>
  );
}

/** Contas a pagar e a receber: o que ainda vai sair ou entrar, com vencimento.
 * Só entra no resultado do Financeiro depois de dar baixa. */
export function ContasScreen() {
  const { tenant } = useTenant();
  const toast = useToast();
  const confirmar = useConfirm();
  const [resumo, setResumo] = useState<ResumoContas | null>(null);
  const [contas, setContas] = useState<LancamentoFinanceiro[] | null>(null);
  const [situacao, setSituacao] = useState<Situacao>('abertas');
  const [tipo, setTipo] = useState<TipoLancamentoFinanceiro | 'TODOS'>('TODOS');
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  const [novoTipo, setNovoTipo] = useState<TipoLancamentoFinanceiro>('DESPESA');
  const [categoria, setCategoria] = useState('');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState(0);
  const [vencimento, setVencimento] = useState(hoje());
  const [parcelas, setParcelas] = useState(1);
  const [enviando, setEnviando] = useState(false);

  const carregar = useCallback(async () => {
    try {
      const [r, lista] = await Promise.all([getResumoContas(), getContas(situacao, tipo === 'TODOS' ? undefined : tipo)]);
      setResumo(r);
      setContas(lista);
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao carregar as contas.');
      setContas([]);
    }
  }, [situacao, tipo, toast]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  async function criar(e: FormEvent) {
    e.preventDefault();
    if (!categoria.trim() || valor <= 0) return;
    setEnviando(true);
    try {
      const r = await criarConta({ tipo: novoTipo, categoria: categoria.trim(), descricao: descricao.trim() || undefined, valor, vencimento, parcelas });
      toast.sucesso(r.criadas > 1 ? `${r.criadas} contas criadas.` : 'Conta criada.');
      setCategoria('');
      setDescricao('');
      setValor(0);
      setParcelas(1);
      setMostrarFormulario(false);
      await carregar();
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao criar a conta.');
    } finally {
      setEnviando(false);
    }
  }

  async function executar(acao: () => Promise<unknown>, sucesso: string) {
    try {
      await acao();
      toast.sucesso(sucesso);
      await carregar();
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Não foi possível concluir.');
    }
  }

  async function excluir(c: LancamentoFinanceiro) {
    const ok = await confirmar({ titulo: `Excluir "${c.categoria}"?`, descricao: c.descricao, textoConfirmar: 'Excluir', perigoso: true });
    if (ok) executar(() => deleteLancamento(c.id), 'Conta excluída.');
  }

  const campo = 'mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none';
  const moeda = (v: number) => formatarMoeda(v, tenant);

  return (
    <AppLayout titulo="Contas a pagar e receber" subtitulo="O que ainda vai sair ou entrar, com vencimento">
      {resumo && (
        <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
          <Cartao rotulo="A pagar" valor={moeda(resumo.aPagar)} detalhe="em aberto" tom="vermelho" />
          <Cartao rotulo="A receber" valor={moeda(resumo.aReceber)} detalhe="em aberto" tom="verde" />
          <Cartao rotulo="Em atraso" valor={moeda(resumo.atrasadas.valor)} detalhe={`${resumo.atrasadas.quantidade} conta(s)`} tom={resumo.atrasadas.quantidade > 0 ? 'vermelho' : undefined} />
          <Cartao rotulo="Vencem em 7 dias" valor={moeda(resumo.proximos7Dias.valor)} detalhe={`${resumo.proximos7Dias.quantidade} conta(s)`} tom={resumo.proximos7Dias.quantidade > 0 ? 'ambar' : undefined} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['abertas', 'pagas', 'todas'] as const).map((s) => (
            <button key={s} onClick={() => setSituacao(s)} className={['rounded-lg border px-3 py-1.5 text-sm font-medium', situacao === s ? 'border-tenant bg-tenant-soft text-tenant' : 'border-ink-600 text-ink-300 hover:border-ink-500'].join(' ')}>
              {s === 'abertas' ? 'Em aberto' : s === 'pagas' ? 'Baixadas' : 'Todas'}
            </button>
          ))}
          <select value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)} aria-label="Tipo" className="rounded-lg border border-ink-600 bg-ink-700 px-3 py-1.5 text-sm text-ink-100 focus:border-tenant focus:outline-none">
            <option value="TODOS">A pagar e a receber</option>
            <option value="DESPESA">Só a pagar</option>
            <option value="RECEITA">Só a receber</option>
          </select>
        </div>
        <button onClick={() => setMostrarFormulario((v) => !v)} className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90">
          {mostrarFormulario ? 'Cancelar' : '+ Nova conta'}
        </button>
      </div>

      {mostrarFormulario && (
        <form onSubmit={criar} className="mb-6 grid gap-4 rounded-xl border border-ink-700 bg-ink-800 p-6 sm:grid-cols-6">
          <div className="sm:col-span-2">
            <p className="text-sm text-ink-300">Tipo</p>
            <div className="mt-1 flex gap-2">
              {(['DESPESA', 'RECEITA'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setNovoTipo(t)} className={['flex-1 rounded-lg border px-3 py-2 text-xs font-medium', novoTipo === t ? (t === 'DESPESA' ? 'border-red-400 bg-red-500/15 text-red-400' : 'border-emerald-400 bg-emerald-500/15 text-emerald-400') : 'border-ink-600 text-ink-300'].join(' ')}>
                  {t === 'DESPESA' ? 'A pagar' : 'A receber'}
                </button>
              ))}
            </div>
          </div>
          <label className="block text-sm text-ink-300 sm:col-span-2">
            Categoria
            <input required value={categoria} onChange={(e) => setCategoria(e.target.value)} placeholder="Aluguel, fornecedor, salário…" className={campo} />
          </label>
          <label className="block text-sm text-ink-300 sm:col-span-2">
            Descrição (opcional)
            <input value={descricao} onChange={(e) => setDescricao(e.target.value)} className={campo} />
          </label>
          <label className="block text-sm text-ink-300 sm:col-span-2">
            Valor de cada conta
            <input type="number" min={0.01} step={0.01} required value={valor === 0 ? '' : valor} onChange={(e) => setValor(Number(e.target.value) || 0)} className={campo} />
          </label>
          <label className="block text-sm text-ink-300 sm:col-span-2">
            Primeiro vencimento
            <input type="date" required value={vencimento} onChange={(e) => setVencimento(e.target.value)} className={campo} />
          </label>
          <label className="block text-sm text-ink-300 sm:col-span-2">
            Repetir por (meses)
            <input type="number" min={1} max={36} value={parcelas} onChange={(e) => setParcelas(Math.min(36, Math.max(1, Number(e.target.value) || 1)))} className={campo} />
            <span className="mt-1 block text-[11px] text-ink-500">{parcelas > 1 ? `Cria ${parcelas} contas, uma por mês.` : 'Conta única.'}</span>
          </label>
          <div className="flex justify-end sm:col-span-6">
            <button type="submit" disabled={enviando} className="rounded-lg bg-tenant px-5 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:opacity-40">
              {enviando ? 'Salvando…' : 'Salvar conta'}
            </button>
          </div>
        </form>
      )}

      {!contas ? (
        <LoadingState mensagem="Carregando contas…" />
      ) : contas.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-700 p-10 text-center text-sm text-ink-400">
          {situacao === 'abertas' ? 'Nenhuma conta em aberto. Use "+ Nova conta" para lançar aluguel, fornecedores e o que mais vence.' : 'Nada por aqui.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-ink-700">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-5 py-3 font-medium">Vencimento</th>
                <th className="px-5 py-3 font-medium">Conta</th>
                <th className="px-5 py-3 font-medium">Situação</th>
                <th className="px-5 py-3 text-right font-medium">Valor</th>
                <th className="px-5 py-3 text-right font-medium">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700 bg-ink-800/40">
              {contas.map((c) => (
                <tr key={c.id} className="hover:bg-ink-800">
                  <td className="px-5 py-3.5 text-ink-300">{dataCurta(c.vencimento)}</td>
                  <td className="px-5 py-3.5">
                    <p className="text-ink-100">
                      <span className={c.tipo === 'RECEITA' ? 'text-emerald-400' : 'text-red-400'}>{c.tipo === 'RECEITA' ? '↓ ' : '↑ '}</span>
                      {c.categoria}
                    </p>
                    {c.descricao && <p className="text-xs text-ink-500">{c.descricao}</p>}
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={['rounded-full px-2.5 py-1 text-xs font-medium', c.situacao === 'PAGA' ? 'bg-emerald-500/15 text-emerald-400' : c.situacao === 'ATRASADA' ? 'bg-red-500/15 text-red-400' : 'bg-ink-700 text-ink-300'].join(' ')}>
                      {c.situacao === 'PAGA' ? `${c.tipo === 'RECEITA' ? 'Recebida' : 'Paga'} em ${dataCurta(c.pagoEm)}` : c.situacao === 'ATRASADA' ? 'Atrasada' : 'Em aberto'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-ink-100">{moeda(c.valor)}</td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex justify-end gap-2">
                      {c.pagoEm ? (
                        <button onClick={() => executar(() => reabrirConta(c.id), 'Baixa desfeita.')} className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant">
                          Desfazer baixa
                        </button>
                      ) : (
                        <button onClick={() => executar(() => baixarConta(c.id), c.tipo === 'RECEITA' ? 'Recebimento registrado.' : 'Pagamento registrado.')} className="rounded-lg border border-tenant px-3 py-1.5 text-xs font-medium text-tenant hover:bg-tenant-soft">
                          {c.tipo === 'RECEITA' ? 'Receber' : 'Pagar'}
                        </button>
                      )}
                      <button onClick={() => excluir(c)} className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-red-400 hover:text-red-400">
                        Excluir
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppLayout>
  );
}
