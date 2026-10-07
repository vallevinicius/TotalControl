import type {
  Caixa,
  Categoria,
  Cliente,
  HistoricoCliente,
  LancamentoFinanceiro,
  Produto,
  ProdutoParaImportar,
  RegistroAuditoria,
  RelatorioConsolidado,
  RelatorioVendas,
  ResumoDashboard,
  ResumoFinanceiro,
  SugestaoReposicao,
  Tenant,
  Transacao,
  TelaComPermissao,
  LojaResumo,
  PaginaResultado,
  TipoLancamentoFinanceiro,
  Usuario,
  Vendedor,
  VendaResumo,
  EmpresaAdmin,
  LojaGestao,
  AcessoDaLoja,
  UsuarioDaEmpresa,
  AssinaturaResumo,
  FormaPagamento,
  AtributoCustomizadoDefinicao,
  AtributoCustomizadoValor,
} from '@/types';

/**
 * ============================================================================
 * apiService.ts
 * ----------------------------------------------------------------------------
 * Cliente HTTP real para a API do Total Control (server/ — Express + Prisma).
 * Substitui o antigo mockDatabaseService.ts: nenhuma tela manipula dados
 * diretamente, tudo passa por uma função async exportada aqui.
 *
 * O tenant/usuário não são mais passados por parâmetro — a API resolve isso
 * a partir do JWT enviado no header Authorization, guardado em localStorage.
 * ============================================================================
 */

const API_URL = import.meta.env.VITE_API_URL ?? '/api';
const CHAVE_TOKEN = 'total_control_token';
const CHAVE_REFRESH = 'total_control_refresh';

export function getToken(): string | null {
  return localStorage.getItem(CHAVE_TOKEN);
}

/** Guarda a sessão: token de acesso (curto) e, quando a API manda, o de renovação. */
export function setToken(token: string, refreshToken?: string): void {
  localStorage.setItem(CHAVE_TOKEN, token);
  if (refreshToken) localStorage.setItem(CHAVE_REFRESH, refreshToken);
}

export function limparToken(): void {
  localStorage.removeItem(CHAVE_TOKEN);
  localStorage.removeItem(CHAVE_REFRESH);
}

export class ErroApi extends Error {
  constructor(
    message: string,
    public status: number,
    public codigo?: string,
  ) {
    super(message);
  }
}

/** Loja em que a pessoa estava, lida do token de acesso (mesmo vencido), pra a
 * renovação manter a mesma loja em vez de voltar pra loja de origem. */
function tenantDoToken(token: string | null): string | undefined {
  try {
    const corpo = token?.split('.')[1];
    if (!corpo) return undefined;
    const json = JSON.parse(atob(corpo.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof json.tenantId === 'string' ? json.tenantId : undefined;
  } catch {
    return undefined;
  }
}

let renovacaoEmAndamento: Promise<boolean> | null = null;

/** Troca o token de renovação por um par novo. Várias requisições que vencem
 * juntas compartilham UMA renovação (senão a segunda usaria um token já trocado
 * e a API derrubaria a sessão como suspeita de roubo). */
function renovarSessao(): Promise<boolean> {
  const refreshToken = localStorage.getItem(CHAVE_REFRESH);
  if (!refreshToken) return Promise.resolve(false);

  renovacaoEmAndamento ??= (async () => {
    try {
      const resposta = await fetch(`${API_URL}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken, tenantId: tenantDoToken(getToken()) }),
      });
      if (!resposta.ok) return false;
      const { token, refreshToken: novo } = await resposta.json();
      setToken(token, novo);
      return true;
    } catch {
      return false;
    } finally {
      renovacaoEmAndamento = null;
    }
  })();
  return renovacaoEmAndamento;
}

async function requisitar<T>(caminho: string, opcoes: RequestInit = {}, jaRenovou = false): Promise<T> {
  const token = getToken();
  const resposta = await fetch(`${API_URL}${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opcoes.headers,
    },
  });

  if (!resposta.ok) {
    let mensagem = `Erro ${resposta.status} ao chamar ${caminho}`;
    let codigo: string | undefined;
    try {
      const corpo = await resposta.json();
      if (corpo?.erro) mensagem = corpo.erro;
      codigo = corpo?.codigo;
    } catch {
      // corpo sem JSON — mantém mensagem genérica
    }
    // Token de acesso vencido (a cada ~30 min): renova em silêncio e repete a chamada uma vez.
    if (resposta.status === 401 && codigo === 'TOKEN_EXPIRADO' && !jaRenovou && (await renovarSessao())) {
      return requisitar<T>(caminho, opcoes, true);
    }
    throw new ErroApi(mensagem, resposta.status, codigo);
  }

  if (resposta.status === 204) return undefined as T;
  return resposta.json() as Promise<T>;
}

// ----------------------------------------------------------------------------
// AUTENTICAÇÃO
// ----------------------------------------------------------------------------

export async function login(email: string, senha: string): Promise<void> {
  const { token, refreshToken } = await requisitar<{ token: string; refreshToken: string }>('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, senha }),
  });
  setToken(token, refreshToken);
}

export interface RegistrarLojaPayload {
  /** Aceite dos Termos e da Política de Privacidade (a API exige true). */
  aceitouTermos: boolean;
  nomeFantasia: string;
  razaoSocial: string;
  cnpj: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  regimeTributario?: string;
  telefone?: string;
  emailContato?: string;
  site?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  nomeAdmin: string;
  cpfAdmin?: string;
  telefoneAdmin?: string;
  email: string;
  senha: string;
}

export async function registrarLoja(payload: RegistrarLojaPayload): Promise<void> {
  const { token, refreshToken } = await requisitar<{ token: string; refreshToken: string }>('/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  setToken(token, refreshToken);
}

export async function getMe(): Promise<{ usuario: Usuario; tenant: Tenant; lojas: LojaResumo[] }> {
  return requisitar('/auth/me');
}

/** Pede o link de redefinição por e-mail (a resposta é a mesma exista ou não a conta). */
export async function esqueciSenha(email: string): Promise<void> {
  await requisitar('/auth/esqueci-senha', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function redefinirSenha(token: string, senha: string): Promise<void> {
  await requisitar('/auth/redefinir-senha', { method: 'POST', body: JSON.stringify({ token, senha }) });
}

/** Troca a senha de quem está logado; a API devolve uma sessão nova pra este aparelho continuar entrando. */
export async function alterarSenha(senhaAtual: string, novaSenha: string): Promise<void> {
  const { token, refreshToken } = await requisitar<{ token: string; refreshToken: string }>('/auth/alterar-senha', {
    method: 'POST',
    body: JSON.stringify({ senhaAtual, novaSenha }),
  });
  setToken(token, refreshToken);
}

export async function atualizarPerfil(dados: { nome: string; telefone?: string }): Promise<void> {
  await requisitar('/auth/perfil', { method: 'PUT', body: JSON.stringify(dados) });
}

export function logout(): void {
  // Avisa a API pra invalidar a renovação (sem esperar: sair não pode travar).
  const refreshToken = localStorage.getItem(CHAVE_REFRESH);
  if (refreshToken) {
    fetch(`${API_URL}/auth/logout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }),
    }).catch(() => undefined);
  }
  limparToken();
}

// ----------------------------------------------------------------------------
// ADMIN DA PLATAFORMA (Total Software)
// ----------------------------------------------------------------------------
// Sessão separada da loja — chave própria no localStorage. O painel /admin
// (src/components/Admin) usa essas funções pra gerir empresas, lojas e logins.

const CHAVE_TOKEN_ADMIN = 'total_control_admin_token';

export function getAdminToken(): string | null {
  return localStorage.getItem(CHAVE_TOKEN_ADMIN);
}

export function limparTokenAdmin(): void {
  localStorage.removeItem(CHAVE_TOKEN_ADMIN);
}

async function enviarLoginAdmin(caminho: string, corpo: unknown): Promise<{ desafio?: string }> {
  const resposta = await fetch(`${API_URL}/admin${caminho}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corpo),
  });

  if (!resposta.ok) {
    let mensagem = 'E-mail ou senha inválidos.';
    try {
      const dados = await resposta.json();
      if (dados?.erro) mensagem = dados.erro;
    } catch {
      // corpo sem JSON — mantém mensagem genérica
    }
    throw new ErroApi(mensagem, resposta.status);
  }

  const dados = await resposta.json();
  // Com a verificação em duas etapas ativa, ainda não há sessão: vem um desafio
  // que só vale junto com o código do aplicativo (confirmarCodigoAdmin).
  if (dados.precisaCodigo) return { desafio: dados.desafio };
  localStorage.setItem(CHAVE_TOKEN_ADMIN, dados.token);
  return {};
}

export function loginAdmin(email: string, senha: string): Promise<{ desafio?: string }> {
  return enviarLoginAdmin('/login', { email, senha });
}

export async function confirmarCodigoAdmin(desafio: string, codigo: string): Promise<void> {
  await enviarLoginAdmin('/login/2fa', { desafio, codigo });
}

async function requisitarAdmin<T>(caminho: string, opcoes: RequestInit = {}): Promise<T> {
  const token = getAdminToken();
  const resposta = await fetch(`${API_URL}/admin${caminho}`, {
    ...opcoes,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opcoes.headers,
    },
  });

  if (!resposta.ok) {
    let mensagem = `Erro ${resposta.status} ao chamar ${caminho}`;
    try {
      const corpo = await resposta.json();
      if (corpo?.erro) mensagem = corpo.erro;
    } catch {
      // corpo sem JSON — mantém mensagem genérica
    }
    throw new ErroApi(mensagem, resposta.status);
  }

  if (resposta.status === 204) return undefined as T;
  return resposta.json() as Promise<T>;
}

export function admin2faStatus(): Promise<{ ativo: boolean }> {
  return requisitarAdmin('/2fa');
}

export function admin2faIniciar(): Promise<{ segredo: string; otpauth: string; qrCode: string }> {
  return requisitarAdmin('/2fa/iniciar', { method: 'POST' });
}

export function admin2faAtivar(codigo: string): Promise<{ ativo: boolean }> {
  return requisitarAdmin('/2fa/ativar', { method: 'POST', body: JSON.stringify({ codigo }) });
}

export function admin2faDesativar(senha: string, codigo: string): Promise<{ ativo: boolean }> {
  return requisitarAdmin('/2fa/desativar', { method: 'POST', body: JSON.stringify({ senha, codigo }) });
}

export function adminListarEmpresas(): Promise<EmpresaAdmin[]> {
  return requisitarAdmin('/empresas');
}

export interface NovaEmpresaAdminPayload {
  nomeFantasia: string;
  razaoSocial?: string;
  cnpj: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  regimeTributario?: string;
  telefone?: string;
  email?: string;
  site?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
  planoAtual: EmpresaAdmin['planoAtual'];
  nomeAdmin: string;
  cpfAdmin?: string;
  telefoneAdmin?: string;
  emailAdmin: string;
  senhaAdmin: string;
}

export function adminCriarEmpresa(dados: NovaEmpresaAdminPayload): Promise<{ id: string; nome: string }> {
  return requisitarAdmin('/empresas', { method: 'POST', body: JSON.stringify(dados) });
}

export function adminDefinirPlano(empresaId: string, planoAtual: EmpresaAdmin['planoAtual']): Promise<void> {
  return requisitarAdmin(`/empresas/${empresaId}/plano`, { method: 'PUT', body: JSON.stringify({ planoAtual }) });
}

export function adminDefinirEmpresaAtiva(empresaId: string, ativo: boolean): Promise<void> {
  return requisitarAdmin(`/empresas/${empresaId}/ativo`, { method: 'PUT', body: JSON.stringify({ ativo }) });
}

export function adminExcluirEmpresa(empresaId: string): Promise<void> {
  return requisitarAdmin(`/empresas/${empresaId}`, { method: 'DELETE' });
}

export function adminDefinirLojaAtiva(lojaId: string, ativo: boolean): Promise<void> {
  return requisitarAdmin(`/lojas/${lojaId}/ativo`, { method: 'PUT', body: JSON.stringify({ ativo }) });
}

export function adminExcluirLoja(lojaId: string): Promise<void> {
  return requisitarAdmin(`/lojas/${lojaId}`, { method: 'DELETE' });
}

export function adminDefinirUsuarioAtivo(usuarioId: string, ativo: boolean): Promise<void> {
  return requisitarAdmin(`/usuarios/${usuarioId}/ativo`, { method: 'PUT', body: JSON.stringify({ ativo }) });
}

export async function adminResetarSenha(usuarioId: string): Promise<string> {
  const { senhaTemporaria } = await requisitarAdmin<{ senhaTemporaria: string }>(`/usuarios/${usuarioId}/resetar-senha`, {
    method: 'POST',
  });
  return senhaTemporaria;
}

/** Reemite o token pra outra loja que o usuário tem acesso (ver `lojas` em getMe). */
export async function trocarLoja(tenantId: string): Promise<void> {
  const { token } = await requisitar<{ token: string }>('/auth/trocar-loja', {
    method: 'POST',
    body: JSON.stringify({ tenantId }),
  });
  setToken(token);
}

/** Dados cadastrais de uma loja (criação e edição). Na edição, campo de texto
 * vazio apaga o valor; na criação, vazio é ignorado. */
export interface DadosLojaPayload {
  nomeFantasia: string;
  razaoSocial?: string;
  cnpj: string;
  inscricaoEstadual?: string;
  inscricaoMunicipal?: string;
  regimeTributario?: string;
  telefone?: string;
  email?: string;
  site?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  cidade?: string;
  uf?: string;
}

export interface EdicaoLojaPayload extends DadosLojaPayload {
  razaoSocial: string;
  fusoHorario?: string;
  exigirSenhaAoAbrirCaixa?: boolean;
}

/** Criação self-service de uma loja adicional pra mesma empresa — só ENTERPRISE. */
export async function criarLoja(dados: DadosLojaPayload): Promise<{ id: string; nomeFantasia: string }> {
  return requisitar('/lojas', { method: 'POST', body: JSON.stringify(dados) });
}

export async function listarLojas(): Promise<LojaGestao[]> {
  return requisitar('/lojas');
}

export async function editarLoja(id: string, dados: EdicaoLojaPayload): Promise<void> {
  await requisitar(`/lojas/${id}`, { method: 'PUT', body: JSON.stringify(dados) });
}

export async function definirLojaAtiva(id: string, ativo: boolean): Promise<void> {
  await requisitar(`/lojas/${id}/ativo`, { method: 'PATCH', body: JSON.stringify({ ativo }) });
}

/** Exclusão definitiva (LGPD): exige a senha de quem pede e o CNPJ da loja. */
export async function excluirLoja(id: string, confirmacao: { senha: string; cnpj: string }): Promise<void> {
  await requisitar(`/lojas/${id}`, { method: 'DELETE', body: JSON.stringify(confirmacao) });
}

export async function listarAcessosLoja(id: string): Promise<AcessoDaLoja[]> {
  return requisitar(`/lojas/${id}/acessos`);
}

export async function revogarAcessoLoja(tenantId: string, usuarioId: string): Promise<void> {
  await requisitar(`/lojas/${tenantId}/acessos/${usuarioId}`, { method: 'DELETE' });
}

export async function listarUsuariosDaEmpresa(): Promise<UsuarioDaEmpresa[]> {
  return requisitar('/lojas/usuarios');
}

// ----------------------------------------------------------------------------
// ASSINATURA (Mercado Pago) — tela Meu plano
// ----------------------------------------------------------------------------

export async function getAssinatura(): Promise<AssinaturaResumo> {
  return requisitar('/assinatura');
}

/** Atualiza o estado direto no Mercado Pago (usado ao voltar do checkout). */
export async function sincronizarAssinatura(): Promise<AssinaturaResumo> {
  return requisitar('/assinatura/sincronizar', { method: 'POST' });
}

/** Cria a assinatura e devolve o link do checkout do Mercado Pago. */
export async function iniciarCheckoutAssinatura(plano: 'STARTER' | 'PRO'): Promise<{ url: string }> {
  return requisitar('/assinatura/checkout', { method: 'POST', body: JSON.stringify({ plano }) });
}

export async function cancelarAssinatura(): Promise<AssinaturaResumo> {
  return requisitar('/assinatura/cancelar', { method: 'POST' });
}

// ----------------------------------------------------------------------------
// PRODUTOS
// ----------------------------------------------------------------------------

export interface RespostaProdutos extends PaginaResultado<Produto> {
  produtosComEstoqueBaixo: number;
}

/** Busca produtos com paginação; `termo` vazio traz a lista inteira (usado
 * tanto pela tela de Estoque quanto pela busca ao vivo do PDV). */
export async function searchProducts(termo: string, pagina = 1, tamanho = 20): Promise<RespostaProdutos> {
  return requisitar(`/produtos?q=${encodeURIComponent(termo)}&pagina=${pagina}&tamanho=${tamanho}`);
}

export async function getSugestaoReposicao(): Promise<SugestaoReposicao[]> {
  return requisitar('/produtos/sugestao-reposicao');
}

export async function importarProdutos(produtos: ProdutoParaImportar[]): Promise<{ criados: number }> {
  return requisitar('/produtos/importar', { method: 'POST', body: JSON.stringify({ produtos }) });
}

export interface NovoProdutoPayload {
  nome: string;
  sku: string;
  categoriaId: string;
  precoCusto: number;
  precoVenda: number;
  quantidadeEmEstoque: number;
  estoqueMinimo: number;
  atributosCustomizados?: AtributoCustomizadoValor[];
}

export async function createProduct(dados: NovoProdutoPayload): Promise<Produto> {
  return requisitar('/produtos', { method: 'POST', body: JSON.stringify(dados) });
}

export async function updateProduct(id: string, alteracoes: Partial<NovoProdutoPayload>): Promise<Produto> {
  return requisitar(`/produtos/${id}`, { method: 'PUT', body: JSON.stringify(alteracoes) });
}

export async function deactivateProduct(id: string): Promise<void> {
  await requisitar(`/produtos/${id}`, { method: 'DELETE' });
}

// ----------------------------------------------------------------------------
// CATEGORIAS
// ----------------------------------------------------------------------------

export async function getCategorias(): Promise<Categoria[]> {
  return requisitar('/categorias');
}

export async function createCategoria(
  nome: string,
  atributosCustomizados?: AtributoCustomizadoDefinicao[],
): Promise<Categoria> {
  return requisitar('/categorias', { method: 'POST', body: JSON.stringify({ nome, atributosCustomizados }) });
}

// ----------------------------------------------------------------------------
// CLIENTES
// ----------------------------------------------------------------------------

export async function getClientes(termo?: string, pagina = 1, tamanho = 20): Promise<PaginaResultado<Cliente>> {
  const params = new URLSearchParams();
  if (termo) params.set('q', termo);
  params.set('pagina', String(pagina));
  params.set('tamanho', String(tamanho));
  return requisitar(`/clientes?${params.toString()}`);
}

export interface NovoClientePayload {
  nome: string;
  telefone?: string;
  email?: string;
  cpfCnpj?: string;
}

export async function createCliente(dados: NovoClientePayload): Promise<Cliente> {
  return requisitar('/clientes', { method: 'POST', body: JSON.stringify(dados) });
}

/** Na edição, campo enviado como "" apaga o valor guardado. */
export async function updateCliente(id: string, dados: NovoClientePayload): Promise<Cliente> {
  return requisitar(`/clientes/${id}`, { method: 'PUT', body: JSON.stringify(dados) });
}

/** Apaga os dados pessoais do cliente; as vendas dele ficam, sem vínculo. */
export async function deleteCliente(id: string): Promise<void> {
  await requisitar(`/clientes/${id}`, { method: 'DELETE' });
}

export async function getHistoricoCliente(id: string): Promise<HistoricoCliente> {
  return requisitar(`/clientes/${id}/historico`);
}

// ----------------------------------------------------------------------------
// VENDAS (PDV)
// ----------------------------------------------------------------------------

export interface NovaVendaPayload {
  itens: Array<{ productId: string; quantidade: number; precoUnitario?: number }>;
  desconto?: number;
  taxas?: number;
  parcelas?: number;
  formaPagamento: FormaPagamento;
  clienteId?: string;
  vendedorId?: string;
}

export async function registerSale(payload: NovaVendaPayload): Promise<Transacao> {
  return requisitar('/vendas', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getVendas(): Promise<Transacao[]> {
  return requisitar('/vendas');
}

/** Desfaz a última venda do turno de caixa aberto (até 5 min depois dela). */
export async function desfazerUltimaVenda(): Promise<void> {
  await requisitar('/vendas/ultima/desfazer', { method: 'POST' });
}

// ----------------------------------------------------------------------------
// ESTOQUE
// ----------------------------------------------------------------------------

export interface NovaEntradaEstoquePayload {
  productId: string;
  quantidade: number;
  precoCustoUnitario?: number;
  observacao?: string;
}

export async function registerStockEntry(payload: NovaEntradaEstoquePayload): Promise<Transacao> {
  return requisitar('/estoque/entrada', { method: 'POST', body: JSON.stringify(payload) });
}

// ----------------------------------------------------------------------------
// DASHBOARD & RELATÓRIOS
// ----------------------------------------------------------------------------

export async function getDashboardResumo(): Promise<ResumoDashboard> {
  return requisitar('/dashboard/resumo');
}

export async function getRelatorioVendas(inicio?: string, fim?: string): Promise<RelatorioVendas> {
  const parametros = new URLSearchParams();
  if (inicio) parametros.set('inicio', inicio);
  if (fim) parametros.set('fim', fim);
  const query = parametros.toString() ? `?${parametros.toString()}` : '';
  return requisitar(`/relatorios/vendas${query}`);
}

export async function getRelatorioConsolidado(inicio?: string, fim?: string): Promise<RelatorioConsolidado> {
  const parametros = new URLSearchParams();
  if (inicio) parametros.set('inicio', inicio);
  if (fim) parametros.set('fim', fim);
  const query = parametros.toString() ? `?${parametros.toString()}` : '';
  return requisitar(`/relatorios/consolidado${query}`);
}

// ----------------------------------------------------------------------------
// FINANCEIRO
// ----------------------------------------------------------------------------

function queryPeriodo(inicio?: string, fim?: string): string {
  const parametros = new URLSearchParams();
  if (inicio) parametros.set('inicio', inicio);
  if (fim) parametros.set('fim', fim);
  return parametros.toString() ? `?${parametros.toString()}` : '';
}

export async function getResumoFinanceiro(inicio?: string, fim?: string): Promise<ResumoFinanceiro> {
  return requisitar(`/financeiro/resumo${queryPeriodo(inicio, fim)}`);
}

export async function getLancamentos(inicio?: string, fim?: string): Promise<LancamentoFinanceiro[]> {
  return requisitar(`/financeiro/lancamentos${queryPeriodo(inicio, fim)}`);
}

export interface NovoLancamentoPayload {
  tipo: TipoLancamentoFinanceiro;
  categoria: string;
  descricao?: string;
  valor: number;
  data: string;
}

export async function createLancamento(payload: NovoLancamentoPayload): Promise<LancamentoFinanceiro> {
  return requisitar('/financeiro/lancamentos', { method: 'POST', body: JSON.stringify(payload) });
}

export async function deleteLancamento(id: string): Promise<void> {
  await requisitar(`/financeiro/lancamentos/${id}`, { method: 'DELETE' });
}

// ----------------------------------------------------------------------------
// USUÁRIOS (logins da própria loja)
// ----------------------------------------------------------------------------

export async function getUsuarios(): Promise<Usuario[]> {
  return requisitar('/usuarios');
}

export interface NovoUsuarioPayload {
  nome: string;
  email: string;
  senha: string;
  papel: 'ADMIN' | 'GERENTE' | 'OPERADOR_CAIXA';
  permissoes: TelaComPermissao[];
}

export async function createUsuario(dados: NovoUsuarioPayload): Promise<Usuario> {
  return requisitar('/usuarios', { method: 'POST', body: JSON.stringify(dados) });
}

export async function setUsuarioAtivo(id: string, ativo: boolean): Promise<void> {
  await requisitar(`/usuarios/${id}/ativo`, { method: 'PUT', body: JSON.stringify({ ativo }) });
}

export interface AtualizarAcessoPayload {
  permissoes?: TelaComPermissao[];
  /** Só a conta principal da loja pode mudar o papel de outro login. */
  papel?: 'ADMIN' | 'GERENTE' | 'OPERADOR_CAIXA';
}

export async function atualizarAcessoUsuario(id: string, dados: AtualizarAcessoPayload): Promise<Usuario> {
  return requisitar(`/usuarios/${id}/acesso`, { method: 'PUT', body: JSON.stringify(dados) });
}

// ----------------------------------------------------------------------------
// CAIXA (turno de PDV — abrir/fechar)
// ----------------------------------------------------------------------------

export async function getCaixaAtual(): Promise<Caixa | null> {
  return requisitar('/caixa/atual');
}

export async function abrirCaixa(valorAbertura: number, senha?: string): Promise<Caixa> {
  return requisitar('/caixa/abrir', { method: 'POST', body: JSON.stringify({ valorAbertura, senha }) });
}

export interface FecharCaixaPayload {
  valorContado?: number;
  observacao?: string;
}

export async function fecharCaixa(caixaId: string, payload: FecharCaixaPayload): Promise<Caixa> {
  return requisitar(`/caixa/${caixaId}/fechar`, { method: 'POST', body: JSON.stringify(payload) });
}

export async function getHistoricoCaixas(): Promise<Caixa[]> {
  return requisitar('/caixa');
}

export async function getVendasDoCaixa(caixaId: string): Promise<VendaResumo[]> {
  return requisitar(`/caixa/${caixaId}/vendas`);
}

// ----------------------------------------------------------------------------
// VENDEDORES (quem fez a venda, pra apuração de comissão)
// ----------------------------------------------------------------------------

export async function getVendedores(): Promise<Vendedor[]> {
  return requisitar('/vendedores');
}

export interface NovoVendedorPayload {
  nome: string;
  comissaoPercentual?: number;
}

export async function createVendedor(dados: NovoVendedorPayload): Promise<Vendedor> {
  return requisitar('/vendedores', { method: 'POST', body: JSON.stringify(dados) });
}

export async function updateVendedor(
  id: string,
  dados: Partial<NovoVendedorPayload> & { ativo?: boolean },
): Promise<Vendedor> {
  return requisitar(`/vendedores/${id}`, { method: 'PUT', body: JSON.stringify(dados) });
}

// ----------------------------------------------------------------------------
// AUDITORIA (trilha de "quem fez o quê" — só a conta principal vê)
// ----------------------------------------------------------------------------

export async function getAuditoria(pagina = 1, tamanho = 20): Promise<PaginaResultado<RegistroAuditoria>> {
  return requisitar(`/auditoria?pagina=${pagina}&tamanho=${tamanho}`);
}

// ----------------------------------------------------------------------------
// LOJAS (multi-loja — só ENTERPRISE)
// ----------------------------------------------------------------------------

export async function concederAcessoLoja(tenantId: string, usuarioId: string): Promise<void> {
  await requisitar(`/lojas/${tenantId}/acessos`, { method: 'POST', body: JSON.stringify({ usuarioId }) });
}

// ----------------------------------------------------------------------------
// APARÊNCIA DA LOJA
// ----------------------------------------------------------------------------

export interface AparenciaPayload {
  corPrincipalDoTema: string;
  /** null = calcular o hover automaticamente a partir da cor principal. */
  corPrincipalHover?: string | null;
  logoDaLojaUrl?: string;
}

export async function atualizarAparencia(
  payload: AparenciaPayload,
): Promise<{ logoDaLojaUrl: string; corPrincipalDoTema: string; corPrincipalHover?: string }> {
  return requisitar('/tenant/aparencia', { method: 'PUT', body: JSON.stringify(payload) });
}
