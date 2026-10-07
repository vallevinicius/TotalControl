/**
 * MODELOS DE DADOS CENTRAIS
 * ------------------------------------------------------------------
 * Estas interfaces são o "contrato" entre a UI e a camada de dados.
 * Hoje elas são satisfeitas pelo mockDatabaseService (em memória).
 * No futuro, o mesmo contrato deve ser satisfeito por um repositório
 * real (PostgreSQL/Supabase/Firebase) sem que nenhum componente de
 * UI precise mudar uma linha sequer — esse é o objetivo do Repository
 * Pattern usado neste projeto.
 * ------------------------------------------------------------------
 */

/** Planos disponíveis do SaaS. Controla limites/feature flags do tenant. */
export type PlanoSaaS = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';

/** Envelope de resposta paginada — espelha server/src/lib/paginacao.ts. */
export interface PaginaResultado<T> {
  itens: T[];
  total: number;
  pagina: number;
  totalPaginas: number;
}

export type FormaPagamento = 'PIX' | 'CARTAO_CREDITO' | 'CARTAO_DEBITO' | 'DINHEIRO' | 'BOLETO' | 'OUTRO';

export type TipoMovimentacao = 'ENTRADA' | 'SAIDA';

/**
 * Configurações visuais/operacionais do Tenant.
 * Tudo que hoje seria "hardcoded" no front (cor, logo, fuso, moeda)
 * vive aqui e é injetado via TenantContext.
 */
export interface TenantConfiguracoes {
  logoDaLojaUrl: string;
  corPrincipalDoTema: string; // hex, ex: "#D97706" — injetada como --tenant-primary
  corPrincipalHover?: string; // opcional; calculada automaticamente se ausente
  fusoHorario: string; // ex: "America/Sao_Paulo"
  moeda: string; // ex: "BRL"
  exigirSenhaAoAbrirCaixa?: boolean;
}

export type StatusAssinatura = 'NENHUMA' | 'PENDENTE' | 'ATIVA' | 'CANCELADA' | 'PAUSADA';

export interface ResumoAssinaturaTenant {
  status: StatusAssinatura;
  /** Fim do período já pago (o acesso vai até aqui, mesmo cancelada). */
  acessoAte?: string;
  canceladaEm?: string;
}

export interface EnderecoTenant {
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

/** Empresa/loja assinante do SaaS — a raiz de todo o isolamento multi-tenant. */
export interface Tenant {
  id: string;
  nomeFantasia: string;
  razaoSocial?: string;
  cnpj: string;
  /** Meios de contato da empresa — não é o e-mail de login de nenhum usuário. */
  telefone?: string;
  email?: string;
  site?: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  regimeTributario?: string;
  endereco?: EnderecoTenant;
  planoAtual: PlanoSaaS;
  /** Situação da assinatura paga (Mercado Pago). */
  assinatura?: ResumoAssinaturaTenant;
  /** Por que o acesso acabou (teste grátis ou assinatura vencida); ausente se está liberado. */
  acessoExpirado?: 'TRIAL' | 'ASSINATURA';
  /** Data em que o teste grátis expira (independe do plano — hoje o cadastro
   * self-service já entra em STARTER com trial). Ausente fora do trial. */
  trialExpiraEm?: string; // ISO date
  configuracoes: TenantConfiguracoes;
  criadoEm: string; // ISO date
}

/** Usuário operador do sistema, sempre vinculado a um tenant. */
export type PapelUsuario = 'ADMIN' | 'GERENTE' | 'OPERADOR_CAIXA';

/** Chave de cada tela que pode ter acesso concedido/negado por usuário. */
export type TelaComPermissao =
  | 'dashboard'
  | 'pdv'
  | 'estoque'
  | 'financeiro'
  | 'clientes'
  | 'vendedores'
  | 'relatorios';

export interface Usuario {
  id: string;
  tenantId: string;
  nome: string;
  email: string;
  telefone?: string;
  papel: PapelUsuario;
  /**
   * Telas que este usuário pode acessar. `undefined` = acesso total (contas
   * ADMIN sempre ignoram este campo; contas antigas sem o campo também
   * caem nesse caso, por compatibilidade).
   */
  permissoes?: TelaComPermissao[];
  /** Conta principal da loja (criada no cadastro) — nunca pode ser desativada. */
  raiz?: boolean;
  ativo: boolean;
}

/**
 * Categoria dinâmica de produto — criada pelo próprio usuário/tenant.
 * É isso que torna o sistema "agnóstico de segmento": não existe uma
 * tabela fixa de "Tamanho" ou "Placa", apenas categorias e atributos
 * livres, definidos por quem usa o sistema.
 */
export interface Categoria {
  id: string;
  tenantId: string;
  nome: string;
  atributosCustomizados?: AtributoCustomizadoDefinicao[];
}

/** Definição de um atributo livre que pode ser preenchido por produto. */
export interface AtributoCustomizadoDefinicao {
  chave: string; // ex: "cor", "voltagem", "validade"
  tipo: 'TEXTO' | 'NUMERO' | 'DATA' | 'BOOLEANO';
}

/** Valor de atributo customizado atribuído a um produto específico. */
export interface AtributoCustomizadoValor {
  chave: string;
  valor: string | number | boolean;
}

export interface Produto {
  id: string;
  tenantId: string;
  nome: string;
  sku: string;
  categoriaId: string;
  precoCusto: number;
  precoVenda: number;
  quantidadeEmEstoque: number;
  estoqueMinimo: number;
  atributosCustomizados?: AtributoCustomizadoValor[];
  ativo: boolean;
  criadoEm: string;
  atualizadoEm: string;
}

/** Um item dentro de uma transação (linha do carrinho/da nota). */
export interface ItemTransacao {
  productId: string;
  nomeProdutoSnapshot: string; // snapshot do nome no momento da venda
  quantidade: number;
  valorUnitarioPraticado: number;
  subtotal: number;
}

/**
 * A "espinha dorsal" do sistema: toda entrada e saída de estoque —
 * seja uma venda no PDV, um estorno ou uma reposição de mercadoria —
 * é registrada como uma Transacao.
 */
export interface Transacao {
  id: string;
  tenantId: string;
  tipo: TipoMovimentacao;
  timestamp: string; // ISO 8601, data e hora exatas da operação
  itens: ItemTransacao[];
  valorTotal: number;
  desconto: number;
  taxas: number;
  /** Número de parcelas — só relevante para CARTAO_CREDITO. */
  parcelas: number;
  formaPagamento?: FormaPagamento; // aplicável a SAIDA (venda)
  usuarioId: string;
  caixaId?: string;
  vendedorId?: string;
  observacao?: string;
}

/** Quem fez a venda no PDV, pra apurar comissão — não precisa ter login. */
export interface Vendedor {
  id: string;
  tenantId: string;
  nome: string;
  comissaoPercentual: number;
  ativo: boolean;
  criadoEm: string;
}

export type StatusCaixa = 'ABERTO' | 'FECHADO';

/** Resumo das vendas feitas dentro de um turno de caixa. */
export interface ResumoCaixa {
  totalVendido: number;
  quantidadeVendas: number;
  totaisPorFormaPagamento?: Record<string, number>;
}

/** Turno de caixa — abre com um valor inicial, acumula vendas, fecha com
 * a contagem final. Enquanto não houver um caixa ABERTO, o PDV não vende. */
export interface Caixa {
  id: string;
  tenantId: string;
  status: StatusCaixa;
  valorAbertura: number;
  abertoEm: string;
  abertoPorNome?: string;
  valorContadoFechamento?: number;
  observacaoFechamento?: string;
  fechadoEm?: string;
  fechadoPorNome?: string;
  resumo: ResumoCaixa;
}

/** Payload usado para registrar uma nova venda a partir do PDV. */
export interface NovaVendaPayload {
  tenantId: string;
  usuarioId: string;
  itens: Array<{ productId: string; quantidade: number }>;
  desconto?: number;
  taxas?: number;
  formaPagamento: FormaPagamento;
}

/** Payload usado para dar entrada em mercadoria no módulo de Estoque. */
export interface NovaEntradaEstoquePayload {
  tenantId: string;
  usuarioId: string;
  productId: string;
  quantidade: number;
  precoCustoUnitario?: number; // permite atualizar o custo médio/atual
  observacao?: string;
}

/** Cliente/comprador da loja, opcionalmente vinculado a uma venda. */
export interface Cliente {
  id: string;
  tenantId: string;
  nome: string;
  telefone?: string;
  email?: string;
  cpfCnpj?: string;
  criadoEm: string;
}

/** Estrutura agregada consumida pelo Dashboard. */
export interface ResumoDashboard {
  faturamentoDoDia: number;
  quantidadeVendasDoDia: number;
  ticketMedio: number;
  produtosMaisVendidos: Array<{
    productId: string;
    nome: string;
    quantidadeVendida: number;
    receitaGerada: number;
  }>;
  produtosComEstoqueBaixo: number;
}

/** Resumo de uma venda já finalizada, usado em Relatórios e na lista de
 * vendas do turno de caixa aberto no PDV. */
export interface VendaResumo {
  id: string;
  timestamp: string;
  valorTotal: number;
  formaPagamento?: FormaPagamento;
  clienteNome?: string;
  vendedorNome?: string;
  quantidadeItens: number;
  /** Detalhe da venda, usado pra reemitir o comprovante. */
  clienteTelefone?: string;
  desconto?: number;
  taxas?: number;
  parcelas?: number;
  itens?: Array<{ nome: string; quantidade: number; valorUnitario: number; subtotal: number }>;
}

/** Estrutura agregada consumida pela tela de Relatórios. */
export interface RelatorioVendas {
  faturamentoTotal: number;
  quantidadeVendas: number;
  ticketMedio: number;
  totaisPorFormaPagamento: Record<string, number>;
  produtosMaisVendidos: Array<{
    productId: string;
    nome: string;
    quantidadeVendida: number;
    receitaGerada: number;
  }>;
  vendasPorVendedor: Array<{
    vendedorId: string;
    nome: string;
    quantidadeVendas: number;
    totalVendido: number;
    comissaoPercentual: number;
    comissaoAPagar: number;
  }>;
  vendas: VendaResumo[];
}

export type TipoLancamentoFinanceiro = 'RECEITA' | 'DESPESA';

/** Lançamento manual de receita/despesa avulsa (aluguel, salário etc.). */
export interface LancamentoFinanceiro {
  id: string;
  tenantId: string;
  tipo: TipoLancamentoFinanceiro;
  categoria: string;
  descricao?: string;
  valor: number;
  data: string;
  usuarioId: string;
  criadoEm: string;
}

/** Resumo de fluxo de caixa consumido pela tela Financeiro. */
export interface ResumoFinanceiro {
  receitaVendas: number;
  custoEstoque: number;
  receitasAvulsas: number;
  despesasAvulsas: number;
  saldo: number;
}

/** Loja que o usuário logado pode acessar — a de origem ou concedida via
 * AcessoLoja (dono de conta ENTERPRISE controlando mais de uma loja). */
export interface LojaResumo {
  id: string;
  nomeFantasia: string;
}

/** Registro da trilha de auditoria — ver RegistroAuditoria no schema. */
export interface RegistroAuditoria {
  id: string;
  usuarioNome: string;
  acao: string;
  detalhe?: string;
  criadoEm: string;
}

/** Sugestão de reposição de estoque pra um produto no mínimo ou abaixo. */
export interface SugestaoReposicao {
  id: string;
  nome: string;
  sku: string;
  quantidadeEmEstoque: number;
  estoqueMinimo: number;
  vendidoUltimos30Dias: number;
  quantidadeSugerida: number;
}

/** Histórico de compras de um cliente específico. */
export interface HistoricoCliente {
  totalGasto: number;
  quantidadeCompras: number;
  vendas: Array<{
    id: string;
    timestamp: string;
    valorTotal: number;
    formaPagamento?: FormaPagamento;
    quantidadeItens: number;
    itens: Array<{ nome: string; quantidade: number; subtotal: number }>;
  }>;
}

/** Faturamento consolidado somando as lojas da empresa — só ENTERPRISE. */
export interface RelatorioConsolidado {
  faturamentoTotal: number;
  quantidadeVendasTotal: number;
  lojas: Array<{ tenantId: string; nomeFantasia: string; faturamento: number; quantidadeVendas: number }>;
}

/** Um produto a importar em massa (linha de uma planilha CSV). */
export interface ProdutoParaImportar {
  nome: string;
  sku: string;
  categoria: string;
  precoCusto: number;
  precoVenda: number;
  quantidadeEmEstoque: number;
  estoqueMinimo: number;
}

// ----------------------------------------------------------------------------
// PAINEL ADMIN DA PLATAFORMA (Total Software) — espelha GET /admin/empresas
// ----------------------------------------------------------------------------

export interface UsuarioAdmin {
  id: string;
  nome: string;
  email: string;
  cpf?: string;
  telefone?: string;
  papel: PapelUsuario;
  /** Conta principal da loja (quem administra a assinatura). */
  raiz: boolean;
  ativo: boolean;
  criadoEm: string;
}

export interface LojaAdmin {
  id: string;
  nomeFantasia: string;
  razaoSocial?: string;
  cnpj: string;
  telefone?: string;
  email?: string;
  site?: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  regimeTributario?: string;
  endereco: EnderecoTenant;
  ativo: boolean;
  criadoEm: string;
  indicadores: {
    produtos: number;
    vendasDoMes: number;
    faturamentoDoMes: number;
    ultimaVenda?: string;
  };
  usuarios: UsuarioAdmin[];
}

export interface EmpresaAdmin {
  id: string;
  nome: string;
  planoAtual: PlanoSaaS;
  assinatura: ResumoAssinaturaTenant;
  trialExpiraEm?: string;
  ativo: boolean;
  criadoEm: string;
  lojas: LojaAdmin[];
}

// ----------------------------------------------------------------------------
// GESTÃO DE LOJAS (tela /lojas, plano Enterprise) — espelha GET /lojas
// ----------------------------------------------------------------------------

export interface LojaGestao {
  id: string;
  nomeFantasia: string;
  razaoSocial?: string;
  cnpj: string;
  telefone?: string;
  email?: string;
  site?: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  regimeTributario?: string;
  endereco: EnderecoTenant;
  logoDaLojaUrl: string;
  corPrincipalDoTema: string;
  fusoHorario: string;
  exigirSenhaAoAbrirCaixa: boolean;
  ativo: boolean;
  criadoEm: string;
  /** É a loja em que o usuário está logado agora. */
  atual: boolean;
  indicadores: { usuarios: number; produtos: number; vendasDoMes: number; faturamentoDoMes: number };
}

/** Quem pode entrar numa loja: usuário dela (PROPRIO) ou com acesso extra (CONCEDIDO). */
export interface AcessoDaLoja {
  id: string;
  nome: string;
  email: string;
  papel: PapelUsuario;
  ativo: boolean;
  origem: 'PROPRIO' | 'CONCEDIDO';
  concedidoEm?: string;
}

export interface UsuarioDaEmpresa {
  id: string;
  nome: string;
  email: string;
  papel: PapelUsuario;
  lojaId: string;
  lojaNome: string;
}

/** Resposta de GET /assinatura (tela Meu plano). */
export interface AssinaturaResumo {
  plano: PlanoSaaS;
  status: StatusAssinatura;
  trialExpiraEm: string | null;
  acessoAte: string | null;
  canceladaEm: string | null;
  /** Plano do checkout aberto, ainda não pago. */
  planoPendente: PlanoSaaS | null;
  acessoExpirado: 'TRIAL' | 'ASSINATURA' | null;
  precos: { STARTER: number; PRO: number };
  /** false enquanto o Mercado Pago não estiver configurado no servidor. */
  pagamentoDisponivel: boolean;
}
