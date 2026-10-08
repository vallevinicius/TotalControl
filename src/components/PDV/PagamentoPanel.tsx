import type { FormaPagamento } from '@/types';
import { useTenant } from '@/contexts/TenantContext';
import { formatarMoeda } from '@/utils/formatters';
import { MAX_PARCELAS, PARCELAS_SEM_JUROS, type EstadoPagamento, type LinhaPagamento, type ResultadoPagamento } from './pagamento';

const FORMAS: Array<{ valor: FormaPagamento; rotulo: string }> = [
  { valor: 'PIX', rotulo: 'Pix' },
  { valor: 'CARTAO_CREDITO', rotulo: 'Cartão de Crédito' },
  { valor: 'CARTAO_DEBITO', rotulo: 'Cartão de Débito' },
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
];

const CAMPO = 'rounded-lg border border-ink-600 bg-ink-700 px-2.5 py-2 text-xs text-ink-100 focus:border-tenant focus:outline-none';
const SEM_SPINNER = '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

function SeletorParcelas({ valor, aoMudar }: { valor: number; aoMudar: (n: number) => void }) {
  return (
    <select value={valor} onChange={(e) => aoMudar(Number(e.target.value))} aria-label="Parcelas" className={CAMPO}>
      {Array.from({ length: MAX_PARCELAS }, (_, i) => i + 1).map((n) => (
        <option key={n} value={n}>
          {n}x {n <= PARCELAS_SEM_JUROS ? (n === 1 ? '' : 'sem juros') : 'com juros'}
        </option>
      ))}
    </select>
  );
}

let contadorDeLinhas = 0;
const novaLinha = (forma: FormaPagamento, valor: number): LinhaPagamento => ({ id: `l${++contadorDeLinhas}`, forma, valor, parcelas: 1 });

interface Props {
  estado: EstadoPagamento;
  aoMudar: (e: EstadoPagamento) => void;
  /** Valor da venda já com o desconto (o que as formas precisam cobrir). */
  subtotalComDesconto: number;
  resultado: ResultadoPagamento;
}

/** Escolha da forma de pagamento: uma só (padrão) ou dividida entre várias. */
export function PagamentoPanel({ estado, aoMudar, subtotalComDesconto, resultado }: Props) {
  const { tenant } = useTenant();
  const moeda = (v: number) => formatarMoeda(v, tenant);

  function ativarDivisao() {
    // Começa com a forma que já estava escolhida cobrindo tudo; a pessoa reparte a partir daí.
    aoMudar({ ...estado, dividido: true, linhas: [{ ...novaLinha(estado.forma, subtotalComDesconto), parcelas: estado.parcelas }] });
  }

  function mudarLinha(id: string, parte: Partial<LinhaPagamento>) {
    aoMudar({ ...estado, linhas: estado.linhas.map((l) => (l.id === id ? { ...l, ...parte } : l)) });
  }

  function adicionarLinha() {
    const usadas = estado.linhas.map((l) => l.forma);
    const forma = FORMAS.find((f) => !usadas.includes(f.valor))?.valor ?? 'PIX';
    aoMudar({ ...estado, linhas: [...estado.linhas, novaLinha(forma, Math.max(0, resultado.restante))] });
  }

  return (
    <div className="mt-6">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-ink-400">Forma de pagamento</p>
        <button
          type="button"
          onClick={() => (estado.dividido ? aoMudar({ ...estado, dividido: false, forma: estado.linhas[0]?.forma ?? estado.forma, parcelas: estado.linhas[0]?.parcelas ?? estado.parcelas }) : ativarDivisao())}
          className="text-xs font-medium text-tenant hover:underline"
        >
          {estado.dividido ? 'Usar uma forma só' : 'Dividir em mais de uma forma'}
        </button>
      </div>

      {!estado.dividido ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {FORMAS.map((forma) => (
              <button
                key={forma.valor}
                type="button"
                onClick={() => aoMudar({ ...estado, forma: forma.valor, parcelas: forma.valor === 'CARTAO_CREDITO' ? estado.parcelas : 1 })}
                className={['rounded-lg border px-3 py-2 text-xs font-medium transition-colors', estado.forma === forma.valor ? 'border-tenant bg-tenant-soft text-tenant' : 'border-ink-600 text-ink-300 hover:border-ink-500'].join(' ')}
              >
                {forma.rotulo}
              </button>
            ))}
          </div>
          {estado.forma === 'CARTAO_CREDITO' && (
            <div className="mt-3 flex items-center gap-3">
              <span className="text-xs text-ink-400">Parcelas</span>
              <SeletorParcelas valor={estado.parcelas} aoMudar={(n) => aoMudar({ ...estado, parcelas: n })} />
              {estado.parcelas > 1 && <span className="text-xs text-ink-400">{estado.parcelas}x de {moeda(resultado.total / estado.parcelas)}</span>}
            </div>
          )}
        </>
      ) : (
        <div className="space-y-2">
          {estado.linhas.map((l) => (
            <div key={l.id} className="rounded-lg border border-ink-700 bg-ink-800/60 p-2.5">
              <div className="flex items-center gap-2">
                <select value={l.forma} onChange={(e) => mudarLinha(l.id, { forma: e.target.value as FormaPagamento, parcelas: 1 })} aria-label="Forma" className={`${CAMPO} min-w-0 flex-1`}>
                  {FORMAS.map((f) => (
                    <option key={f.valor} value={f.valor}>
                      {f.rotulo}
                    </option>
                  ))}
                </select>
                <div className="flex w-28 items-center rounded-lg border border-ink-600 bg-ink-700 px-2 py-1.5">
                  <span className="text-xs text-ink-400">R$</span>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={l.valor === 0 ? '' : l.valor}
                    onChange={(e) => mudarLinha(l.id, { valor: Math.max(0, Number(e.target.value) || 0) })}
                    aria-label={`Valor em ${l.forma}`}
                    className={`ml-1 w-full bg-transparent text-right font-mono text-xs text-ink-100 outline-none ${SEM_SPINNER}`}
                  />
                </div>
                {estado.linhas.length > 1 && (
                  <button type="button" onClick={() => aoMudar({ ...estado, linhas: estado.linhas.filter((x) => x.id !== l.id) })} aria-label="Remover forma" className="text-ink-500 hover:text-red-400">
                    ✕
                  </button>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between">
                {l.forma === 'CARTAO_CREDITO' ? (
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] text-ink-400">Parcelas</span>
                    <SeletorParcelas valor={l.parcelas} aoMudar={(n) => mudarLinha(l.id, { parcelas: n })} />
                  </div>
                ) : (
                  <span />
                )}
                {resultado.restante > 0.004 && (
                  <button type="button" onClick={() => mudarLinha(l.id, { valor: Math.round((l.valor + resultado.restante) * 100) / 100 })} className="text-[11px] font-medium text-tenant hover:underline">
                    Completar com o restante
                  </button>
                )}
              </div>
            </div>
          ))}
          {estado.linhas.length < 5 && (
            <button type="button" onClick={adicionarLinha} className="w-full rounded-lg border border-dashed border-ink-600 py-1.5 text-xs font-medium text-ink-300 hover:border-tenant hover:text-tenant">
              + Adicionar forma
            </button>
          )}
          <p className={['text-right text-xs font-medium', resultado.valido ? 'text-emerald-400' : 'text-amber-400'].join(' ')}>
            {resultado.valido ? 'Pagamento fechado com o valor da venda' : resultado.problema}
          </p>
        </div>
      )}
    </div>
  );
}
