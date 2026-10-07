import bcrypt from 'bcryptjs';
import request from 'supertest';
import { app } from '../../src/app.js';
import { prisma } from '../../src/lib/prisma.js';

export { app, prisma, request };

export const SENHA = 'Teste@123';
let contador = 0;
const unico = () => `${Date.now().toString(36)}${(contador++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export type Plano = 'FREE' | 'STARTER' | 'PRO' | 'ENTERPRISE';
export type Papel = 'ADMIN' | 'GERENTE' | 'OPERADOR_CAIXA';

/** Cria direto no banco uma empresa com 1 loja e a conta principal (ADMIN raiz). */
export async function criarEmpresa(opcoes: { plano?: Plano; trialExpiraEm?: Date | null } = {}) {
  const id = unico();
  const senhaHash = await bcrypt.hash(SENHA, 4); // custo baixo: teste não precisa de hash lento
  const empresa = await prisma.empresa.create({
    data: { nome: `Empresa ${id}`, planoAtual: opcoes.plano ?? 'PRO', trialExpiraEm: opcoes.trialExpiraEm ?? null },
  });
  const loja = await prisma.tenant.create({
    data: {
      empresaId: empresa.id,
      nomeFantasia: `Loja ${id}`,
      razaoSocial: `Loja ${id} LTDA`,
      cnpj: cnpjValidoUnico(),
      logoDaLojaUrl: 'https://exemplo.test/logo.png',
      corPrincipalDoTema: '#10B981',
    },
  });
  const dono = await prisma.usuario.create({
    data: { tenantId: loja.id, nome: 'Dono', email: `dono-${id}@teste.local`, senhaHash, papel: 'ADMIN', raiz: true },
  });
  await prisma.categoria.create({ data: { tenantId: loja.id, nome: 'Geral' } });
  return { empresa, loja, dono, donoSenha: SENHA };
}

export async function criarUsuario(tenantId: string, papel: Papel, permissoes?: string[]) {
  const id = unico();
  const senhaHash = await bcrypt.hash(SENHA, 4);
  return prisma.usuario.create({
    data: { tenantId, nome: `${papel} ${id}`, email: `${papel.toLowerCase()}-${id}@teste.local`, senhaHash, papel, permissoes: permissoes ?? undefined },
  });
}

export async function entrar(email: string, senha = SENHA) {
  const r = await request(app).post('/api/auth/login').send({ email, senha });
  if (r.status !== 200) throw new Error(`Login falhou (${r.status}): ${JSON.stringify(r.body)}`);
  return { token: r.body.token as string, refreshToken: r.body.refreshToken as string, auth: { Authorization: `Bearer ${r.body.token}` } };
}

export async function criarProduto(tenantId: string, dados: { nome?: string; preco?: number; estoque?: number } = {}) {
  const categoria = await prisma.categoria.findFirstOrThrow({ where: { tenantId } });
  const id = unico();
  return prisma.produto.create({
    data: {
      tenantId,
      nome: dados.nome ?? `Produto ${id}`,
      sku: `sku-${id}`,
      categoriaId: categoria.id,
      precoCusto: 5,
      precoVenda: dados.preco ?? 10,
      quantidadeEmEstoque: dados.estoque ?? 50,
      estoqueMinimo: 1,
    },
  });
}

/** Abre um caixa direto no banco (pra os testes de venda não repetirem o passo). */
export async function abrirCaixa(tenantId: string, usuarioId: string) {
  return prisma.caixa.create({ data: { tenantId, abertoPorId: usuarioId, valorAbertura: 0 } });
}

export const emailUnico = () => `pessoa-${unico()}@teste.local`;

/** CNPJ válido (dígitos verificadores certos) e diferente a cada chamada. */
export function cnpjValidoUnico(): string {
  const calc = (base: string) => {
    let peso = base.length - 7;
    let soma = 0;
    for (const n of base) {
      soma += Number(n) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const base = `${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}0001`;
  const d1 = calc(base);
  const d2 = calc(base + d1);
  const c = `${base}${d1}${d2}`;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}
