import { useEffect, useState, type FormEvent } from 'react';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { Paginacao } from '@/components/Common/Paginacao';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import { getClientes, createCliente, updateCliente, deleteCliente, getHistoricoCliente, importarClientes } from '@/services/apiService';
import { ImportarClientesModal } from './ImportarClientesModal';
import { formatarMoeda } from '@/utils/formatters';
import type { Cliente, HistoricoCliente } from '@/types';

export function ClientesScreen() {
  const { tenant } = useTenant();
  const toast = useToast();
  const confirmar = useConfirm();
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [termoBusca, setTermoBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [totalClientes, setTotalClientes] = useState(0);
  const [clienteHistorico, setClienteHistorico] = useState<Cliente | null>(null);
  const [historico, setHistorico] = useState<HistoricoCliente | null>(null);
  const [carregandoHistorico, setCarregandoHistorico] = useState(false);

  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [clienteEditando, setClienteEditando] = useState<Cliente | null>(null);
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [email, setEmail] = useState('');
  const [cpfCnpj, setCpfCnpj] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function carregarClientes() {
    setCarregando(true);
    const resultado = await getClientes(termoBusca, pagina);
    setClientes(resultado.itens);
    setTotalPaginas(resultado.totalPaginas);
    setTotalClientes(resultado.total);
    setCarregando(false);
  }

  useEffect(() => {
    carregarClientes();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagina, termoBusca]);

  function handleBuscar(valor: string) {
    setTermoBusca(valor);
    setPagina(1);
  }

  async function abrirHistorico(cliente: Cliente) {
    setClienteHistorico(cliente);
    setCarregandoHistorico(true);
    try {
      setHistorico(await getHistoricoCliente(cliente.id));
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao carregar histórico.');
      setClienteHistorico(null);
    } finally {
      setCarregandoHistorico(false);
    }
  }

  function limparFormulario() {
    setClienteEditando(null);
    setNome('');
    setTelefone('');
    setEmail('');
    setCpfCnpj('');
    setMostrarFormulario(false);
  }

  function iniciarEdicao(cliente: Cliente) {
    setClienteEditando(cliente);
    setNome(cliente.nome);
    setTelefone(cliente.telefone ?? '');
    setEmail(cliente.email ?? '');
    setCpfCnpj(cliente.cpfCnpj ?? '');
    setMostrarFormulario(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function excluir(cliente: Cliente) {
    const ok = await confirmar({
      titulo: `Excluir "${cliente.nome}"?`,
      descricao: 'Os dados pessoais do cliente são apagados. As vendas dele continuam no histórico da loja, sem o nome.',
      textoConfirmar: 'Excluir',
      perigoso: true,
    });
    if (!ok) return;
    try {
      await deleteCliente(cliente.id);
      toast.sucesso(`"${cliente.nome}" excluído.`);
      await carregarClientes();
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao excluir cliente.');
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    setEnviando(true);
    try {
      if (clienteEditando) {
        // Na edição, vazio apaga o valor antigo.
        await updateCliente(clienteEditando.id, { nome: nome.trim(), telefone, email, cpfCnpj });
        toast.sucesso(`Cliente "${nome.trim()}" atualizado.`);
      } else {
        await createCliente({ nome: nome.trim(), telefone: telefone || undefined, email: email || undefined, cpfCnpj: cpfCnpj || undefined });
        toast.sucesso(`Cliente "${nome.trim()}" cadastrado.`);
      }
      limparFormulario();
      await carregarClientes();
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao salvar cliente.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AppLayout titulo="Clientes" subtitulo="Cadastro de clientes para vincular às vendas">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <input
          value={termoBusca}
          onChange={(e) => handleBuscar(e.target.value)}
          placeholder="Buscar por nome, telefone ou CPF/CNPJ…"
          className="w-full max-w-xs rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-tenant focus:outline-none"
        />
        <div className="flex items-center gap-3">
        <button
          onClick={() => setMostrarImportar(true)}
          className="rounded-lg border border-ink-600 px-3 py-2 text-sm font-medium text-ink-200 hover:border-tenant hover:text-tenant"
        >
          Importar CSV
        </button>
        <button
          onClick={() => (mostrarFormulario ? limparFormulario() : setMostrarFormulario(true))}
          className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90"
        >
          {mostrarFormulario ? 'Cancelar' : '+ Novo cliente'}
        </button>
        </div>
      </div>

      {mostrarFormulario && (
        <form
          onSubmit={handleSubmit}
          className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-ink-700 bg-ink-800 p-6"
        >
          <label className="block text-sm text-ink-300">
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
            Telefone
            <input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            />
          </label>
          <label className="block text-sm text-ink-300">
            E-mail
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            />
          </label>
          <label className="block text-sm text-ink-300">
            CPF/CNPJ
            <input
              value={cpfCnpj}
              onChange={(e) => setCpfCnpj(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            />
          </label>

          <div className="col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={enviando}
              className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {enviando ? 'Salvando…' : clienteEditando ? 'Salvar alterações' : 'Salvar cliente'}
            </button>
          </div>
        </form>
      )}

      {carregando ? (
        <LoadingState mensagem="Carregando clientes…" />
      ) : clientes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-700 p-10 text-center">
          <p className="text-sm text-ink-400">
            {termoBusca ? 'Nenhum cliente encontrado.' : 'Nenhum cliente cadastrado ainda.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">Telefone</th>
                <th className="px-5 py-3 font-medium">E-mail</th>
                <th className="px-5 py-3 font-medium">CPF/CNPJ</th>
                <th className="px-5 py-3 font-medium text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700 bg-ink-800/40">
              {clientes.map((cliente) => (
                <tr key={cliente.id} className="transition-colors hover:bg-ink-800">
                  <td className="px-5 py-3.5 font-medium text-ink-100">{cliente.nome}</td>
                  <td className="px-5 py-3.5 text-ink-300">{cliente.telefone ?? '-'}</td>
                  <td className="px-5 py-3.5 text-ink-300">{cliente.email ?? '-'}</td>
                  <td className="px-5 py-3.5 font-mono text-xs text-ink-400">{cliente.cpfCnpj ?? '-'}</td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => abrirHistorico(cliente)}
                        className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant"
                      >
                        Histórico
                      </button>
                      <button
                        onClick={() => iniciarEdicao(cliente)}
                        className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant"
                      >
                        Editar
                      </button>
                      <button
                        onClick={() => excluir(cliente)}
                        className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-red-400 hover:text-red-400"
                      >
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

      <Paginacao pagina={pagina} totalPaginas={totalPaginas} total={totalClientes} aoMudarPagina={setPagina} />

      {mostrarImportar && (
        <ImportarClientesModal
          aoFechar={() => setMostrarImportar(false)}
          aoImportar={async (lista) => {
            try {
              const r = await importarClientes(lista);
              toast.sucesso(`${r.criados} cliente(s) importado(s)${r.ignorados > 0 ? `, ${r.ignorados} já existiam` : ''}.`);
              setMostrarImportar(false);
              await carregarClientes();
            } catch (err) {
              toast.erro(err instanceof Error ? err.message : 'Erro ao importar clientes.');
            }
          }}
        />
      )}

      {clienteHistorico && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true">
          <div className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink-700 bg-ink-800 p-6">
            <p className="font-display text-lg font-semibold text-ink-100">Histórico de {clienteHistorico.nome}</p>

            {carregandoHistorico ? (
              <LoadingState mensagem="Carregando…" />
            ) : historico && historico.vendas.length === 0 ? (
              <p className="mt-4 text-sm text-ink-400">Esse cliente ainda não fez nenhuma compra.</p>
            ) : (
              historico && (
                <>
                  <div className="mt-3 flex gap-6 text-sm">
                    <p className="text-ink-300">
                      Total gasto: <span className="font-semibold text-tenant">{formatarMoeda(historico.totalGasto, tenant)}</span>
                    </p>
                    <p className="text-ink-300">
                      Compras: <span className="font-semibold text-ink-100">{historico.quantidadeCompras}</span>
                    </p>
                  </div>

                  <div className="mt-4 space-y-3">
                    {historico.vendas.map((venda) => (
                      <div key={venda.id} className="rounded-lg border border-ink-700 p-3">
                        <div className="flex items-center justify-between text-sm">
                          <span className="text-ink-400">{new Date(venda.timestamp).toLocaleString('pt-BR')}</span>
                          <span className="font-semibold text-ink-100">{formatarMoeda(venda.valorTotal, tenant)}</span>
                        </div>
                        <p className="mt-1 text-xs text-ink-500">
                          {venda.itens.map((i) => `${i.quantidade}x ${i.nome}`).join(', ')}
                        </p>
                      </div>
                    ))}
                  </div>
                </>
              )
            )}

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => {
                  setClienteHistorico(null);
                  setHistorico(null);
                }}
                className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
