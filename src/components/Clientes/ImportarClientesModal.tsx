import { useState, type ChangeEvent } from 'react';
import { ModalFundo } from '@/components/Admin/AdminModais';
import { parseCsv } from '@/utils/csv';
import type { NovoClientePayload } from '@/services/apiService';

const COLUNAS = 'nome;telefone;email;cpfCnpj';

function linhasParaClientes(linhas: Array<Record<string, string>>): { clientes: NovoClientePayload[]; erros: string[] } {
  const clientes: NovoClientePayload[] = [];
  const erros: string[] = [];
  linhas.forEach((l, i) => {
    const numero = i + 2;
    const nome = l.nome?.trim();
    const email = l.email?.trim();
    if (!nome) return void erros.push(`Linha ${numero}: o nome é obrigatório.`);
    if (email && !/^\S+@\S+\.\S+$/.test(email)) return void erros.push(`Linha ${numero}: e-mail inválido (${email}).`);
    clientes.push({ nome, telefone: l.telefone?.trim() || undefined, email: email || undefined, cpfCnpj: l.cpfcnpj?.trim() || undefined });
  });
  return { clientes, erros };
}

/** Importa clientes de uma planilha CSV. Quem já existe (mesmo CPF/CNPJ) é ignorado. */
export function ImportarClientesModal({ aoFechar, aoImportar }: { aoFechar: () => void; aoImportar: (clientes: NovoClientePayload[]) => Promise<void> }) {
  const [texto, setTexto] = useState('');
  const [clientes, setClientes] = useState<NovoClientePayload[]>([]);
  const [erros, setErros] = useState<string[]>([]);
  const [importando, setImportando] = useState(false);

  function processar(novo: string) {
    setTexto(novo);
    const r = linhasParaClientes(parseCsv(novo));
    setClientes(r.clientes);
    setErros(r.erros);
  }

  function aoEscolherArquivo(e: ChangeEvent<HTMLInputElement>) {
    const arquivo = e.target.files?.[0];
    if (!arquivo) return;
    const leitor = new FileReader();
    leitor.onload = () => processar(String(leitor.result ?? ''));
    leitor.readAsText(arquivo, 'utf-8');
  }

  async function importar() {
    setImportando(true);
    try {
      await aoImportar(clientes);
    } finally {
      setImportando(false);
    }
  }

  return (
    <ModalFundo onFechar={aoFechar}>
      <div className="max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-xl border border-ink-700 bg-ink-800 p-6">
        <p className="font-display text-lg font-semibold text-ink-100">Importar clientes via planilha</p>
        <p className="mt-1 text-sm text-ink-400">Arquivo CSV (separado por vírgula ou ponto e vírgula) com as colunas:</p>
        <p className="mt-1 rounded-lg bg-ink-900 px-3 py-2 font-mono text-xs text-ink-300">{COLUNAS}</p>
        <p className="mt-2 text-xs text-ink-500">Só o nome é obrigatório. Quem já tem o mesmo CPF/CNPJ cadastrado é ignorado.</p>

        <label className="mt-4 block text-sm text-ink-300">
          Arquivo
          <input type="file" accept=".csv,text/csv" onChange={aoEscolherArquivo} className="mt-1 block w-full text-sm text-ink-300 file:mr-3 file:rounded-lg file:border-0 file:bg-tenant file:px-3 file:py-2 file:text-sm file:font-semibold file:text-tenant-foreground" />
        </label>
        <p className="mt-3 text-xs text-ink-500">Ou cole o conteúdo do CSV:</p>
        <textarea value={texto} onChange={(e) => processar(e.target.value)} rows={6} placeholder={COLUNAS} className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 font-mono text-xs text-ink-100 placeholder:text-ink-500 focus:border-tenant focus:outline-none" />

        {erros.length > 0 && (
          <div className="mt-3 max-h-28 overflow-y-auto rounded-lg border border-red-900 bg-red-500/10 p-3 text-xs text-red-400">
            {erros.map((e) => (
              <p key={e}>{e}</p>
            ))}
          </div>
        )}
        {clientes.length > 0 && <p className="mt-3 text-sm text-tenant">{clientes.length} cliente(s) prontos para importar.</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
            Cancelar
          </button>
          <button onClick={importar} disabled={clientes.length === 0 || importando} className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
            {importando ? 'Importando…' : `Importar ${clientes.length} cliente(s)`}
          </button>
        </div>
      </div>
    </ModalFundo>
  );
}
