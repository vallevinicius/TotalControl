import { useEffect, useState, type FormEvent } from 'react';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { getVendedores, createVendedor, updateVendedor } from '@/services/apiService';
import type { Vendedor } from '@/types';

export function VendedoresScreen() {
  const toast = useToast();
  const confirmar = useConfirm();

  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);

  const [nome, setNome] = useState('');
  const [comissaoPercentual, setComissaoPercentual] = useState<number>(0);
  const [enviando, setEnviando] = useState(false);

  async function carregarVendedores() {
    setCarregando(true);
    setVendedores(await getVendedores());
    setCarregando(false);
  }

  useEffect(() => {
    carregarVendedores();
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setEnviando(true);
    try {
      await createVendedor({ nome: nome.trim(), comissaoPercentual });
      toast.sucesso(`Vendedor "${nome.trim()}" cadastrado.`);
      setNome('');
      setComissaoPercentual(0);
      setMostrarFormulario(false);
      await carregarVendedores();
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao cadastrar vendedor.');
    } finally {
      setEnviando(false);
    }
  }

  async function handleToggleAtivo(vendedor: Vendedor) {
    if (vendedor.ativo) {
      const confirmou = await confirmar({
        titulo: `Desativar "${vendedor.nome}"?`,
        descricao: 'Ele deixa de aparecer como opção ao registrar uma venda.',
        textoConfirmar: 'Desativar',
        perigoso: true,
      });
      if (!confirmou) return;
    }

    try {
      await updateVendedor(vendedor.id, { ativo: !vendedor.ativo });
      await carregarVendedores();
      toast.sucesso(vendedor.ativo ? 'Vendedor desativado.' : 'Vendedor reativado.');
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar vendedor.');
    }
  }

  return (
    <AppLayout titulo="Vendedores" subtitulo="Quem vende, pra saber quanto pagar de comissão no fim do mês">
      <div className="mb-4 flex justify-end">
        <button
          onClick={() => setMostrarFormulario((atual) => !atual)}
          className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90"
        >
          {mostrarFormulario ? 'Cancelar' : '+ Novo vendedor'}
        </button>
      </div>

      {mostrarFormulario && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3 rounded-xl border border-ink-700 bg-ink-800 p-6"
        >
          <label className="col-span-2 block text-sm text-ink-300">
            Nome
            <input
              required
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            />
          </label>
          <label className="block text-sm text-ink-300">
            Comissão (%)
            <input
              type="number"
              min={0}
              max={100}
              step={0.5}
              value={comissaoPercentual === 0 ? '' : comissaoPercentual}
              onChange={(e) => setComissaoPercentual(Number(e.target.value) || 0)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            />
          </label>

          <div className="col-span-3 flex justify-end">
            <button
              type="submit"
              disabled={enviando}
              className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {enviando ? 'Salvando…' : 'Salvar vendedor'}
            </button>
          </div>
        </form>
      )}

      {carregando ? (
        <LoadingState mensagem="Carregando vendedores…" />
      ) : vendedores.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-700 p-10 text-center">
          <p className="text-sm text-ink-400">Nenhum vendedor cadastrado ainda.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium text-right">Comissão</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700 bg-ink-800/40">
              {vendedores.map((vendedor) => (
                <tr key={vendedor.id} className="transition-colors hover:bg-ink-800">
                  <td className="px-5 py-3.5 font-medium text-ink-100">{vendedor.nome}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-ink-300">{vendedor.comissaoPercentual}%</td>
                  <td className="px-5 py-3.5">
                    <span
                      className={[
                        'rounded-full px-2.5 py-1 text-xs font-medium',
                        vendedor.ativo ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
                      ].join(' ')}
                    >
                      {vendedor.ativo ? 'Ativo' : 'Desativado'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <button
                      onClick={() => handleToggleAtivo(vendedor)}
                      className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant"
                    >
                      {vendedor.ativo ? 'Desativar' : 'Ativar'}
                    </button>
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
