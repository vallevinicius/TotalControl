import { useState } from 'react';
import { useToast } from '@/contexts/ToastContext';
import type { Categoria, Produto } from '@/types';
import type { NovoProdutoPayload } from '@/services/apiService';

interface NovoProdutoModalProps {
  /** Sem `produto` = cadastrando; com `produto` = editando (o saldo muda só por entrada de estoque). */
  produto?: Produto;
  categorias: Categoria[];
  aoFechar: () => void;
  aoConfirmar: (dados: NovoProdutoPayload) => Promise<void>;
  aoCriarCategoria: (nome: string) => Promise<Categoria>;
}

export function NovoProdutoModal({ produto, categorias, aoFechar, aoConfirmar, aoCriarCategoria }: NovoProdutoModalProps) {
  const toast = useToast();
  const editando = Boolean(produto);
  const [nome, setNome] = useState(produto?.nome ?? '');
  const [sku, setSku] = useState(produto?.sku ?? '');
  const [categoriaId, setCategoriaId] = useState(produto?.categoriaId ?? categorias[0]?.id ?? '');
  const [novaCategoria, setNovaCategoria] = useState('');
  const [criandoCategoria, setCriandoCategoria] = useState(false);
  const [precoCusto, setPrecoCusto] = useState<number>(produto?.precoCusto ?? 0);
  const [precoVenda, setPrecoVenda] = useState<number>(produto?.precoVenda ?? 0);
  const [quantidadeEmEstoque, setQuantidadeEmEstoque] = useState<number>(produto?.quantidadeEmEstoque ?? 0);
  const [estoqueMinimo, setEstoqueMinimo] = useState<number>(produto?.estoqueMinimo ?? 0);
  const [enviando, setEnviando] = useState(false);

  async function handleCriarCategoria() {
    const nomeLimpo = novaCategoria.trim();
    if (!nomeLimpo) return;
    setCriandoCategoria(true);
    try {
      const categoria = await aoCriarCategoria(nomeLimpo);
      setCategoriaId(categoria.id);
      setNovaCategoria('');
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao criar categoria.');
    } finally {
      setCriandoCategoria(false);
    }
  }

  async function handleConfirmar() {
    if (!nome.trim() || !sku.trim() || !categoriaId) {
      toast.erro('Preencha nome, SKU e categoria.');
      return;
    }
    setEnviando(true);
    try {
      await aoConfirmar({
        nome: nome.trim(),
        sku: sku.trim(),
        categoriaId,
        precoCusto,
        precoVenda,
        quantidadeEmEstoque,
        estoqueMinimo,
      });
      toast.sucesso(editando ? `Produto "${nome.trim()}" atualizado.` : `Produto "${nome.trim()}" cadastrado.`);
      aoFechar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao salvar o produto.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-800 p-6">
        <p className="font-display text-lg font-semibold text-ink-100">{editando ? 'Editar produto' : 'Cadastrar novo produto'}</p>

        <div className="mt-5 space-y-4">
          <label className="block text-sm text-ink-300">
            Nome do produto
            <input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            />
          </label>

          <label className="block text-sm text-ink-300">
            SKU (código do produto)
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            />
          </label>

          <div className="text-sm text-ink-300">
            <label className="block">
              Categoria
              <select
                value={categoriaId}
                onChange={(e) => setCategoriaId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
              >
                {categorias.length === 0 && <option value="">Nenhuma categoria ainda</option>}
                {categorias.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
            <div className="mt-2 flex gap-2">
              <input
                value={novaCategoria}
                onChange={(e) => setNovaCategoria(e.target.value)}
                placeholder="Ou crie uma categoria nova…"
                className="flex-1 rounded-lg border border-ink-600 bg-ink-700 px-3 py-1.5 text-xs text-ink-100 placeholder:text-ink-400 focus:border-tenant focus:outline-none"
              />
              <button
                type="button"
                onClick={handleCriarCategoria}
                disabled={criandoCategoria || !novaCategoria.trim()}
                className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant disabled:cursor-not-allowed disabled:opacity-40"
              >
                {criandoCategoria ? 'Criando…' : 'Criar'}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <label className="block text-sm text-ink-300">
              Preço de custo
              <input
                type="number"
                min={0}
                step={0.01}
                value={precoCusto === 0 ? '' : precoCusto}
                onChange={(e) => setPrecoCusto(Number(e.target.value) || 0)}
                className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
              />
            </label>
            <label className="block text-sm text-ink-300">
              Preço de venda
              <input
                type="number"
                min={0}
                step={0.01}
                value={precoVenda === 0 ? '' : precoVenda}
                onChange={(e) => setPrecoVenda(Number(e.target.value) || 0)}
                className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
              />
            </label>
            {editando ? (
              <div className="text-sm text-ink-300">
                Em estoque agora
                <p className="mt-1 rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 font-mono text-ink-100">{produto!.quantidadeEmEstoque}</p>
                <p className="mt-1 text-[11px] text-ink-500">Para mudar o saldo, use "+ Entrada".</p>
              </div>
            ) : (
            <label className="block text-sm text-ink-300">
              Estoque inicial
              <input
                type="number"
                min={0}
                value={quantidadeEmEstoque === 0 ? '' : quantidadeEmEstoque}
                onChange={(e) => setQuantidadeEmEstoque(Number(e.target.value) || 0)}
                className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
              />
            </label>
            )}
            <label className="block text-sm text-ink-300">
              Estoque mínimo
              <input
                type="number"
                min={0}
                value={estoqueMinimo === 0 ? '' : estoqueMinimo}
                onChange={(e) => setEstoqueMinimo(Number(e.target.value) || 0)}
                className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
              />
            </label>
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
            Cancelar
          </button>
          <button
            onClick={handleConfirmar}
            disabled={enviando}
            className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar produto'}
          </button>
        </div>
      </div>
    </div>
  );
}
