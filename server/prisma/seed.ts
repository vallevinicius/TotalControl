import crypto from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

/**
 * Dados de DEMONSTRAÇÃO para desenvolvimento: uma empresa Pro com uma loja, um
 * usuário administrador e alguns produtos. Nunca rode isto em produção.
 *
 * A senha NÃO é fixa: sai aleatória e aparece uma única vez no terminal (ou use
 * SEED_EMAIL e SEED_SENHA para escolher). Uma senha conhecida num seed é a
 * primeira coisa que um invasor tenta.
 */
const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('O seed de demonstração não roda em produção (NODE_ENV=production).');
  }

  const email = process.env.SEED_EMAIL ?? 'demo@totalcontrol.local';
  const senha = process.env.SEED_SENHA ?? `${crypto.randomBytes(9).toString('base64url')}a1`;

  if (await prisma.usuario.findUnique({ where: { email } })) {
    console.log(`O usuário ${email} já existe: nada a fazer.`);
    return;
  }

  const empresa = await prisma.empresa.create({ data: { nome: 'Minha Loja Demo', planoAtual: 'PRO' } });
  const loja = await prisma.tenant.create({
    data: {
      empresaId: empresa.id,
      nomeFantasia: 'Minha Loja Demo',
      razaoSocial: 'Minha Loja Demo Ltda',
      cnpj: '00.000.000/0001-91',
      logoDaLojaUrl: 'https://api.dicebear.com/7.x/initials/svg?seed=Minha%20Loja&backgroundType=gradientLinear',
      corPrincipalDoTema: '#10B981',
    },
  });
  await prisma.usuario.create({
    data: { tenantId: loja.id, nome: 'Administrador', email, senhaHash: await bcrypt.hash(senha, 10), papel: 'ADMIN', raiz: true },
  });

  const geral = await prisma.categoria.create({ data: { tenantId: loja.id, nome: 'Geral' } });
  const bebidas = await prisma.categoria.create({ data: { tenantId: loja.id, nome: 'Bebidas' } });
  await prisma.produto.createMany({
    data: [
      { tenantId: loja.id, nome: 'Produto de exemplo', sku: 'EXEMPLO-001', categoriaId: geral.id, precoCusto: 10, precoVenda: 19.9, quantidadeEmEstoque: 20, estoqueMinimo: 5 },
      { tenantId: loja.id, nome: 'Refrigerante 2L', sku: 'BEB-001', categoriaId: bebidas.id, precoCusto: 5.5, precoVenda: 8.9, quantidadeEmEstoque: 40, estoqueMinimo: 6 },
    ],
  });

  console.log('Seed concluído. Guarde estes dados, a senha não aparece de novo:');
  console.log(`  e-mail: ${email}`);
  console.log(`  senha:  ${senha}`);
}

main()
  .catch((erro) => {
    console.error(erro);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
