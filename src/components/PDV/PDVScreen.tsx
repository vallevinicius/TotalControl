import { useEffect, useMemo, useRef, useState } from 'react';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import {
  searchProducts,
  registerSale,
  getClientes,
  getVendedores,
  getCaixaAtual,
  abrirCaixa,
  fecharCaixa,
  getHistoricoCaixas,
  getVendasDoCaixa,
  desfazerUltimaVenda,
} from '@/services/apiService';
import { formatarMoeda, formatarHora, formatarFormaPagamento } from '@/utils/formatters';
import { AbrirCaixaCard } from './AbrirCaixaCard';
import { FecharCaixaModal } from './FecharCaixaModal';
import { ComprovanteModal, type DadosComprovante } from './ComprovanteModal';
import type { Caixa, Cliente, FormaPagamento, Produto, Vendedor, VendaResumo } from '@/types';

interface ItemCarrinho {
  produto: Produto;
  quantidade: number;
  precoUnitario: number;
}

const formasPagamento: Array<{ valor: FormaPagamento; rotulo: string }> = [
  { valor: 'PIX', rotulo: 'Pix' },
  { valor: 'CARTAO_CREDITO', rotulo: 'Cartão de Crédito' },
  { valor: 'CARTAO_DEBITO', rotulo: 'Cartão de Débito' },
  { valor: 'DINHEIRO', rotulo: 'Dinheiro' },
];

const TAXA_CARTAO_CREDITO = 0.05;
const PARCELAS_DISPONIVEIS = [1, 2, 3];

// Classe utilitária pra tirar as setinhas nativas do <input type="number">
// em todos os navegadores — é isso que deixava o campo de desconto feio.
const SEM_SPINNER_NATIVO =
  '[appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

/**
 * Tela de Frente de Caixa (PDV):
 * - Exige um caixa ABERTO pra vender — sem isso, mostra só a tela de abrir
 *   caixa. Cada abertura começa um turno novo, com totais zerados; ao
 *   fechar, o turno vira histórico e um novo pode ser aberto depois (outro
 *   dia, por exemplo) já começando do zero.
 * - As vendas continuam gravadas pra sempre e aparecem em Relatórios
 *   independente do caixa estar aberto ou fechado — fechar o caixa só
 *   encerra o turno, não apaga nada.
 * - Busca produto por nome/SKU, adiciona ao carrinho com preço ajustável.
 * - Desconto em % sobre o subtotal.
 * - Cartão de crédito soma 5% de taxa e permite parcelar em até 3x.
 * - Permite vincular um cliente (opcional).
 */
export function PDVScreen() {
  const { tenant, usuarioAtual } = useTenant();
  // Mesma política que o servidor aplica (server/src/config/planos.ts): a tela só
  // evita o erro, quem garante a regra é a API.
  const podeAlterarPreco = usuarioAtual?.papel !== 'OPERADOR_CAIXA';
  const descontoMaximo = usuarioAtual?.papel === 'OPERADOR_CAIXA' ? 5 : usuarioAtual?.papel === 'GERENTE' ? 20 : 100;
  const toast = useToast();

  const [caixa, setCaixa] = useState<Caixa | null>(null);
  const [carregandoCaixa, setCarregandoCaixa] = useState(true);
  const [historicoCaixas, setHistoricoCaixas] = useState<Caixa[]>([]);
  const [carregandoHistorico, setCarregandoHistorico] = useState(true);
  const [mostrarFecharCaixa, setMostrarFecharCaixa] = useState(false);

  const [vendasDoCaixa, setVendasDoCaixa] = useState<VendaResumo[]>([]);
  const [carregandoVendas, setCarregandoVendas] = useState(true);
  const [mostrarNovaVenda, setMostrarNovaVenda] = useState(false);

  const [termoBusca, setTermoBusca] = useState('');
  const [resultados, setResultados] = useState<Produto[]>([]);
  const [carrinho, setCarrinho] = useState<ItemCarrinho[]>([]);
  const [formaPagamento, setFormaPagamento] = useState<FormaPagamento>('PIX');
  const [descontoPercentual, setDescontoPercentual] = useState<number>(0);
  const [parcelas, setParcelas] = useState<number>(1);
  const [processando, setProcessando] = useState(false);
  // Dinheiro: quanto o cliente entregou (pra calcular o troco). Vazio = não informado.
  const [valorRecebido, setValorRecebido] = useState<number>(0);
  const [comprovante, setComprovante] = useState<DadosComprovante | null>(null);

  const [termoCliente, setTermoCliente] = useState('');
  const [resultadosClientes, setResultadosClientes] = useState<Cliente[]>([]);
  const [clienteSelecionado, setClienteSelecionado] = useState<Cliente | null>(null);

  const [vendedores, setVendedores] = useState<Vendedor[]>([]);
  const [vendedorId, setVendedorId] = useState<string>('');
  const [desfazendo, setDesfazendo] = useState(false);
  const inputBuscaRef = useRef<HTMLInputElement>(null);

  async function carregarVendasDoCaixa(caixaId: string) {
    setCarregandoVendas(true);
    try {
      setVendasDoCaixa(await getVendasDoCaixa(caixaId));
    } finally {
      setCarregandoVendas(false);
    }
  }

  async function carregarCaixa() {
    setCarregandoCaixa(true);
    try {
      const atual = await getCaixaAtual();
      setCaixa(atual);
      if (atual) await carregarVendasDoCaixa(atual.id);
    } finally {
      setCarregandoCaixa(false);
    }
  }

  async function carregarHistorico() {
    setCarregandoHistorico(true);
    try {
      setHistoricoCaixas(await getHistoricoCaixas());
    } finally {
      setCarregandoHistorico(false);
    }
  }

  useEffect(() => {
    carregarCaixa();
    carregarHistorico();
    getVendedores()
      .then((lista) => setVendedores(lista.filter((v) => v.ativo)))
      .catch(() => setVendedores([])); // módulo pode estar bloqueado pelo plano
  }, []);

  useEffect(() => {
    const termo = termoBusca.trim();
    if (termo.length === 0) {
      setResultados([]);
      return;
    }
    let cancelado = false;
    searchProducts(termo).then((resultado) => {
      if (!cancelado) setResultados(resultado.itens);
    });
    return () => {
      cancelado = true;
    };
  }, [termoBusca]);

  useEffect(() => {
    const termo = termoCliente.trim();
    if (termo.length === 0) {
      setResultadosClientes([]);
      return;
    }
    let cancelado = false;
    getClientes(termo).then((resultado) => {
      if (!cancelado) setResultadosClientes(resultado.itens);
    });
    return () => {
      cancelado = true;
    };
  }, [termoCliente]);

  async function handleAbrirCaixa(valorAbertura: number, senha?: string) {
    try {
      await abrirCaixa(valorAbertura, senha);
      toast.sucesso('Caixa aberto.');
      await carregarCaixa();
      await carregarHistorico();
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao abrir caixa.');
    }
  }

  async function handleFecharCaixa(valorContado?: number, observacao?: string) {
    if (!caixa) return;
    // O próprio FecharCaixaModal já mostra o resumo e exige um clique
    // explícito de confirmação — não precisa de outro "tem certeza?" em
    // cima disso.
    try {
      await fecharCaixa(caixa.id, { valorContado, observacao });
      toast.sucesso('Caixa fechado.');
      setMostrarFecharCaixa(false);
      await carregarCaixa();
      await carregarHistorico();
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao fechar caixa.');
    }
  }

  function adicionarAoCarrinho(produto: Produto) {
    setCarrinho((atual) => {
      const existente = atual.find((i) => i.produto.id === produto.id);
      if (existente) {
        return atual.map((i) => (i.produto.id === produto.id ? { ...i, quantidade: i.quantidade + 1 } : i));
      }
      return [...atual, { produto, quantidade: 1, precoUnitario: produto.precoVenda }];
    });
    setTermoBusca('');
    setResultados([]);
  }

  function alterarQuantidade(productId: string, quantidade: number) {
    if (quantidade <= 0) {
      setCarrinho((atual) => atual.filter((i) => i.produto.id !== productId));
      return;
    }
    setCarrinho((atual) => atual.map((i) => (i.produto.id === productId ? { ...i, quantidade } : i)));
  }

  function alterarPrecoItem(productId: string, precoUnitario: number) {
    setCarrinho((atual) => atual.map((i) => (i.produto.id === productId ? { ...i, precoUnitario: Math.max(0, precoUnitario) } : i)));
  }

  function removerDoCarrinho(productId: string) {
    setCarrinho((atual) => atual.filter((i) => i.produto.id !== productId));
  }

  function cancelarNovaVenda() {
    setCarrinho([]);
    setTermoBusca('');
    setResultados([]);
    setDescontoPercentual(0);
    setParcelas(1);
    setValorRecebido(0);
    setClienteSelecionado(null);
    setTermoCliente('');
    setMostrarNovaVenda(false);
  }

  function handleMudarFormaPagamento(forma: FormaPagamento) {
    setFormaPagamento(forma);
    if (forma !== 'CARTAO_CREDITO') setParcelas(1);
    if (forma !== 'DINHEIRO') setValorRecebido(0);
  }

  const subtotal = useMemo(
    () => carrinho.reduce((acc, i) => acc + i.precoUnitario * i.quantidade, 0),
    [carrinho],
  );
  const valorDesconto = Number(((subtotal * descontoPercentual) / 100).toFixed(2));
  const subtotalComDesconto = Math.max(0, subtotal - valorDesconto);
  const ehCartaoCredito = formaPagamento === 'CARTAO_CREDITO';
  const valorTaxaCartao = ehCartaoCredito ? Number((subtotalComDesconto * TAXA_CARTAO_CREDITO).toFixed(2)) : 0;
  const totalFinal = subtotalComDesconto + valorTaxaCartao;
  const ehDinheiro = formaPagamento === 'DINHEIRO';
  const recebidoInformado = ehDinheiro && valorRecebido > 0;
  const troco = recebidoInformado ? Number((valorRecebido - totalFinal).toFixed(2)) : 0;
  // Se informou o valor recebido, ele precisa cobrir o total (senão falta dinheiro).
  const recebidoInsuficiente = recebidoInformado && troco < 0;

  const vendedorObrigatorioFaltando = vendedores.length > 0 && !vendedorId;

  async function finalizarVenda() {
    if (carrinho.length === 0 || vendedorObrigatorioFaltando || recebidoInsuficiente) return;
    setProcessando(true);
    try {
      const venda = await registerSale({
        itens: carrinho.map((i) => ({
          productId: i.produto.id,
          quantidade: i.quantidade,
          precoUnitario: i.precoUnitario,
        })),
        desconto: valorDesconto,
        taxas: valorTaxaCartao,
        parcelas: ehCartaoCredito ? parcelas : 1,
        formaPagamento,
        clienteId: clienteSelecionado?.id,
        vendedorId: vendedorId || undefined,
      });
      toast.sucesso(`Venda finalizada às ${new Date().toLocaleTimeString('pt-BR')}.`);
      // Comprovante da venda que acabou de sair (com troco, se foi em dinheiro).
      setComprovante({
        id: venda.id,
        timestamp: venda.timestamp,
        itens: venda.itens.map((i) => ({ nome: i.nomeProdutoSnapshot, quantidade: i.quantidade, valorUnitario: i.valorUnitarioPraticado, subtotal: i.subtotal })),
        desconto: venda.desconto,
        taxas: venda.taxas,
        total: venda.valorTotal,
        formaPagamento: venda.formaPagamento,
        parcelas: venda.parcelas,
        valorRecebido: recebidoInformado ? valorRecebido : undefined,
        troco: recebidoInformado ? troco : undefined,
        clienteNome: clienteSelecionado?.nome,
        clienteTelefone: clienteSelecionado?.telefone,
        vendedorNome: vendedores.find((v) => v.id === vendedorId)?.nome,
      });
      setCarrinho([]);
      setDescontoPercentual(0);
      setParcelas(1);
      setValorRecebido(0);
      setClienteSelecionado(null);
      setTermoCliente('');
      setMostrarNovaVenda(false);
      carregarCaixa();
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao finalizar venda.');
    } finally {
      setProcessando(false);
    }
  }

  async function handleDesfazerUltimaVenda() {
    setDesfazendo(true);
    try {
      await desfazerUltimaVenda();
      toast.sucesso('Última venda desfeita, estoque devolvido.');
      await carregarCaixa();
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao desfazer a venda.');
    } finally {
      setDesfazendo(false);
    }
  }

  // finalizarVenda lê bastante estado (carrinho, cliente, forma de
  // pagamento...) — guardar a versão mais atual numa ref evita que o atalho
  // de teclado abaixo dispare uma versão desatualizada da função.
  const finalizarVendaRef = useRef(finalizarVenda);
  useEffect(() => {
    finalizarVendaRef.current = finalizarVenda;
  });

  // Atalhos de teclado: F2 foca a busca de produto, F4 finaliza a venda, Esc
  // volta pra lista de vendas do turno — só ativos durante uma nova venda.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if (!mostrarNovaVenda) return;
      if (e.key === 'F2') {
        e.preventDefault();
        inputBuscaRef.current?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        finalizarVendaRef.current();
      } else if (e.key === 'Escape') {
        cancelarNovaVenda();
      }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mostrarNovaVenda]);

  if (carregandoCaixa) {
    return (
      <AppLayout titulo="Caixa" subtitulo="Busque um produto, monte o carrinho e finalize a venda">
        <LoadingState mensagem="Verificando o caixa…" />
      </AppLayout>
    );
  }

  if (!caixa) {
    return (
      <AppLayout titulo="Caixa" subtitulo="Abra o caixa para começar a vender">
        <AbrirCaixaCard historico={historicoCaixas} carregandoHistorico={carregandoHistorico} aoAbrir={handleAbrirCaixa} />
      </AppLayout>
    );
  }

  return (
    <AppLayout
      titulo="Caixa"
      subtitulo={
        mostrarNovaVenda ? 'Busque um produto, monte o carrinho e finalize a venda' : 'Vendas feitas neste turno de caixa'
      }
    >
      <div className="mb-4 flex items-center justify-between rounded-xl border border-ink-700 bg-ink-800 px-5 py-3">
        <div className="text-sm">
          <span className="font-medium text-ink-100">Caixa aberto</span>
          <span className="text-ink-400">
            {' '}
            às {new Date(caixa.abertoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} por{' '}
            {caixa.abertoPorNome}
          </span>
        </div>
        <div className="flex items-center gap-4 text-sm">
          <span className="text-ink-400">
            {caixa.resumo.quantidadeVendas} venda(s) · <span className="font-mono text-ink-100">{formatarMoeda(caixa.resumo.totalVendido, tenant)}</span>
          </span>
          <button
            onClick={() => setMostrarFecharCaixa(true)}
            className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-red-400 hover:text-red-400"
          >
            Fechar caixa
          </button>
        </div>
      </div>

      {!mostrarNovaVenda ? (
        <div>
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-ink-200">Vendas de hoje</p>
              <p className="text-xs text-ink-500">{vendasDoCaixa.length} venda(s) neste turno</p>
            </div>
            <div className="flex gap-2">
              {vendasDoCaixa.length > 0 && (
                <button
                  onClick={handleDesfazerUltimaVenda}
                  disabled={desfazendo}
                  title="Só funciona até 5 minutos depois da venda"
                  className="rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-200 hover:border-red-400 hover:text-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {desfazendo ? 'Desfazendo…' : 'Desfazer última venda'}
                </button>
              )}
              <button
                onClick={() => setMostrarNovaVenda(true)}
                className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90"
              >
                + Nova venda
              </button>
            </div>
          </div>

          {carregandoVendas ? (
            <LoadingState mensagem="Carregando vendas…" />
          ) : vendasDoCaixa.length === 0 ? (
            <div className="rounded-xl border border-dashed border-ink-700 p-10 text-center">
              <p className="text-sm text-ink-400">Nenhuma venda neste turno ainda. Clique em "+ Nova venda" para começar.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-ink-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
                  <tr>
                    <th className="px-5 py-3 font-medium">Hora</th>
                    <th className="px-5 py-3 font-medium">Cliente</th>
                    <th className="px-5 py-3 font-medium">Vendedor</th>
                    <th className="px-5 py-3 font-medium">Forma de pagamento</th>
                    <th className="px-5 py-3 font-medium text-right">Itens</th>
                    <th className="px-5 py-3 font-medium text-right">Total</th>
                    <th className="px-5 py-3 font-medium text-right">Comprovante</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700 bg-ink-800/40">
                  {vendasDoCaixa.map((venda) => (
                    <tr key={venda.id} className="transition-colors hover:bg-ink-800">
                      <td className="px-5 py-3.5 text-ink-300">{formatarHora(venda.timestamp, tenant)}</td>
                      <td className="px-5 py-3.5 text-ink-300">{venda.clienteNome ?? '-'}</td>
                      <td className="px-5 py-3.5 text-ink-300">{venda.vendedorNome ?? '-'}</td>
                      <td className="px-5 py-3.5 text-ink-300">{formatarFormaPagamento(venda.formaPagamento)}</td>
                      <td className="px-5 py-3.5 text-right text-ink-300">{venda.quantidadeItens}</td>
                      <td className="px-5 py-3.5 text-right font-mono text-ink-100">
                        {formatarMoeda(venda.valorTotal, tenant)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        {venda.itens && (
                          <button
                            onClick={() =>
                              setComprovante({
                                id: venda.id,
                                timestamp: venda.timestamp,
                                itens: venda.itens!,
                                desconto: venda.desconto ?? 0,
                                taxas: venda.taxas ?? 0,
                                total: venda.valorTotal,
                                formaPagamento: venda.formaPagamento,
                                parcelas: venda.parcelas,
                                clienteNome: venda.clienteNome,
                                clienteTelefone: venda.clienteTelefone,
                                vendedorNome: venda.vendedorNome,
                              })
                            }
                            className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant"
                          >
                            Ver
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <>
          <button
            onClick={cancelarNovaVenda}
            className="mb-4 text-sm text-ink-400 hover:text-ink-100"
          >
            ← Voltar para as vendas do turno
          </button>

          <div className="grid h-[calc(100%-4rem)] grid-cols-[1fr_380px] gap-6">
        {/* Coluna de busca + resultados */}
        <section className="flex flex-col gap-4">
          <div className="relative">
            <input
              ref={inputBuscaRef}
              autoFocus
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              placeholder="Buscar produto por nome ou SKU… (F2)"
              className="w-full rounded-xl border border-ink-600 bg-ink-800 px-4 py-3.5 text-base text-ink-100 placeholder:text-ink-400 focus:border-tenant focus:outline-none focus:ring-2 focus:ring-tenant/30"
            />
          </div>

          {resultados.length > 0 && (
            <ul className="divide-y divide-ink-700 rounded-xl border border-ink-700 bg-ink-800">
              {resultados.map((produto) => (
                <li key={produto.id}>
                  <button
                    onClick={() => adicionarAoCarrinho(produto)}
                    disabled={produto.quantidadeEmEstoque === 0}
                    className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-ink-700 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <div>
                      <p className="text-sm font-medium text-ink-100">{produto.nome}</p>
                      <p className="text-xs text-ink-400">
                        SKU {produto.sku} · {produto.quantidadeEmEstoque} em estoque
                      </p>
                    </div>
                    <span className="font-mono text-sm text-tenant">{formatarMoeda(produto.precoVenda, tenant)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex-1 rounded-xl border border-dashed border-ink-700 p-6">
            <p className="mb-4 text-sm font-medium text-ink-200">Carrinho</p>
            {carrinho.length === 0 ? (
              <p className="text-sm text-ink-400">Nenhum item adicionado ainda. Use a busca acima.</p>
            ) : (
              <ul className="space-y-3">
                {carrinho.map((item) => (
                  <li key={item.produto.id} className="flex items-center justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink-100">{item.produto.nome}</p>
                      <div className="mt-1 flex items-center gap-1 text-xs text-ink-400">
                        <span>R$</span>
                        <input
                          type="number"
                          min={0}
                          step={0.01}
                          value={item.precoUnitario === 0 ? '' : item.precoUnitario}
                          disabled={!podeAlterarPreco}
                          title={podeAlterarPreco ? undefined : 'Só gerente ou administrador altera o preço'}
                          onChange={(e) => alterarPrecoItem(item.produto.id, Number(e.target.value) || 0)}
                          aria-label={`Preço unitário de ${item.produto.nome}`}
                          className={[
                            'w-16 rounded-md border border-ink-600 bg-ink-700 px-1.5 py-0.5 font-mono text-ink-100 focus:border-tenant focus:outline-none disabled:cursor-not-allowed disabled:opacity-60',
                            SEM_SPINNER_NATIVO,
                          ].join(' ')}
                        />
                        <span>/ un.</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => alterarQuantidade(item.produto.id, item.quantidade - 1)}
                        className="h-7 w-7 rounded-md bg-ink-700 text-ink-100 hover:bg-ink-600"
                        aria-label={`Diminuir quantidade de ${item.produto.nome}`}
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm text-ink-100">{item.quantidade}</span>
                      <button
                        onClick={() => alterarQuantidade(item.produto.id, item.quantidade + 1)}
                        disabled={item.quantidade >= item.produto.quantidadeEmEstoque}
                        className="h-7 w-7 rounded-md bg-ink-700 text-ink-100 hover:bg-ink-600 disabled:opacity-40"
                        aria-label={`Aumentar quantidade de ${item.produto.nome}`}
                      >
                        +
                      </button>
                    </div>
                    <span className="w-24 text-right font-mono text-sm text-ink-100">
                      {formatarMoeda(item.precoUnitario * item.quantidade, tenant)}
                    </span>
                    <button
                      onClick={() => removerDoCarrinho(item.produto.id)}
                      className="flex h-7 w-7 items-center justify-center rounded-md text-lg leading-none text-ink-500 hover:bg-red-500/10 hover:text-red-400"
                      aria-label={`Remover ${item.produto.nome} do carrinho`}
                      title="Remover do carrinho"
                    >
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        {/* Coluna de resumo/fechamento */}
        <aside className="flex flex-col rounded-xl border border-ink-700 bg-ink-800 p-6">
          <p className="mb-6 font-display text-lg font-semibold text-ink-100">Resumo da venda</p>

          <div className="relative mb-4">
            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-ink-400">
              Cliente (opcional)
            </label>
            {clienteSelecionado ? (
              <div className="flex items-center justify-between rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-sm text-ink-100">
                <span className="truncate">{clienteSelecionado.nome}</span>
                <button
                  onClick={() => setClienteSelecionado(null)}
                  className="ml-2 text-ink-400 hover:text-ink-100"
                  aria-label="Remover cliente selecionado"
                >
                  ×
                </button>
              </div>
            ) : (
              <input
                value={termoCliente}
                onChange={(e) => setTermoCliente(e.target.value)}
                placeholder="Buscar cliente…"
                className="w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-tenant focus:outline-none"
              />
            )}
            {!clienteSelecionado && resultadosClientes.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full divide-y divide-ink-700 rounded-lg border border-ink-700 bg-ink-800 shadow-lg">
                {resultadosClientes.map((cliente) => (
                  <li key={cliente.id}>
                    <button
                      onClick={() => {
                        setClienteSelecionado(cliente);
                        setTermoCliente('');
                        setResultadosClientes([]);
                      }}
                      className="w-full px-3 py-2 text-left text-sm text-ink-100 hover:bg-ink-700"
                    >
                      {cliente.nome}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {vendedores.length > 0 && (
            <label className="mb-4 block text-xs font-medium uppercase tracking-wide text-ink-400">
              Vendedor
              <select
                required
                value={vendedorId}
                onChange={(e) => setVendedorId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-sm normal-case text-ink-100 focus:border-tenant focus:outline-none"
              >
                <option value="" disabled>
                  Selecione…
                </option>
                {vendedores.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.nome}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="space-y-3 text-sm">
            <div className="flex justify-between text-ink-300">
              <span>Subtotal</span>
              <span className="font-mono">{formatarMoeda(subtotal, tenant)}</span>
            </div>

            <div className="flex items-center justify-between text-ink-300">
              <span>Desconto</span>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setDescontoPercentual((p) => Math.max(0, p - 1))}
                  className="h-7 w-7 rounded-md bg-ink-700 text-ink-100 hover:bg-ink-600"
                  aria-label="Diminuir desconto"
                >
                  −
                </button>
                <div className="flex items-center gap-0.5 rounded-md border border-ink-600 bg-ink-700 px-2 py-1">
                  <input
                    type="number"
                    min={0}
                    max={descontoMaximo}
                    value={descontoPercentual === 0 ? '' : descontoPercentual}
                    onChange={(e) => setDescontoPercentual(Math.min(descontoMaximo, Math.max(0, Number(e.target.value) || 0)))}
                    aria-label="Percentual de desconto"
                    className={['w-9 bg-transparent text-right font-mono text-ink-100 outline-none', SEM_SPINNER_NATIVO].join(' ')}
                  />
                  <span className="text-ink-400">%</span>
                </div>
                <button
                  onClick={() => setDescontoPercentual((p) => Math.min(descontoMaximo, p + 1))}
                  className="h-7 w-7 rounded-md bg-ink-700 text-ink-100 hover:bg-ink-600"
                  aria-label="Aumentar desconto"
                >
                  +
                </button>
              </div>
            </div>

            {valorDesconto > 0 && (
              <div className="flex justify-between text-ink-400">
                <span>Desconto aplicado</span>
                <span className="font-mono">−{formatarMoeda(valorDesconto, tenant)}</span>
              </div>
            )}

            {ehCartaoCredito && valorTaxaCartao > 0 && (
              <div className="flex justify-between text-ink-400">
                <span>Taxa do cartão (5%)</span>
                <span className="font-mono">+{formatarMoeda(valorTaxaCartao, tenant)}</span>
              </div>
            )}
          </div>

          <div className="my-5 border-t border-ink-700" />

          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-300">Total</span>
            <span className="font-display text-3xl font-semibold text-tenant">{formatarMoeda(totalFinal, tenant)}</span>
          </div>
          {ehCartaoCredito && parcelas > 1 && (
            <p className="mt-1 text-right text-xs text-ink-400">
              {parcelas}x de {formatarMoeda(totalFinal / parcelas, tenant)}
            </p>
          )}

          <div className="mt-6">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Forma de pagamento</p>
            <div className="grid grid-cols-2 gap-2">
              {formasPagamento.map((forma) => (
                <button
                  key={forma.valor}
                  onClick={() => handleMudarFormaPagamento(forma.valor)}
                  className={[
                    'rounded-lg border px-3 py-2 text-xs font-medium transition-colors',
                    formaPagamento === forma.valor
                      ? 'border-tenant bg-tenant-soft text-tenant'
                      : 'border-ink-600 text-ink-300 hover:border-ink-500',
                  ].join(' ')}
                >
                  {forma.rotulo}
                </button>
              ))}
            </div>
          </div>

          {ehCartaoCredito && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Parcelas</p>
              <div className="grid grid-cols-3 gap-2">
                {PARCELAS_DISPONIVEIS.map((n) => (
                  <button
                    key={n}
                    onClick={() => setParcelas(n)}
                    className={[
                      'rounded-lg border px-2 py-2 text-xs font-medium transition-colors',
                      parcelas === n
                        ? 'border-tenant bg-tenant-soft text-tenant'
                        : 'border-ink-600 text-ink-300 hover:border-ink-500',
                    ].join(' ')}
                  >
                    {n}x
                  </button>
                ))}
              </div>
            </div>
          )}

          {ehDinheiro && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Valor recebido</p>
              <div className="flex items-center rounded-lg border border-ink-600 bg-ink-700 px-3 py-2">
                <span className="text-ink-400">R$</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={valorRecebido === 0 ? '' : valorRecebido}
                  onChange={(e) => setValorRecebido(Number(e.target.value) || 0)}
                  aria-label="Valor recebido em dinheiro"
                  placeholder={totalFinal.toFixed(2)}
                  className={['ml-2 w-full bg-transparent text-right font-mono text-ink-100 outline-none', SEM_SPINNER_NATIVO].join(' ')}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[totalFinal, 20, 50, 100, 200]
                  .filter((v, i) => i === 0 || v > totalFinal)
                  .map((v, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setValorRecebido(Number(v.toFixed(2)))}
                      className="rounded-md border border-ink-600 px-2 py-1 text-[11px] text-ink-300 hover:border-tenant hover:text-tenant"
                    >
                      {i === 0 ? 'Valor exato' : formatarMoeda(v, tenant)}
                    </button>
                  ))}
              </div>
              {recebidoInformado && (
                <p className={['mt-2 text-right text-sm font-semibold', recebidoInsuficiente ? 'text-red-400' : 'text-emerald-400'].join(' ')}>
                  {recebidoInsuficiente ? `Faltam ${formatarMoeda(-troco, tenant)}` : `Troco: ${formatarMoeda(troco, tenant)}`}
                </p>
              )}
            </div>
          )}

          <button
            onClick={finalizarVenda}
            disabled={carrinho.length === 0 || processando || vendedorObrigatorioFaltando || recebidoInsuficiente}
            className="mt-auto pt-6 text-center"
          >
            <span
              className={[
                'block w-full rounded-xl bg-tenant py-3.5 text-sm font-semibold text-tenant-foreground transition-opacity hover:opacity-90',
                (carrinho.length === 0 || processando || vendedorObrigatorioFaltando || recebidoInsuficiente) && 'cursor-not-allowed opacity-40',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {processando ? 'Finalizando…' : vendedorObrigatorioFaltando ? 'Selecione um vendedor' : recebidoInsuficiente ? 'Valor recebido insuficiente' : 'Finalizar venda (F4)'}
            </span>
          </button>
        </aside>
          </div>
        </>
      )}

      {comprovante && <ComprovanteModal dados={comprovante} aoFechar={() => setComprovante(null)} />}

      {mostrarFecharCaixa && (
        <FecharCaixaModal
          caixa={caixa}
          aoFechar={() => setMostrarFecharCaixa(false)}
          aoConfirmar={handleFecharCaixa}
        />
      )}
    </AppLayout>
  );
}
