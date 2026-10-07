import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requerirAdmin, requerirTela } from '../middleware/permissao.js';
import { verificarLimiteRecurso } from '../middleware/plano.js';
import { contarProdutosComEstoqueBaixo } from '../lib/estoque.js';
import { lerPaginacao, montarResposta } from '../lib/paginacao.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { LIMITES_POR_PLANO } from '../config/planos.js';

export const produtosRouter = Router();
produtosRouter.use(requireAuth, requerirTela(['estoque'], { leitura: ['pdv'] }));

function serializarProduto(p: {
  id: string;
  tenantId: string;
  nome: string;
  sku: string;
  categoriaId: string;
  precoCusto: unknown;
  precoVenda: unknown;
  quantidadeEmEstoque: number;
  estoqueMinimo: number;
  atributosCustomizados: unknown;
  ativo: boolean;
  criadoEm: Date;
  atualizadoEm: Date;
}) {
  return {
    id: p.id,
    tenantId: p.tenantId,
    nome: p.nome,
    sku: p.sku,
    categoriaId: p.categoriaId,
    precoCusto: Number(p.precoCusto),
    precoVenda: Number(p.precoVenda),
    quantidadeEmEstoque: p.quantidadeEmEstoque,
    estoqueMinimo: p.estoqueMinimo,
    atributosCustomizados: p.atributosCustomizados ?? undefined,
    ativo: p.ativo,
    criadoEm: p.criadoEm.toISOString(),
    atualizadoEm: p.atualizadoEm.toISOString(),
  };
}

produtosRouter.get('/', async (req, res) => {
  const { tenantId } = req.usuario!;
  const termo = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const { pagina, tamanho } = lerPaginacao(req.query);

  const where = {
    tenantId,
    ativo: true,
    ...(termo ? { OR: [{ nome: { contains: termo } }, { sku: { contains: termo } }] } : {}),
  };

  const [produtos, total, produtosComEstoqueBaixo] = await Promise.all([
    prisma.produto.findMany({
      where,
      orderBy: { nome: 'asc' },
      skip: (pagina - 1) * tamanho,
      take: tamanho,
    }),
    prisma.produto.count({ where }),
    contarProdutosComEstoqueBaixo(tenantId),
  ]);

  res.json({
    ...montarResposta(produtos.map(serializarProduto), total, pagina, tamanho),
    produtosComEstoqueBaixo,
  });
});

/** Sugestão de reposição: produtos no mínimo ou abaixo, com uma sugestão de
 * quantidade baseada no ritmo de venda dos últimos 30 dias (o suficiente pra
 * cobrir mais 30 dias de venda, descontando o que já tem em estoque). Sem
 * histórico de venda, sugere só repor até o estoque mínimo. */
produtosRouter.get('/sugestao-reposicao', requerirTela(['estoque']), async (req, res) => {
  const { tenantId } = req.usuario!;

  const produtos = await prisma.produto.findMany({ where: { tenantId, ativo: true } });
  const baixos = produtos.filter((p) => p.quantidadeEmEstoque <= p.estoqueMinimo);
  if (baixos.length === 0) return res.json([]);

  const trintaDiasAtras = new Date();
  trintaDiasAtras.setDate(trintaDiasAtras.getDate() - 30);

  const itensVendidos = await prisma.itemTransacao.findMany({
    where: {
      productId: { in: baixos.map((p) => p.id) },
      transacao: { tenantId, tipo: 'SAIDA', timestamp: { gte: trintaDiasAtras } },
    },
    select: { productId: true, quantidade: true },
  });
  const vendidoPorProduto = new Map<string, number>();
  for (const item of itensVendidos) {
    vendidoPorProduto.set(item.productId, (vendidoPorProduto.get(item.productId) ?? 0) + item.quantidade);
  }

  res.json(
    baixos.map((p) => {
      const vendidoUltimos30Dias = vendidoPorProduto.get(p.id) ?? 0;
      const sugestao = Math.max(
        p.estoqueMinimo - p.quantidadeEmEstoque,
        vendidoUltimos30Dias - p.quantidadeEmEstoque,
        1,
      );
      return {
        id: p.id,
        nome: p.nome,
        sku: p.sku,
        quantidadeEmEstoque: p.quantidadeEmEstoque,
        estoqueMinimo: p.estoqueMinimo,
        vendidoUltimos30Dias,
        quantidadeSugerida: sugestao,
      };
    }),
  );
});

produtosRouter.get('/:id', async (req, res) => {
  const { tenantId } = req.usuario!;
  const produto = await prisma.produto.findFirst({ where: { id: req.params.id, tenantId } });
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });
  res.json(serializarProduto(produto));
});

const produtoSchema = z.object({
  nome: z.string().min(1),
  sku: z.string().min(1),
  categoriaId: z.string().min(1),
  precoCusto: z.number().nonnegative(),
  precoVenda: z.number().nonnegative(),
  quantidadeEmEstoque: z.number().int().nonnegative(),
  estoqueMinimo: z.number().int().nonnegative(),
  atributosCustomizados: z.array(z.object({ chave: z.string(), valor: z.union([z.string(), z.number(), z.boolean()]) })).optional(),
});

produtosRouter.post('/', async (req, res) => {
  const { tenantId } = req.usuario!;
  const parse = produtoSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }

  const skuExistente = await prisma.produto.findFirst({ where: { tenantId, sku: parse.data.sku } });
  if (skuExistente) {
    return res.status(409).json({ erro: 'Já existe um produto com este SKU.' });
  }

  const categoria = await prisma.categoria.findFirst({ where: { id: parse.data.categoriaId, tenantId } });
  if (!categoria) {
    return res.status(400).json({ erro: 'Categoria inválida.' });
  }

  const limiteExcedido = await verificarLimiteRecurso(tenantId, 'produtos');
  if (limiteExcedido) {
    return res.status(403).json(limiteExcedido);
  }

  const produto = await prisma.produto.create({
    data: { ...parse.data, tenantId },
  });
  res.status(201).json(serializarProduto(produto));
});

const importarSchema = z.object({
  produtos: z
    .array(
      z.object({
        nome: z.string().min(1),
        sku: z.string().min(1),
        categoria: z.string().min(1),
        precoCusto: z.number().nonnegative(),
        precoVenda: z.number().nonnegative(),
        quantidadeEmEstoque: z.number().int().nonnegative().default(0),
        estoqueMinimo: z.number().int().nonnegative().default(0),
      }),
    )
    .min(1)
    .max(500),
});

/** Importação em massa (CSV parseado no front, ver ImportarProdutosModal) —
 * categoria é resolvida/criada por nome, já que uma planilha não tem o id. */
produtosRouter.post('/importar', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const parse = importarSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }

  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { empresa: { select: { planoAtual: true } } },
  });
  if (!tenant) return res.status(404).json({ erro: 'Loja não encontrada.' });

  const limite = LIMITES_POR_PLANO[tenant.empresa.planoAtual].maxProdutos;
  const atual = await prisma.produto.count({ where: { tenantId, ativo: true } });
  if (limite !== null && atual + parse.data.produtos.length > limite) {
    return res.status(403).json({
      erro: `Importar ${parse.data.produtos.length} produto(s) ultrapassaria o limite de ${limite} do plano ${tenant.empresa.planoAtual} (você tem ${atual} cadastrados).`,
    });
  }

  const skus = parse.data.produtos.map((p) => p.sku);
  const skusDuplicadosNoArquivo = [...new Set(skus.filter((sku, i) => skus.indexOf(sku) !== i))];
  if (skusDuplicadosNoArquivo.length > 0) {
    return res.status(400).json({ erro: `SKU(s) duplicado(s) no arquivo: ${skusDuplicadosNoArquivo.join(', ')}` });
  }

  const skusExistentes = await prisma.produto.findMany({ where: { tenantId, sku: { in: skus } }, select: { sku: true } });
  if (skusExistentes.length > 0) {
    return res.status(409).json({ erro: `SKU(s) já cadastrados: ${skusExistentes.map((p) => p.sku).join(', ')}` });
  }

  const nomesCategorias = [...new Set(parse.data.produtos.map((p) => p.categoria.trim()))];
  const categoriasExistentes = await prisma.categoria.findMany({ where: { tenantId, nome: { in: nomesCategorias } } });
  const mapaCategorias = new Map(categoriasExistentes.map((c) => [c.nome, c.id]));

  const criados = await prisma.$transaction(async (tx) => {
    for (const nome of nomesCategorias) {
      if (!mapaCategorias.has(nome)) {
        const nova = await tx.categoria.create({ data: { tenantId, nome } });
        mapaCategorias.set(nome, nova.id);
      }
    }
    return Promise.all(
      parse.data.produtos.map((p) =>
        tx.produto.create({
          data: {
            tenantId,
            nome: p.nome,
            sku: p.sku,
            categoriaId: mapaCategorias.get(p.categoria.trim())!,
            precoCusto: p.precoCusto,
            precoVenda: p.precoVenda,
            quantidadeEmEstoque: p.quantidadeEmEstoque,
            estoqueMinimo: p.estoqueMinimo,
          },
        }),
      ),
    );
  });

  await registrarAuditoria(tenantId, usuarioId, 'produto.importarCsv', `${criados.length} produto(s)`);
  res.status(201).json({ criados: criados.length });
});

const produtoUpdateSchema = produtoSchema.partial();

produtosRouter.put('/:id', async (req, res) => {
  const { tenantId } = req.usuario!;
  const parse = produtoUpdateSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }

  const produto = await prisma.produto.findFirst({ where: { id: req.params.id, tenantId } });
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });

  // SKU é único por loja, e a categoria precisa ser da própria loja (não dá pra
  // apontar um produto pra categoria de outra empresa).
  if (parse.data.sku && parse.data.sku !== produto.sku) {
    const duplicado = await prisma.produto.findFirst({ where: { tenantId, sku: parse.data.sku, id: { not: produto.id } } });
    if (duplicado) return res.status(409).json({ erro: 'Já existe um produto com esse SKU.' });
  }
  if (parse.data.categoriaId) {
    const categoria = await prisma.categoria.findFirst({ where: { id: parse.data.categoriaId, tenantId } });
    if (!categoria) return res.status(400).json({ erro: 'Categoria inválida.' });
  }

  const atualizado = await prisma.produto.update({
    where: { id: produto.id },
    data: parse.data,
  });
  res.json(serializarProduto(atualizado));
});

produtosRouter.delete('/:id', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const produto = await prisma.produto.findFirst({ where: { id: req.params.id, tenantId } });
  if (!produto) return res.status(404).json({ erro: 'Produto não encontrado.' });

  await prisma.produto.update({ where: { id: produto.id }, data: { ativo: false } });
  await registrarAuditoria(tenantId, usuarioId, 'produto.excluir', produto.nome);
  res.status(204).send();
});
