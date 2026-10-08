import { useState, type ChangeEvent } from 'react';
import { parseCsv } from '@/utils/csv';
import type { ProdutoParaImportar } from '@/types';

interface ImportarProdutosModalProps {
  aoFechar: () => void;
  aoImportar: (produtos: ProdutoParaImportar[]) => Promise<void>;
}

const COLUNAS_ESPERADAS = 'nome;sku;categoria;precoCusto;precoVenda;quantidadeEmEstoque;estoqueMinimo;codigoBarras';

function linhasParaProdutos(linhas: Array<Record<string, string>>): { produtos: ProdutoParaImportar[]; erros: string[] } {
  const produtos: ProdutoParaImportar[] = [];
  const erros: string[] = [];

  linhas.forEach((linha, i) => {
    const numeroLinha = i + 2; // +1 pelo cabeçalho, +1 pra base 1
    const nome = linha.nome?.trim();
    const sku = linha.sku?.trim();
    const categoria = linha.categoria?.trim();
    const precoCusto = Number(linha.precocusto?.replace(',', '.'));
    const precoVenda = Number(linha.precovenda?.replace(',', '.'));

    if (!nome || !sku || !categoria) {
      erros.push(`Linha ${numeroLinha}: nome, sku e categoria são obrigatórios.`);
      return;
    }
    if (!Number.isFinite(precoCusto) || !Number.isFinite(precoVenda)) {
      erros.push(`Linha ${numeroLinha}: precoCusto/precoVenda inválidos.`);
      return;
    }

    produtos.push({
      nome,
      sku,
      codigoBarras: linha.codigobarras?.trim() || undefined,
      categoria,
      precoCusto,
      precoVenda,
      quantidadeEmEstoque: Number(linha.quantidadeemestoque?.replace(',', '.')) || 0,
      estoqueMinimo: Number(linha.estoqueminimo?.replace(',', '.')) || 0,
    });
  });

  return { produtos, erros };
}

export function ImportarProdutosModal({ aoFechar, aoImportar }: ImportarProdutosModalProps) {
  const [texto, setTexto] = useState('');
  const [erros, setErros] = useState<string[]>([]);
  const [produtos, setProdutos] = useState<ProdutoParaImportar[] | null>(null);
  const [importando, setImportando] = useState(false);

  function processar(novoTexto: string) {
    setTexto(novoTexto);
    const linhas = parseCsv(novoTexto);
    if (linhas.length === 0) {
      setProdutos(null);
      setErros([]);
      return;
    }
    const resultado = linhasParaProdutos(linhas);
    setProdutos(resultado.produtos);
    setErros(resultado.erros);
  }

  function handleArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = () => processar(String(leitor.result ?? ''));
    leitor.readAsText(arquivo, 'utf-8');
  }

  async function handleImportar() {
    if (!produtos || produtos.length === 0) return;
    setImportando(true);
    try {
      await aoImportar(produtos);
    } finally {
      setImportando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink-700 bg-ink-800 p-6">
        <p className="font-display text-lg font-semibold text-ink-100">Importar produtos via planilha</p>
        <p className="mt-1 text-sm text-ink-400">
          Arquivo CSV (separado por vírgula ou ponto e vírgula) com as colunas:
        </p>
        <p className="mt-1 rounded-lg bg-ink-900 px-3 py-2 font-mono text-xs text-ink-300">{COLUNAS_ESPERADAS}</p>
        <p className="mt-1 text-[11px] text-ink-500">A coluna codigoBarras é opcional.</p>

        <label className="mt-4 block text-sm text-ink-300">
          Arquivo
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleArquivo}
            className="mt-1 block w-full text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-tenant file:px-3 file:py-2 file:text-sm file:font-semibold file:text-tenant-foreground"
          />
        </label>

        <p className="mt-3 text-xs text-ink-500">Ou cole o conteúdo do CSV diretamente:</p>
        <textarea
          value={texto}
          onChange={(e) => processar(e.target.value)}
          rows={6}
          placeholder={COLUNAS_ESPERADAS}
          className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 font-mono text-xs text-ink-100 placeholder:text-ink-500 focus:border-tenant focus:outline-none"
        />

        {erros.length > 0 && (
          <div className="mt-3 rounded-lg border border-red-900 bg-red-500/10 p-3 text-xs text-red-400">
            {erros.map((erro) => (
              <p key={erro}>{erro}</p>
            ))}
          </div>
        )}

        {produtos && produtos.length > 0 && (
          <p className="mt-3 text-sm text-tenant">{produtos.length} produto(s) prontos pra importar.</p>
        )}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
            Cancelar
          </button>
          <button
            onClick={handleImportar}
            disabled={!produtos || produtos.length === 0 || importando}
            className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {importando ? 'Importando…' : `Importar ${produtos?.length ?? 0} produto(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
