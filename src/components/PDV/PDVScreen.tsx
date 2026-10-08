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
  cancelarVenda,
  movimentarCaixa,
  getProdutoPorCodigo,
  getTodosOsProdutos,
} from '@/services/apiService';
import {
  buscarNoCatalogo,
  chaveCache,
  ehFalhaDeConexao,
  enfileirarVenda,
  guardarCache,
  lerCache,
  novoIdLocal,
  reativarNaFila,
  removerDaFila,
  sincronizarFila,
  useFila,
  useOnline,
} from '@/lib/offline';
import { useConfirm } from '@/contexts/ConfirmContext';
import { OfflineBanner } from './OfflineBanner';
import { formatarMoeda, formatarHora, formatarFormaPagamento } from '@/utils/formatters';
import { AbrirCaixaCard } from './AbrirCaixaCard';
import { FecharCaixaModal } from './FecharCaixaModal';
import { ComprovanteModal, type DadosComprovante } from './ComprovanteModal';
import { PagamentoPanel } from './PagamentoPanel';
import { CancelarVendaModal } from './CancelarVendaModal';
import { MovimentoCaixaModal } from './MovimentoCaixaModal';
import { VendasEmEsperaModal } from './VendasEmEsperaModal';
import { PAGAMENTO_INICIAL, calcularPagamento, type EstadoPagamento } from './pagamento';
import { guardarEmEspera, listarEmEspera, removerDaEspera, type VendaEmEspera } from './emEspera';
import { podeFazer } from '@/utils/acoes';
import type { Caixa, Cliente, FormaPagamento, Produto, Vendedor, VendaResumo } from '@/types';

interface ItemCarrinho {
  produto: Produto;
  quantidade: number;
  precoUnitario: number;
}

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
  const podeAlterarPreco = podeFazer(usuarioAtual, 'vendas.alterarPreco');
  const descontoMaximo = usuarioAtual?.descontoMaximo ?? 5;
  const podeCancelar = podeFazer(usuarioAtual, 'vendas.cancelar');
  const podeSangria = podeFazer(usuarioAtual, 'caixa.sangria');
  const toast = useToast();
  const confirmar = useConfirm();
  const online = useOnline();
  const fila = useFila(tenant?.id);
  const [sincronizandoFila, setSincronizandoFila] = useState(false);
  // Catálogo e clientes guardados no aparelho: é com eles que a busca funciona sem internet.
  const catalogoRef = useRef<Produto[]>([]);
  const clientesRef = useRef<Cliente[]>([]);
  const filaPendente = fila.length > 0;

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
  const [pagamento, setPagamento] = useState<EstadoPagamento>(PAGAMENTO_INICIAL);
  const [descontoPercentual, setDescontoPercentual] = useState<number>(0);
  const [vendaParaCancelar, setVendaParaCancelar] = useState<VendaResumo | null>(null);
  const [movimentoModal, setMovimentoModal] = useState<'SANGRIA' | 'SUPRIMENTO' | null>(null);
  const [emEspera, setEmEspera] = useState<VendaEmEspera[]>([]);
  const [mostrarEspera, setMostrarEspera] = useState(false);
  const [processando, setProcessando] = useState(false);
  // Dinheiro: quanto o cliente entregou (pra calcular o troco). Vazio = não informado.
  const [valorRecebido, setValorRecebido] = useState<number>(0);
  const [comprovante, setComprovante] = useState<DadosComprovante | null>(null);

  const [termoCliente, setTermoCliente] = useState('');
  const [listaClientesAberta, setListaClientesAberta] = useState(false);
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
    } catch (e) {
      if (!ehFalhaDeConexao(e)) throw e; // sem internet: mantém a lista que já estava na tela
    } finally {
      setCarregandoVendas(false);
    }
  }

  async function carregarCaixa() {
    setCarregandoCaixa(true);
    try {
      const atual = await getCaixaAtual();
      setCaixa(atual);
      if (tenant) guardarCache(chaveCache(tenant.id, 'caixa'), atual);
      if (atual) await carregarVendasDoCaixa(atual.id);
    } catch (e) {
      if (!ehFalhaDeConexao(e) || !tenant) throw e;
      // Sem internet: usa o caixa da última vez que o servidor respondeu.
      const guardado = await lerCache<Caixa | null>(chaveCache(tenant.id, 'caixa'));
      setCaixa(guardado?.valor ?? null);
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
    carregarCaixa().catch(() => undefined);
    carregarHistorico().catch(() => undefined);
    getVendedores()
      .then((lista) => {
        setVendedores(lista.filter((v) => v.ativo));
        if (tenant) guardarCache(chaveCache(tenant.id, 'vendedores'), lista);
      })
      .catch(async (e) => {
        // Sem internet usa os vendedores guardados; plano sem o módulo (erro de API): sem vendedores.
        const guardado = ehFalhaDeConexao(e) && tenant ? await lerCache<Vendedor[]>(chaveCache(tenant.id, 'vendedores')) : null;
        setVendedores((guardado?.valor ?? []).filter((v) => v.ativo));
      });
  }, []);

  // Catálogo e clientes no aparelho: primeiro o que já está guardado (abre rápido, funciona offline),
  // depois, com internet, atualiza.
  useEffect(() => {
    if (!tenant) return;
    let ativo = true;
    (async () => {
      const [prod, cli] = await Promise.all([lerCache<Produto[]>(chaveCache(tenant.id, 'catalogo')), lerCache<Cliente[]>(chaveCache(tenant.id, 'clientes'))]);
      if (!ativo) return;
      if (prod) catalogoRef.current = prod.valor;
      if (cli) clientesRef.current = cli.valor;
      if (!online) return;
      try {
        const [produtos, clientes] = await Promise.all([getTodosOsProdutos(), getClientes(undefined, 1, 100).then((r) => r.itens)]);
        if (!ativo) return;
        catalogoRef.current = produtos;
        clientesRef.current = clientes;
        guardarCache(chaveCache(tenant.id, 'catalogo'), produtos);
        guardarCache(chaveCache(tenant.id, 'clientes'), clientes);
      } catch {
        // mantém o que estava guardado
      }
    })();
    return () => {
      ativo = false;
    };
  }, [tenant?.id, online]);

  async function enviarFila() {
    if (!tenant || sincronizandoFila) return;
    setSincronizandoFila(true);
    try {
      const r = await sincronizarFila(tenant.id, registerSale);
      if (r.enviadas > 0) {
        toast.sucesso(`${r.enviadas} venda(s) enviada(s).`);
        carregarCaixa().catch(() => undefined);
      }
      r.avisos.forEach((a) => toast.erro(a));
      if (r.recusadas > 0) toast.erro(`${r.recusadas} venda(s) não foram aceitas. Veja o aviso no topo da tela.`);
    } finally {
      setSincronizandoFila(false);
    }
  }

  // Volta a conexão (ou há venda esperando): envia sozinho, e tenta de novo a cada 30 s.
  useEffect(() => {
    if (!online || !tenant || !fila.some((v) => !v.erro)) return;
    enviarFila();
    const t = setInterval(enviarFila, 30_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [online, tenant?.id, fila.length]);

  async function descartarDaFila(venda: { idLocal: string; total: number }) {
    if (!tenant) return;
    const ok = await confirmar({
      titulo: 'Descartar esta venda?',
      descricao: 'Ela será apagada deste aparelho e não entra no caixa nem no estoque. Só faça isso se já resolveu a situação de outro jeito.',
      textoConfirmar: 'Descartar',
      textoCancelar: 'Manter',
      perigoso: true,
    });
    if (ok) removerDaFila(tenant.id, venda.idLocal);
  }

  useEffect(() => {
    if (tenant && caixa) setEmEspera(listarEmEspera(tenant.id, caixa.id));
  }, [tenant, caixa]);

  useEffect(() => {
    const termo = termoBusca.trim();
    if (termo.length === 0) {
      setResultados([]);
      return;
    }
    let cancelado = false;
    const local = () => buscarNoCatalogo(catalogoRef.current, termo);
    if (!online) {
      setResultados(local());
    } else {
      searchProducts(termo)
        .then((resultado) => {
          if (!cancelado) setResultados(resultado.itens);
        })
        .catch((e) => {
          if (!cancelado && ehFalhaDeConexao(e)) setResultados(local());
        });
    }
    return () => {
      cancelado = true;
    };
  }, [termoBusca, online]);

  useEffect(() => {
    if (!listaClientesAberta) return;
    const termo = termoCliente.trim();
    let cancelado = false;
    const local = () => {
      const t = termo.toLowerCase();
      return clientesRef.current.filter((c) => !t || c.nome.toLowerCase().includes(t) || (c.telefone ?? '').includes(t) || (c.cpfCnpj ?? '').includes(t)).slice(0, 20);
    };
    if (!online) {
      setResultadosClientes(local());
    } else {
      getClientes(termo || undefined)
        .then((resultado) => {
          if (!cancelado) setResultadosClientes(resultado.itens);
        })
        .catch((e) => {
          if (!cancelado && ehFalhaDeConexao(e)) setResultadosClientes(local());
        });
    }
    return () => {
      cancelado = true;
    };
  }, [termoCliente, listaClientesAberta, online]);

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
    setPagamento(PAGAMENTO_INICIAL);
    setValorRecebido(0);
    setClienteSelecionado(null);
    setTermoCliente('');
    setMostrarNovaVenda(false);
  }

  const subtotal = useMemo(
    () => carrinho.reduce((acc, i) => acc + i.precoUnitario * i.quantidade, 0),
    [carrinho],
  );
  const valorDesconto = Number(((subtotal * descontoPercentual) / 100).toFixed(2));
  const subtotalComDesconto = Math.max(0, subtotal - valorDesconto);
  const resultadoPagamento = calcularPagamento(pagamento, subtotalComDesconto);
  const valorTaxaCartao = resultadoPagamento.taxa;
  const totalFinal = resultadoPagamento.total;
  // Troco: só sobre a parte paga em dinheiro (na venda dividida, é a linha "Dinheiro").
  const valorEmDinheiro = resultadoPagamento.valorEmDinheiro;
  const recebidoInformado = valorEmDinheiro > 0 && valorRecebido > 0;
  const troco = recebidoInformado ? Number((valorRecebido - valorEmDinheiro).toFixed(2)) : 0;
  // Se informou o valor recebido, ele precisa cobrir a parte em dinheiro.
  const recebidoInsuficiente = recebidoInformado && troco < 0;
  const pagamentoInvalido = !resultadoPagamento.valido;

  const vendedorObrigatorioFaltando = vendedores.length > 0 && !vendedorId;

  async function finalizarVenda() {
    if (carrinho.length === 0 || vendedorObrigatorioFaltando || recebidoInsuficiente || pagamentoInvalido) return;
    setProcessando(true);
    const idLocal = novoIdLocal();
    const agora = new Date();
    const payload = {
      itens: carrinho.map((i) => ({
        productId: i.produto.id,
        quantidade: i.quantidade,
        precoUnitario: i.precoUnitario,
      })),
      desconto: valorDesconto,
      // A taxa do cartão não vai: o servidor calcula.
      ...(pagamento.dividido
        ? { pagamentos: resultadoPagamento.pagamentos }
        : { formaPagamento: pagamento.forma, parcelas: pagamento.forma === 'CARTAO_CREDITO' ? pagamento.parcelas : 1 }),
      clienteId: clienteSelecionado?.id,
      vendedorId: vendedorId || undefined,
      // O mesmo id vai em toda tentativa: se a resposta se perder, reenviar não duplica a venda.
      idLocal,
      vendidaEm: agora.toISOString(),
    };
    const dadosExtras = {
      valorRecebido: recebidoInformado ? valorRecebido : undefined,
      troco: recebidoInformado ? troco : undefined,
      clienteNome: clienteSelecionado?.nome,
      clienteTelefone: clienteSelecionado?.telefone,
      vendedorNome: vendedores.find((v) => v.id === vendedorId)?.nome,
    };
    try {
      let venda;
      try {
        if (!online) throw new TypeError('sem conexão');
        venda = await registerSale(payload);
      } catch (e) {
        if (!ehFalhaDeConexao(e) || !tenant) throw e;
        // Sem internet (ou a API não respondeu): guarda a venda no aparelho e segue. O envio é automático.
        enfileirarVenda({
          idLocal,
          tenantId: tenant.id,
          criadoEm: agora.toISOString(),
          payload,
          total: totalFinal,
          resumo: carrinho.map((i) => `${i.quantidade}x ${i.produto.nome}`).join(', ').slice(0, 140),
        });
        // Abate o estoque do catálogo local, para a próxima venda offline enxergar o saldo certo.
        for (const i of carrinho) {
          const p = catalogoRef.current.find((x) => x.id === i.produto.id);
          if (p) p.quantidadeEmEstoque = Math.max(0, p.quantidadeEmEstoque - i.quantidade);
        }
        guardarCache(chaveCache(tenant.id, 'catalogo'), catalogoRef.current);
        toast.sucesso('Sem internet: venda guardada neste aparelho. Ela é enviada sozinha quando a conexão voltar.');
        setComprovante({
          id: idLocal,
          timestamp: agora.toISOString(),
          itens: carrinho.map((i) => ({ nome: i.produto.nome, quantidade: i.quantidade, valorUnitario: i.precoUnitario, subtotal: Number((i.precoUnitario * i.quantidade).toFixed(2)) })),
          desconto: valorDesconto,
          taxas: resultadoPagamento.taxa,
          total: totalFinal,
          formaPagamento: pagamento.dividido ? undefined : pagamento.forma,
          parcelas: pagamento.dividido ? undefined : pagamento.parcelas,
          pagamentos: pagamento.dividido ? resultadoPagamento.pagamentos : undefined,
          pendenteDeEnvio: true,
          ...dadosExtras,
        });
        venda = null;
      }
      if (venda) {
        toast.sucesso(`Venda finalizada às ${new Date().toLocaleTimeString('pt-BR')}.`);
        venda.avisos?.forEach((a) => toast.erro(a));
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
          pagamentos: venda.pagamentos,
          ...dadosExtras,
        });
      }
      setCarrinho([]);
      setDescontoPercentual(0);
      setPagamento(PAGAMENTO_INICIAL);
      setValorRecebido(0);
      setClienteSelecionado(null);
      setTermoCliente('');
      setMostrarNovaVenda(false);
      if (venda) carregarCaixa().catch(() => undefined);
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao finalizar venda.');
    } finally {
      setProcessando(false);
    }
  }

  async function confirmarCancelamento(motivo: string) {
    if (!vendaParaCancelar) return;
    try {
      await cancelarVenda(vendaParaCancelar.id, motivo);
      toast.sucesso('Venda cancelada, estoque devolvido.');
      await carregarCaixa();
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao cancelar a venda.');
      throw erro;
    }
  }

  async function confirmarMovimento(tipo: 'SANGRIA' | 'SUPRIMENTO', valor: number, motivo: string) {
    if (!caixa) return;
    try {
      await movimentarCaixa(caixa.id, { tipo, valor, motivo });
      toast.sucesso(tipo === 'SANGRIA' ? 'Sangria registrada.' : 'Suprimento registrado.');
      await carregarCaixa();
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao registrar.');
      throw erro;
    }
  }

  function limparVendaAtual() {
    setCarrinho([]);
    setDescontoPercentual(0);
    setPagamento(PAGAMENTO_INICIAL);
    setValorRecebido(0);
    setClienteSelecionado(null);
    setTermoCliente('');
    setTermoBusca('');
    setResultados([]);
  }

  function colocarEmEspera() {
    if (!tenant || !caixa || carrinho.length === 0) return;
    guardarEmEspera(tenant.id, {
      caixaId: caixa.id,
      rotulo: clienteSelecionado?.nome ?? `Venda das ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`,
      itens: carrinho,
      cliente: clienteSelecionado,
      vendedorId,
      descontoPercentual,
    });
    setEmEspera(listarEmEspera(tenant.id, caixa.id));
    limparVendaAtual();
    toast.sucesso('Venda guardada em espera. Já pode atender o próximo cliente.');
  }

  function retomarDaEspera(venda: VendaEmEspera) {
    if (!tenant || !caixa) return;
    if (carrinho.length > 0) {
      toast.erro('Finalize ou guarde a venda atual em espera antes de retomar outra.');
      return;
    }
    setCarrinho(venda.itens);
    setClienteSelecionado(venda.cliente);
    setVendedorId(venda.vendedorId);
    setDescontoPercentual(Math.min(venda.descontoPercentual, descontoMaximo));
    removerDaEspera(tenant.id, venda.id);
    setEmEspera(listarEmEspera(tenant.id, caixa.id));
    setMostrarEspera(false);
    setMostrarNovaVenda(true);
  }

  /** Leitor de código de barras (digita o código e dá Enter): adiciona o produto direto ao carrinho. */
  async function aoDarEnterNaBusca() {
    const termo = termoBusca.trim();
    if (!termo) return;
    const noCatalogo = () => catalogoRef.current.find((p) => p.codigoBarras === termo || p.sku === termo);
    try {
      const produto = online ? await getProdutoPorCodigo(termo) : (noCatalogo() ?? null);
      if (produto) return adicionarAoCarrinho(produto);
      if (resultados.length === 1) return adicionarAoCarrinho(resultados[0]);
      toast.erro(`Nenhum produto com o código "${termo}".`);
    } catch (erro) {
      const local = ehFalhaDeConexao(erro) ? noCatalogo() : undefined;
      if (local) return adicionarAoCarrinho(local);
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao ler o código.');
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
        <OfflineBanner
          online={online}
          fila={fila}
          tenant={tenant}
          sincronizando={sincronizandoFila}
          aoEnviar={enviarFila}
          aoTentarDeNovo={(id) => {
            if (tenant) reativarNaFila(tenant.id, id);
          }}
          aoDescartar={descartarDaFila}
        />
        {!online && <p className="mb-4 text-sm text-ink-400">Abrir o caixa precisa de internet. Se ele já estava aberto neste aparelho, recarregue a página.</p>}
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
      <OfflineBanner
        online={online}
        fila={fila}
        tenant={tenant}
        sincronizando={sincronizandoFila}
        aoEnviar={enviarFila}
        aoTentarDeNovo={(id) => {
          if (tenant) reativarNaFila(tenant.id, id);
        }}
        aoDescartar={descartarDaFila}
      />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-ink-700 bg-ink-800 px-5 py-3">
        <div className="text-sm">
          <span className="font-medium text-ink-100">Caixa aberto</span>
          <span className="text-ink-400">
            {' '}
            às {new Date(caixa.abertoEm).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })} por{' '}
            {caixa.abertoPorNome}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm sm:gap-4">
          <span className="text-ink-400">
            {caixa.resumo.quantidadeVendas} venda(s) · <span className="font-mono text-ink-100">{formatarMoeda(caixa.resumo.totalVendido, tenant)}</span>
          </span>
          {podeSangria && (
            <>
              <button onClick={() => setMovimentoModal('SANGRIA')} disabled={!online} title={online ? undefined : 'Precisa de internet'} className="disabled:cursor-not-allowed disabled:opacity-40 rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant">
                Sangria
              </button>
              <button onClick={() => setMovimentoModal('SUPRIMENTO')} disabled={!online} title={online ? undefined : 'Precisa de internet'} className="disabled:cursor-not-allowed disabled:opacity-40 rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant">
                Suprimento
              </button>
            </>
          )}
          <button
            onClick={() => setMostrarFecharCaixa(true)}
            disabled={!online || filaPendente}
            title={!online ? 'Precisa de internet' : filaPendente ? 'Envie as vendas guardadas antes de fechar o caixa' : undefined}
            className="disabled:cursor-not-allowed disabled:opacity-40 rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-red-400 hover:text-red-400"
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
            <div className="flex flex-wrap gap-2">
              {emEspera.length > 0 && (
                <button onClick={() => setMostrarEspera(true)} className="rounded-lg border border-amber-500/40 px-4 py-2 text-sm font-medium text-amber-400 hover:bg-amber-500/10">
                  Em espera ({emEspera.length})
                </button>
              )}
              {vendasDoCaixa.some((v) => !v.cancelada) && (
                <button
                  onClick={handleDesfazerUltimaVenda}
                  disabled={desfazendo || !online}
                  title={online ? 'Só funciona até 5 minutos depois da venda' : 'Precisa de internet'}
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
                    <th className="px-5 py-3 font-medium text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-ink-700 bg-ink-800/40">
                  {vendasDoCaixa.map((venda) => (
                    <tr key={venda.id} className={['transition-colors hover:bg-ink-800', venda.cancelada ? 'opacity-60' : ''].join(' ')}>
                      <td className="px-5 py-3.5 text-ink-300">
                        {formatarHora(venda.timestamp, tenant)}
                        {venda.cancelada && (
                          <span title={venda.motivoCancelamento} className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-400">
                            Cancelada
                          </span>
                        )}
                      </td>
                      <td className="px-5 py-3.5 text-ink-300">{venda.clienteNome ?? '-'}</td>
                      <td className="px-5 py-3.5 text-ink-300">{venda.vendedorNome ?? '-'}</td>
                      <td className="px-5 py-3.5 text-ink-300">
                        {venda.pagamentos && venda.pagamentos.length > 1 ? `Dividido (${venda.pagamentos.map((p) => formatarFormaPagamento(p.forma)).join(' + ')})` : formatarFormaPagamento(venda.formaPagamento)}
                      </td>
                      <td className="px-5 py-3.5 text-right text-ink-300">{venda.quantidadeItens}</td>
                      <td className={['px-5 py-3.5 text-right font-mono text-ink-100', venda.cancelada ? 'line-through' : ''].join(' ')}>
                        {formatarMoeda(venda.valorTotal, tenant)}
                      </td>
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex justify-end gap-2">
                        {podeCancelar && !venda.cancelada && (
                          <button onClick={() => setVendaParaCancelar(venda)} disabled={!online} title={online ? undefined : 'Precisa de internet'} className="disabled:cursor-not-allowed disabled:opacity-40 rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-red-400 hover:text-red-400">
                            Cancelar
                          </button>
                        )}
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
                                pagamentos: venda.pagamentos,
                                clienteNome: venda.clienteNome,
                                clienteTelefone: venda.clienteTelefone,
                                vendedorNome: venda.vendedorNome,
                              })
                            }
                            className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant"
                          >
                            Comprovante
                          </button>
                        )}
                        </div>
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

          <div className="grid gap-6 lg:h-[calc(100%-4rem)] lg:grid-cols-[1fr_380px]">
        {/* Coluna de busca + resultados */}
        <section className="flex flex-col gap-4">
          <div className="relative">
            <input
              ref={inputBuscaRef}
              autoFocus
              value={termoBusca}
              onChange={(e) => setTermoBusca(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  aoDarEnterNaBusca();
                }
              }}
              placeholder="Nome, SKU ou código de barras… (F2)"
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
                onFocus={() => setListaClientesAberta(true)}
                onBlur={() => setListaClientesAberta(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && resultadosClientes.length > 0) {
                    e.preventDefault();
                    setClienteSelecionado(resultadosClientes[0]);
                    setTermoCliente('');
                    setListaClientesAberta(false);
                  }
                  if (e.key === 'Escape') setListaClientesAberta(false);
                }}
                placeholder="Escolha ou digite o nome do cliente…"
                className="w-full rounded-lg border border-ink-600 bg-ink-900 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-400 focus:border-tenant focus:outline-none"
              />
            )}
            {!clienteSelecionado && listaClientesAberta && resultadosClientes.length > 0 && (
              <ul className="absolute z-10 mt-1 max-h-56 w-full divide-y overflow-y-auto divide-ink-700 rounded-lg border border-ink-700 bg-ink-800 shadow-lg">
                {resultadosClientes.map((cliente) => (
                  <li key={cliente.id}>
                    <button
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => {
                        setClienteSelecionado(cliente);
                        setTermoCliente('');
                        setListaClientesAberta(false);
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
                <div className="flex items-center gap-0.5 rounded-md border border-ink-600 bg-ink-900 px-2 py-1">
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

            {valorTaxaCartao > 0 && (
              <div className="flex justify-between text-ink-400">
                <span>Juros do cartão (acima de 3x)</span>
                <span className="font-mono">+{formatarMoeda(valorTaxaCartao, tenant)}</span>
              </div>
            )}
          </div>

          <div className="my-5 border-t border-ink-700" />

          <div className="flex items-baseline justify-between">
            <span className="text-sm text-ink-300">Total</span>
            <span className="font-display text-3xl font-semibold text-tenant">{formatarMoeda(totalFinal, tenant)}</span>
          </div>
          <PagamentoPanel estado={pagamento} aoMudar={setPagamento} subtotalComDesconto={subtotalComDesconto} resultado={resultadoPagamento} />

          {valorEmDinheiro > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">Valor recebido em dinheiro</p>
              <div className="flex items-center rounded-lg border border-ink-600 bg-ink-700 px-3 py-2">
                <span className="text-ink-400">R$</span>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={valorRecebido === 0 ? '' : valorRecebido}
                  onChange={(e) => setValorRecebido(Number(e.target.value) || 0)}
                  aria-label="Valor recebido em dinheiro"
                  placeholder={valorEmDinheiro.toFixed(2)}
                  className={['ml-2 w-full bg-transparent text-right font-mono text-ink-100 outline-none', SEM_SPINNER_NATIVO].join(' ')}
                />
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {[valorEmDinheiro, 20, 50, 100, 200]
                  .filter((v, i) => i === 0 || v > valorEmDinheiro)
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
            disabled={carrinho.length === 0 || processando || vendedorObrigatorioFaltando || recebidoInsuficiente || pagamentoInvalido}
            className="mt-auto pt-6 text-center"
          >
            <span
              className={[
                'block w-full rounded-xl bg-tenant py-3.5 text-sm font-semibold text-tenant-foreground transition-opacity hover:opacity-90',
                (carrinho.length === 0 || processando || vendedorObrigatorioFaltando || recebidoInsuficiente || pagamentoInvalido) && 'cursor-not-allowed opacity-40',
              ]
                .filter(Boolean)
                .join(' ')}
            >
              {processando ? 'Finalizando…' : vendedorObrigatorioFaltando ? 'Selecione um vendedor' : recebidoInsuficiente ? 'Valor recebido insuficiente' : pagamentoInvalido ? 'Complete o pagamento' : 'Finalizar venda (F4)'}
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
