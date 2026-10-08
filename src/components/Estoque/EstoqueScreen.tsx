import { useEffect, useState } from 'react';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { EstoqueBadge } from '@/components/Common/EstoqueBadge';
import { Paginacao } from '@/components/Common/Paginacao';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  searchProducts,
  getCategorias,
  registerStockEntry,
  createProduct,
  updateProduct,
  createCategoria,
  deactivateProduct,
  importarProdutos,
  setProdutoAtivo,
  ajustarEstoque,
  getTodosOsProdutos,
} from '@/services/apiService';
import { baixarCsv } from '@/utils/csv';
import { formatarMoeda } from '@/utils/formatters';
import { LIMITES_POR_PLANO } from '@/utils/planos';
import type { Categoria, Produto, ProdutoParaImportar } from '@/types';
import { EntradaEstoqueModal } from './EntradaEstoqueModal';
import { NovoProdutoModal } from './NovoProdutoModal';
import { SugestaoReposicaoModal } from './SugestaoReposicaoModal';
import { ImportarProdutosModal } from './ImportarProdutosModal';
import { AjusteEstoqueModal } from './AjusteEstoqueModal';
import { HistoricoProdutoModal } from './HistoricoProdutoModal';
import { CategoriasModal } from './CategoriasModal';

export function EstoqueScreen() {
  const { tenant } = useTenant();
  const toast = useToast();
  const confirmar = useConfirm();
  const [produtos, setProdutos] = useState<Produto[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [produtoParaEntrada, setProdutoParaEntrada] = useState<Produto | null>(null);
  const [mostrarNovoProduto, setMostrarNovoProduto] = useState(false);
  const [produtoParaEditar, setProdutoParaEditar] = useState<Produto | null>(null);
  const [produtoParaAjuste, setProdutoParaAjuste] = useState<Produto | null>(null);
  const [produtoHistorico, setProdutoHistorico] = useState<Produto | null>(null);
  const [mostrarCategorias, setMostrarCategorias] = useState(false);
  const [mostrarInativos, setMostrarInativos] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [mostrarSugestao, setMostrarSugestao] = useState(false);
  const [mostrarImportar, setMostrarImportar] = useState(false);
  const [termoBusca, setTermoBusca] = useState('');
  const [pagina, setPagina] = useState(1);
  const [totalPaginas, setTotalPaginas] = useState(1);
  const [totalProdutos, setTotalProdutos] = useState(0);
  const [produtosComEstoqueBaixo, setProdutosComEstoqueBaixo] = useState(0);

  async function carregarDados() {
    setCarregando(true);
    const [resultado, categoriasCarregadas] = await Promise.all([
      searchProducts(termoBusca, pagina, 20, mostrarInativos),
      getCategorias(),
    ]);
    setProdutos(resultado.itens);
    setTotalPaginas(resultado.totalPaginas);
    setTotalProdutos(resultado.total);
    setProdutosComEstoqueBaixo(resultado.produtosComEstoqueBaixo);
    setCategorias(categoriasCarregadas);
    setCarregando(false);
  }

  useEffect(() => {
    if (tenant) carregarDados();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenant, pagina, termoBusca, mostrarInativos]);

  function handleBuscar(valor: string) {
    setTermoBusca(valor);
    setPagina(1);
  }

  function nomeCategoria(categoriaId: string): string {
    return categorias.find((c) => c.id === categoriaId)?.nome ?? 'Sem categoria';
  }

  async function confirmarEntrada(produto: Produto, quantidade: number, precoCustoUnitario?: number) {
    try {
      await registerStockEntry({ productId: produto.id, quantidade, precoCustoUnitario });
      await carregarDados();
      toast.sucesso(`Entrada de ${quantidade} un. registrada em "${produto.nome}".`);
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao registrar entrada de estoque.');
    }
  }

  async function excluirProduto(produto: Produto) {
    const confirmou = await confirmar({
      titulo: `Excluir "${produto.nome}"?`,
      descricao: 'Ele deixará de aparecer no estoque e no PDV.',
      textoConfirmar: 'Excluir',
      perigoso: true,
    });
    if (!confirmou) return;

    try {
      await deactivateProduct(produto.id);
      await carregarDados();
      toast.sucesso(`"${produto.nome}" excluído.`);
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao excluir produto.');
    }
  }

  async function reativarProduto(produto: Produto) {
    try {
      await setProdutoAtivo(produto.id, true);
      await carregarDados();
      toast.sucesso(`"${produto.nome}" voltou ao estoque.`);
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao reativar produto.');
    }
  }

  async function confirmarAjuste(produto: Produto, novaQuantidade: number, motivo: string) {
    try {
      const r = await ajustarEstoque(produto.id, novaQuantidade, motivo);
      await carregarDados();
      toast.sucesso(`Estoque de "${produto.nome}" ajustado (${r.diferenca > 0 ? '+' : ''}${r.diferenca}).`);
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao ajustar o estoque.');
      throw erro;
    }
  }

  async function exportarCsv() {
    setExportando(true);
    try {
      const todos = await getTodosOsProdutos();
      baixarCsv(
        `produtos_${new Date().toISOString().slice(0, 10)}.csv`,
        ['nome', 'sku', 'categoria', 'precoCusto', 'precoVenda', 'quantidadeEmEstoque', 'estoqueMinimo'],
        todos.map((p) => [p.nome, p.sku, nomeCategoria(p.categoriaId), p.precoCusto, p.precoVenda, p.quantidadeEmEstoque, p.estoqueMinimo]),
      );
      toast.sucesso(`${todos.length} produto(s) exportado(s).`);
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao exportar.');
    } finally {
      setExportando(false);
    }
  }

  async function handleRegistrarEntradaSugestao(produtoId: string, quantidade: number) {
    try {
      await registerStockEntry({ productId: produtoId, quantidade });
      await carregarDados();
      toast.sucesso(`Entrada de ${quantidade} un. registrada.`);
      setMostrarSugestao(false);
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao registrar entrada.');
    }
  }

  async function handleImportarProdutos(produtosParaImportar: ProdutoParaImportar[]) {
    try {
      const resultado = await importarProdutos(produtosParaImportar);
      toast.sucesso(`${resultado.criados} produto(s) importado(s).`);
      setMostrarImportar(false);
      await carregarDados();
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao importar produtos.');
    }
  }

  const maxProdutos = tenant ? LIMITES_POR_PLANO[tenant.planoAtual].maxProdutos : null;
  const limiteAtingido = maxProdutos !== null && totalProdutos >= maxProdutos;

  return (
    <AppLayout
      titulo="Gestão de Estoque"
      subtitulo={
        produtosComEstoqueBaixo > 0
          ? `${produtosComEstoqueBaixo} produto(s) com estoque em nível baixo`
          : 'Todos os produtos estão em níveis saudáveis de estoque'
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <input
          value={termoBusca}
          onChange={(e) => handleBuscar(e.target.value)}
          placeholder="Buscar por nome ou SKU…"
          className="w-full max-w-xs rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-tenant focus:outline-none"
        />
        <div className="flex items-center gap-3">
          {maxProdutos !== null && (
            <p className="text-xs text-ink-500">
              {totalProdutos}/{maxProdutos} produto(s) do plano {tenant?.planoAtual}
            </p>
          )}
          <button
            onClick={() => setMostrarInativos((v) => { setPagina(1); return !v; })}
            className={['rounded-lg border px-3 py-2 text-sm font-medium', mostrarInativos ? 'border-tenant bg-tenant-soft text-tenant' : 'border-ink-600 text-ink-200 hover:border-tenant hover:text-tenant'].join(' ')}
          >
            {mostrarInativos ? 'Ver ativos' : 'Ver excluídos'}
          </button>
          <button
            onClick={() => setMostrarCategorias(true)}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm font-medium text-ink-200 hover:border-tenant hover:text-tenant"
          >
            Categorias
          </button>
          <button
            onClick={exportarCsv}
            disabled={exportando}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm font-medium text-ink-200 hover:border-tenant hover:text-tenant disabled:opacity-40"
          >
            {exportando ? 'Exportando…' : 'Exportar CSV'}
          </button>
          <button
            onClick={() => setMostrarSugestao(true)}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm font-medium text-ink-200 hover:border-tenant hover:text-tenant"
          >
            Sugestão de reposição
          </button>
          <button
            onClick={() => setMostrarImportar(true)}
            disabled={limiteAtingido}
            className="rounded-lg border border-ink-600 px-3 py-2 text-sm font-medium text-ink-200 hover:border-tenant hover:text-tenant disabled:cursor-not-allowed disabled:opacity-40"
          >
            Importar CSV
          </button>
          <button
            onClick={() => setMostrarNovoProduto(true)}
            disabled={limiteAtingido}
            title={limiteAtingido ? `Limite de produtos do plano ${tenant?.planoAtual} atingido.` : undefined}
            className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            + Novo produto
          </button>
        </div>
      </div>

      {carregando ? (
        <LoadingState mensagem="Carregando estoque…" />
      ) : produtos.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-700 p-10 text-center">
          <p className="text-sm text-ink-400">
            {termoBusca ? 'Nenhum produto encontrado.' : mostrarInativos ? 'Nenhum produto excluído.' : 'Nenhum produto cadastrado ainda.'}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-5 py-3 font-medium">Produto</th>
                <th className="px-5 py-3 font-medium">Categoria</th>
                <th className="px-5 py-3 font-medium">SKU</th>
                <th className="px-5 py-3 font-medium text-right">Custo</th>
                <th className="px-5 py-3 font-medium text-right">Venda</th>
                <th className="px-5 py-3 font-medium text-right">Em estoque</th>
                <th className="px-5 py-3 font-medium">Situação</th>
                <th className="px-5 py-3 font-medium text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700 bg-ink-800/40">
              {produtos.map((produto) => (
                <tr key={produto.id} className="transition-colors hover:bg-ink-800">
                  <td className="px-5 py-3.5 font-medium text-ink-100">{produto.nome}</td>
                  <td className="px-5 py-3.5 text-ink-300">{nomeCategoria(produto.categoriaId)}</td>
                  <td className="px-5 py-3.5 font-mono text-xs text-ink-400">{produto.sku}</td>
                  <td className="px-5 py-3.5 text-right font-mono text-ink-300">
                    {formatarMoeda(produto.precoCusto, tenant)}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-ink-100">
                    {formatarMoeda(produto.precoVenda, tenant)}
                  </td>
                  <td className="px-5 py-3.5 text-right font-mono text-ink-100">{produto.quantidadeEmEstoque}</td>
                  <td className="px-5 py-3.5">
                    <EstoqueBadge quantidadeEmEstoque={produto.quantidadeEmEstoque} estoqueMinimo={produto.estoqueMinimo} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex flex-wrap justify-end gap-2">
                      {produto.ativo ? (
                        <>
                          <button onClick={() => setProdutoParaEntrada(produto)} className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant">
                            + Entrada
                          </button>
                          <button onClick={() => setProdutoParaAjuste(produto)} className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant">
                            Ajustar
                          </button>
                          <button onClick={() => setProdutoHistorico(produto)} className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant">
                            Histórico
                          </button>
                          <button onClick={() => setProdutoParaEditar(produto)} className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant">
                            Editar
                          </button>
                          <button onClick={() => excluirProduto(produto)} className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-red-400 hover:text-red-400">
                            Excluir
                          </button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setProdutoHistorico(produto)} className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant">
                            Histórico
                          </button>
                          <button onClick={() => reativarProduto(produto)} className="rounded-lg border border-tenant px-3 py-1.5 text-xs font-medium text-tenant hover:bg-tenant-soft">
                            Reativar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Paginacao pagina={pagina} totalPaginas={totalPaginas} total={totalProdutos} aoMudarPagina={setPagina} />

      {produtoParaEntrada && (
        <EntradaEstoqueModal
          produto={produtoParaEntrada}
          aoFechar={() => setProdutoParaEntrada(null)}
          aoConfirmar={(quantidade, precoCustoUnitario) =>
            confirmarEntrada(produtoParaEntrada, quantidade, precoCustoUnitario)
          }
        />
      )}

      {mostrarNovoProduto && (
        <NovoProdutoModal
          categorias={categorias}
          aoFechar={() => setMostrarNovoProduto(false)}
          aoConfirmar={async (dados) => {
            await createProduct(dados);
            await carregarDados();
          }}
          aoCriarCategoria={async (nome) => {
            const categoria = await createCategoria(nome);
            setCategorias((atual) => [...atual, categoria]);
            return categoria;
          }}
        />
      )}

      {produtoParaEditar && (
        <NovoProdutoModal
          produto={produtoParaEditar}
          categorias={categorias}
          aoFechar={() => setProdutoParaEditar(null)}
          aoConfirmar={async ({ quantidadeEmEstoque: _saldo, ...alteracoes }) => {
            // O saldo não vai na edição: ele só muda por entrada de estoque e por venda.
            await updateProduct(produtoParaEditar.id, alteracoes);
            await carregarDados();
          }}
          aoCriarCategoria={async (nome) => {
            const categoria = await createCategoria(nome);
            setCategorias((atual) => [...atual, categoria]);
            return categoria;
          }}
        />
      )}

      {produtoParaAjuste && (
        <AjusteEstoqueModal
          produto={produtoParaAjuste}
          aoFechar={() => setProdutoParaAjuste(null)}
          aoConfirmar={(novaQuantidade, motivo) => confirmarAjuste(produtoParaAjuste, novaQuantidade, motivo)}
        />
      )}

      {produtoHistorico && <HistoricoProdutoModal produto={produtoHistorico} aoFechar={() => setProdutoHistorico(null)} />}

      {mostrarCategorias && <CategoriasModal categorias={categorias} aoMudar={setCategorias} aoFechar={() => setMostrarCategorias(false)} />}

      {mostrarSugestao && (
        <SugestaoReposicaoModal
          aoFechar={() => setMostrarSugestao(false)}
          aoRegistrarEntrada={handleRegistrarEntradaSugestao}
        />
      )}

      {mostrarImportar && (
        <ImportarProdutosModal aoFechar={() => setMostrarImportar(false)} aoImportar={handleImportarProdutos} />
      )}
    </AppLayout>
  );
}
