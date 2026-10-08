import { useEffect, useState, type FormEvent } from 'react';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { FiltroPeriodo, hoje, inicioDoMesAtual } from './FiltroPeriodo';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { getLancamentos, createLancamento, deleteLancamento } from '@/services/apiService';
import { formatarMoeda, formatarDataHora } from '@/utils/formatters';
import type { LancamentoFinanceiro, TipoLancamentoFinanceiro } from '@/types';

export function LancamentosScreen() {
  const { tenant } = useTenant();
  const toast = useToast();
  const confirmar = useConfirm();
  const [inicio, setInicio] = useState(inicioDoMesAtual());
  const [fim, setFim] = useState(hoje());
  const [lancamentos, setLancamentos] = useState<LancamentoFinanceiro[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [tipo, setTipo] = useState<TipoLancamentoFinanceiro>('DESPESA');
  const [categoria, setCategoria] = useState('');
  const [descricao, setDescricao] = useState('');
  const [valor, setValor] = useState<number>(0);
  const [data, setData] = useState(hoje());
  const [enviando, setEnviando] = useState(false);

  async function carregar() {
    setCarregando(true);
    setLancamentos(await getLancamentos(inicio, fim));
    setCarregando(false);
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!categoria.trim() || valor <= 0) return;
    setEnviando(true);
    try {
      await createLancamento({ tipo, categoria: categoria.trim(), descricao: descricao || undefined, valor, data });
      toast.sucesso(`${tipo === 'RECEITA' ? 'Receita' : 'Despesa'} lançada.`);
      setCategoria('');
      setDescricao('');
      setValor(0);
      setMostrarFormulario(false);
      await carregar();
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao lançar.');
    } finally {
      setEnviando(false);
    }
  }

  async function handleExcluir(lancamento: LancamentoFinanceiro) {
    const confirmou = await confirmar({
      titulo: `Excluir lançamento "${lancamento.categoria}"?`,
      textoConfirmar: 'Excluir',
      perigoso: true,
    });
    if (!confirmou) return;

    try {
      await deleteLancamento(lancamento.id);
      await carregar();
      toast.sucesso('Lançamento excluído.');
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao excluir lançamento.');
    }
  }

  return (
    <AppLayout titulo="Lançamentos" subtitulo="Receitas e despesas avulsas do período">
      <FiltroPeriodo inicio={inicio} fim={fim} onInicio={setInicio} onFim={setFim} onFiltrar={carregar}>
        <button
          onClick={() => setMostrarFormulario((atual) => !atual)}
          className="rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-200 hover:border-tenant hover:text-tenant"
        >
          {mostrarFormulario ? 'Cancelar' : '+ Novo lançamento'}
        </button>
      </FiltroPeriodo>

      {mostrarFormulario && (
        <form onSubmit={handleSubmit} className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5 rounded-xl border border-ink-700 bg-ink-800 p-6">
          <div className="text-sm text-ink-300">
            Tipo
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setTipo('DESPESA')}
                className={[
                  'flex-1 rounded-lg border px-3 py-2 text-xs font-medium',
                  tipo === 'DESPESA' ? 'border-red-400 bg-red-500/15 text-red-400' : 'border-ink-600 text-ink-300',
                ].join(' ')}
              >
                Despesa
              </button>
              <button
                type="button"
                onClick={() => setTipo('RECEITA')}
                className={[
                  'flex-1 rounded-lg border px-3 py-2 text-xs font-medium',
                  tipo === 'RECEITA' ? 'border-emerald-400 bg-emerald-500/15 text-emerald-400' : 'border-ink-600 text-ink-300',
                ].join(' ')}
              >
                Receita
              </button>
            </div>
          </div>

          <label className="block text-sm text-ink-300">
            Categoria
            <input
              required
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              placeholder="Aluguel, salário…"
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 placeholder:text-ink-400 focus:border-tenant focus:outline-none"
            />
          </label>

          <label className="block text-sm text-ink-300">
            Descrição
            <input
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            />
          </label>

          <label className="block text-sm text-ink-300">
            Valor
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={valor === 0 ? '' : valor}
              onChange={(e) => setValor(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            />
          </label>

          <label className="block text-sm text-ink-300">
            Data
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            />
          </label>

          <div className="col-span-5 flex justify-end">
            <button
              type="submit"
              disabled={enviando}
              className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {enviando ? 'Salvando…' : 'Salvar lançamento'}
            </button>
          </div>
        </form>
      )}

      {carregando ? (
        <LoadingState mensagem="Carregando lançamentos…" />
      ) : (
        <div className="space-y-6">
          <div className="overflow-hidden rounded-xl border border-ink-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                <tr>
                  <th className="px-5 py-3 font-medium">Data</th>
                  <th className="px-5 py-3 font-medium">Tipo</th>
                  <th className="px-5 py-3 font-medium">Categoria</th>
                  <th className="px-5 py-3 font-medium">Descrição</th>
                  <th className="px-5 py-3 font-medium text-right">Valor</th>
                  <th className="px-5 py-3 font-medium text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-700 bg-ink-800/40">
                {lancamentos.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-5 py-6 text-center text-ink-400">
                      Nenhum lançamento avulso no período selecionado.
                    </td>
                  </tr>
                ) : (
                  lancamentos.map((l) => (
                    <tr key={l.id} className="transition-colors hover:bg-ink-800">
                      <td className="px-5 py-3.5 text-ink-300">{formatarDataHora(l.data, tenant)}</td>
                      <td className="px-5 py-3.5">
                        <span
                          className={[
                            'rounded-full px-2.5 py-1 text-xs font-medium',
                            l.tipo === 'RECEITA' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
                          ].join(' ')}
                        >
                          {l.tipo === 'RECEITA' ? 'Receita' : 'Despesa'}
                        </span>
                      </td>
                      <td className="px-5 py-3.5 text-ink-100">{l.categoria}</td>
                      <td className="px-5 py-3.5 text-ink-300">{l.descricao ?? '|'}</td>
                      <td className="px-5 py-3.5 text-right font-mono text-ink-100">{formatarMoeda(l.valor, tenant)}</td>
                      <td className="px-5 py-3.5 text-right">
                        <button onClick={() => handleExcluir(l)} className="text-xs text-ink-400 hover:text-red-400">
                          Excluir
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
