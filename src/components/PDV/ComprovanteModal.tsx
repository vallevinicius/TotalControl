import { useState } from 'react';
import { useTenant } from '@/contexts/TenantContext';
import { formatarMoeda, formatarFormaPagamento } from '@/utils/formatters';
import { imprimir } from '@/utils/imprimir';
import type { FormaPagamento } from '@/types';

export interface DadosComprovante {
  id: string;
  timestamp: string;
  itens: Array<{ nome: string; quantidade: number; valorUnitario: number; subtotal: number }>;
  desconto: number;
  taxas: number;
  total: number;
  formaPagamento?: FormaPagamento;
  parcelas?: number;
  /** Venda dividida: cada forma com o valor que cobriu. */
  pagamentos?: Array<{ forma: FormaPagamento; valor: number; parcelas: number }>;
  /** Só para pagamento em dinheiro. */
  valorRecebido?: number;
  troco?: number;
  clienteNome?: string;
  clienteTelefone?: string;
  vendedorNome?: string;
}

/** Telefone só com dígitos e DDI 55 (formato do link wa.me); null se não parece telefone. */
function telefoneParaWhatsapp(telefone?: string): string | null {
  const d = (telefone ?? '').replace(/\D/g, '');
  if (d.length === 10 || d.length === 11) return `55${d}`;
  if ((d.length === 12 || d.length === 13) && d.startsWith('55')) return d;
  return null;
}

/** Comprovante da venda: imprime (bobina de 80 mm ou A4) ou envia por WhatsApp.
 * Não é documento fiscal, e o próprio comprovante avisa isso. */
export function ComprovanteModal({ dados, aoFechar }: { dados: DadosComprovante; aoFechar: () => void }) {
  const { tenant } = useTenant();
  const [telefone, setTelefone] = useState(dados.clienteTelefone ?? '');
  const moeda = (v: number) => formatarMoeda(v, tenant);
  const e = tenant?.endereco;
  const endereco = [[e?.logradouro, e?.numero].filter(Boolean).join(', '), e?.bairro, [e?.cidade, e?.uf].filter(Boolean).join(' / ')]
    .filter(Boolean)
    .join(' - ');
  const subtotal = dados.itens.reduce((acc, i) => acc + i.subtotal, 0);
  const quando = new Date(dados.timestamp).toLocaleString('pt-BR');
  const forma = dados.formaPagamento ? formatarFormaPagamento(dados.formaPagamento) : '';

  function textoWhatsapp(): string {
    const linhas = [
      `*${tenant?.nomeFantasia ?? 'Comprovante'}*`,
      quando,
      '',
      ...dados.itens.map((i) => `${i.quantidade}x ${i.nome}  ${moeda(i.subtotal)}`),
      '',
      dados.desconto > 0 ? `Desconto: -${moeda(dados.desconto)}` : '',
      dados.taxas > 0 ? `Juros do cartão: ${moeda(dados.taxas)}` : '',
      `*Total: ${moeda(dados.total)}*`,
      ...(dados.pagamentos && dados.pagamentos.length > 1
        ? dados.pagamentos.map((p) => `${formatarFormaPagamento(p.forma)}${p.parcelas > 1 ? ` ${p.parcelas}x` : ''}: ${moeda(p.valor)}`)
        : [forma ? `Pagamento: ${forma}${dados.parcelas && dados.parcelas > 1 ? ` em ${dados.parcelas}x` : ''}` : '']),
      dados.troco && dados.troco > 0 ? `Troco: ${moeda(dados.troco)}` : '',
      '',
      'Obrigado pela preferência!',
    ];
    return linhas.filter((l, i) => l !== '' || linhas[i - 1] !== '').join('\n');
  }

  const numeroWhatsapp = telefoneParaWhatsapp(telefone);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 print:static print:bg-transparent print:p-0" role="dialog" aria-modal="true">
      <div className="flex max-h-[92vh] w-full max-w-sm flex-col rounded-xl border border-ink-700 bg-ink-800 print:max-h-none print:border-0 print:bg-transparent">
        <div className="border-b border-ink-700 px-5 py-4 print:hidden">
          <p className="font-display text-lg font-semibold text-ink-100">Venda concluída</p>
          <p className="text-sm text-ink-400">Entregue o comprovante ao cliente.</p>
        </div>

        <div className="flex-1 overflow-y-auto p-5 print:overflow-visible print:p-0">
          {/* Papel: fundo claro de propósito (é o que sai na impressora). */}
          <div className="comprovante-impressao rounded-lg bg-white p-4 font-mono text-[12px] leading-relaxed text-black shadow-inner">
            <p className="text-center text-sm font-bold">{tenant?.nomeFantasia}</p>
            {tenant?.razaoSocial && <p className="text-center">{tenant.razaoSocial}</p>}
            {tenant?.cnpj && <p className="text-center">CNPJ {tenant.cnpj}</p>}
            {endereco && <p className="text-center">{endereco}</p>}
            {tenant?.telefone && <p className="text-center">Tel. {tenant.telefone}</p>}
            <p className="my-2 border-t border-dashed border-black" />
            <p>{quando}</p>
            {dados.clienteNome && <p>Cliente: {dados.clienteNome}</p>}
            {dados.vendedorNome && <p>Vendedor: {dados.vendedorNome}</p>}
            <p className="my-2 border-t border-dashed border-black" />
            {dados.itens.map((i, idx) => (
              <div key={idx} className="mb-1">
                <p>{i.nome}</p>
                <p className="flex justify-between">
                  <span>
                    {i.quantidade} x {moeda(i.valorUnitario)}
                  </span>
                  <span>{moeda(i.subtotal)}</span>
                </p>
              </div>
            ))}
            <p className="my-2 border-t border-dashed border-black" />
            <p className="flex justify-between">
              <span>Subtotal</span>
              <span>{moeda(subtotal)}</span>
            </p>
            {dados.desconto > 0 && (
              <p className="flex justify-between">
                <span>Desconto</span>
                <span>-{moeda(dados.desconto)}</span>
              </p>
            )}
            {dados.taxas > 0 && (
              <p className="flex justify-between">
                <span>Juros do cartão</span>
                <span>{moeda(dados.taxas)}</span>
              </p>
            )}
            <p className="flex justify-between text-sm font-bold">
              <span>TOTAL</span>
              <span>{moeda(dados.total)}</span>
            </p>
            {dados.pagamentos && dados.pagamentos.length > 1 ? (
              dados.pagamentos.map((p, i) => (
                <p key={i} className="flex justify-between">
                  <span>
                    {formatarFormaPagamento(p.forma)}
                    {p.parcelas > 1 ? ` ${p.parcelas}x` : ''}
                  </span>
                  <span>{moeda(p.valor)}</span>
                </p>
              ))
            ) : (
              forma && (
                <p className="flex justify-between">
                  <span>Pagamento</span>
                  <span>
                    {forma}
                    {dados.parcelas && dados.parcelas > 1 ? ` ${dados.parcelas}x` : ''}
                  </span>
                </p>
              )
            )}
            {dados.valorRecebido !== undefined && dados.valorRecebido > 0 && (
              <>
                <p className="flex justify-between">
                  <span>Recebido</span>
                  <span>{moeda(dados.valorRecebido)}</span>
                </p>
                <p className="flex justify-between">
                  <span>Troco</span>
                  <span>{moeda(dados.troco ?? 0)}</span>
                </p>
              </>
            )}
            <p className="my-2 border-t border-dashed border-black" />
            <p className="text-center">Obrigado pela preferência!</p>
            <p className="mt-1 text-center text-[10px]">Documento sem valor fiscal</p>
          </div>
        </div>

        <div className="space-y-3 border-t border-ink-700 px-5 py-4 print:hidden">
          <div className="flex gap-2">
            <input
              value={telefone}
              onChange={(ev) => setTelefone(ev.target.value)}
              placeholder="WhatsApp do cliente (com DDD)"
              inputMode="tel"
              className="min-w-0 flex-1 rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-tenant focus:outline-none"
            />
            <a
              href={numeroWhatsapp ? `https://wa.me/${numeroWhatsapp}?text=${encodeURIComponent(textoWhatsapp())}` : undefined}
              target="_blank"
              rel="noopener noreferrer"
              aria-disabled={!numeroWhatsapp}
              className={[
                'rounded-lg border px-3 py-2 text-sm font-medium',
                numeroWhatsapp ? 'border-tenant text-tenant hover:bg-tenant-soft' : 'pointer-events-none border-ink-600 text-ink-500 opacity-50',
              ].join(' ')}
            >
              Enviar
            </a>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={() => imprimir('comprovante')} className="rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-200 hover:border-tenant hover:text-tenant">
              Imprimir
            </button>
            <button onClick={aoFechar} autoFocus className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90">
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
