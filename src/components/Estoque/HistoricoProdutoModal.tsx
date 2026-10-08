import { useEffect, useState } from 'react';
import { LoadingState } from '@/components/Common/LoadingState';
import { Paginacao } from '@/components/Common/Paginacao';
import { ModalFundo } from '@/components/Admin/AdminModais';
import { getMovimentacoesDoProduto } from '@/services/apiService';
import type { MovimentacaoEstoque, PaginaResultado, Produto, TipoMovimentacaoEstoque } from '@/types';

const ROTULOS: Record<TipoMovimentacaoEstoque, string> = {
  INICIAL: 'Cadastro',
  ENTRADA: 'Entrada',
  VENDA: 'Venda',
  ESTORNO: 'Venda desfeita',
  AJUSTE: 'Ajuste',
};

/** Linha do tempo do saldo do produto: o que entrou, saiu e por quê. */
export function HistoricoProdutoModal({ produto, aoFechar }: { produto: Produto; aoFechar: () => void }) {
  const [pagina, setPagina] = useState(1);
  const [dados, setDados] = useState<PaginaResultado<MovimentacaoEstoque> | null>(null);
  const [erro, setErro] = useState(false);

  useEffect(() => {
    setDados(null);
    getMovimentacoesDoProduto(produto.id, pagina).then(setDados).catch(() => setErro(true));
  }, [produto.id, pagina]);

  return (
    <ModalFundo onFechar={aoFechar}>
      <div className="flex max-h-[88vh] w-full max-w-xl flex-col rounded-xl border border-ink-700 bg-ink-800">
        <div className="border-b border-ink-700 px-6 py-4">
          <p className="font-display text-lg font-semibold text-ink-100">Histórico de estoque</p>
          <p className="text-sm text-ink-400">
            {produto.nome} · saldo atual <span className="font-mono text-ink-100">{produto.quantidadeEmEstoque}</span>
          </p>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {erro ? (
            <p className="py-6 text-center text-sm text-red-400">Não foi possível carregar o histórico.</p>
          ) : !dados ? (
            <LoadingState mensagem="Carregando…" />
          ) : dados.itens.length === 0 ? (
            <p className="py-6 text-center text-sm text-ink-400">Ainda não há movimentações registradas. O histórico começa a partir de agora.</p>
          ) : (
            <ul className="divide-y divide-ink-700">
              {dados.itens.map((m) => (
                <li key={m.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                  <div className="min-w-0">
                    <p className="text-ink-100">
                      {ROTULOS[m.tipo]}
                      {m.motivo && <span className="text-ink-400">: {m.motivo}</span>}
                    </p>
                    <p className="text-xs text-ink-500">
                      {new Date(m.criadoEm).toLocaleString('pt-BR')}
                      {m.usuarioNome ? ` · ${m.usuarioNome}` : ''}
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className={['font-mono font-semibold', m.quantidade > 0 ? 'text-emerald-400' : 'text-red-400'].join(' ')}>
                      {m.quantidade > 0 ? '+' : ''}
                      {m.quantidade}
                    </p>
                    <p className="font-mono text-xs text-ink-500">saldo {m.saldoApos}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {dados && dados.totalPaginas > 1 && <Paginacao pagina={pagina} totalPaginas={dados.totalPaginas} total={dados.total} aoMudarPagina={setPagina} />}
        </div>
        <div className="flex justify-end border-t border-ink-700 px-6 py-3">
          <button onClick={aoFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
            Fechar
          </button>
        </div>
      </div>
    </ModalFundo>
  );
}
