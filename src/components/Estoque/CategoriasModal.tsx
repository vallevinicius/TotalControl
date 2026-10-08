import { useState } from 'react';
import { ModalFundo } from '@/components/Admin/AdminModais';
import { useConfirm } from '@/contexts/ConfirmContext';
import { useToast } from '@/contexts/ToastContext';
import { createCategoria, excluirCategoria, renomearCategoria } from '@/services/apiService';
import type { Categoria } from '@/types';

/** Criar, renomear e excluir categorias. Excluir só funciona para categoria sem produtos. */
export function CategoriasModal({ categorias, aoMudar, aoFechar }: { categorias: Categoria[]; aoMudar: (lista: Categoria[]) => void; aoFechar: () => void }) {
  const toast = useToast();
  const confirmar = useConfirm();
  const [editandoId, setEditandoId] = useState<string | null>(null);
  const [nomeEdicao, setNomeEdicao] = useState('');
  const [novoNome, setNovoNome] = useState('');
  const campo = 'rounded-lg border border-ink-600 bg-ink-700 px-3 py-1.5 text-sm text-ink-100 focus:border-tenant focus:outline-none';

  async function criar() {
    const nome = novoNome.trim();
    if (!nome) return;
    try {
      const nova = await createCategoria(nome);
      aoMudar([...categorias, nova].sort((a, b) => a.nome.localeCompare(b.nome)));
      setNovoNome('');
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao criar a categoria.');
    }
  }

  async function salvar(c: Categoria) {
    const nome = nomeEdicao.trim();
    if (!nome || nome === c.nome) return setEditandoId(null);
    try {
      const atualizada = await renomearCategoria(c.id, nome);
      aoMudar(categorias.map((x) => (x.id === c.id ? { ...x, nome: atualizada.nome } : x)).sort((a, b) => a.nome.localeCompare(b.nome)));
      setEditandoId(null);
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao renomear.');
    }
  }

  async function excluir(c: Categoria) {
    const ok = await confirmar({ titulo: `Excluir a categoria "${c.nome}"?`, textoConfirmar: 'Excluir', perigoso: true });
    if (!ok) return;
    try {
      await excluirCategoria(c.id);
      aoMudar(categorias.filter((x) => x.id !== c.id));
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao excluir.');
    }
  }

  return (
    <ModalFundo onFechar={aoFechar}>
      <div className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-ink-700 bg-ink-800">
        <div className="border-b border-ink-700 px-6 py-4">
          <p className="font-display text-lg font-semibold text-ink-100">Categorias</p>
          <p className="text-sm text-ink-400">Só dá para excluir uma categoria que não tenha produtos.</p>
        </div>
        <ul className="flex-1 divide-y divide-ink-700 overflow-y-auto px-6">
          {categorias.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2.5">
              {editandoId === c.id ? (
                <input
                  autoFocus
                  value={nomeEdicao}
                  onChange={(e) => setNomeEdicao(e.target.value)}
                  onKeyDown={(e) => (e.key === 'Enter' ? salvar(c) : e.key === 'Escape' ? setEditandoId(null) : undefined)}
                  className={`${campo} min-w-0 flex-1`}
                />
              ) : (
                <span className="min-w-0 flex-1 truncate text-sm text-ink-100">{c.nome}</span>
              )}
              <div className="flex shrink-0 gap-1 text-xs">
                {editandoId === c.id ? (
                  <button onClick={() => salvar(c)} className="rounded-md px-2 py-1 font-medium text-tenant hover:bg-tenant-soft">
                    Salvar
                  </button>
                ) : (
                  <button onClick={() => { setEditandoId(c.id); setNomeEdicao(c.nome); }} className="rounded-md px-2 py-1 text-ink-300 hover:bg-ink-700 hover:text-ink-100">
                    Renomear
                  </button>
                )}
                <button onClick={() => excluir(c)} className="rounded-md px-2 py-1 text-red-400 hover:bg-red-500/10">
                  Excluir
                </button>
              </div>
            </li>
          ))}
          {categorias.length === 0 && <li className="py-6 text-center text-sm text-ink-500">Nenhuma categoria ainda.</li>}
        </ul>
        <div className="border-t border-ink-700 px-6 py-4">
          <div className="flex gap-2">
            <input value={novoNome} onChange={(e) => setNovoNome(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && criar()} placeholder="Nova categoria…" className={`${campo} min-w-0 flex-1`} />
            <button onClick={criar} disabled={!novoNome.trim()} className="rounded-lg bg-tenant px-4 py-1.5 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:opacity-40">
              Criar
            </button>
          </div>
          <div className="mt-3 flex justify-end">
            <button onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
              Fechar
            </button>
          </div>
        </div>
      </div>
    </ModalFundo>
  );
}
