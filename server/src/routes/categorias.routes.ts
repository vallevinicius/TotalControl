import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requerirTela } from '../middleware/permissao.js';
import { registrarAuditoria } from '../lib/auditoria.js';

export const categoriasRouter = Router();
categoriasRouter.use(requireAuth, requerirTela(['estoque'], { leitura: ['pdv'] }));

categoriasRouter.get('/', async (req, res) => {
  const { tenantId } = req.usuario!;
  const categorias = await prisma.categoria.findMany({ where: { tenantId }, orderBy: { nome: 'asc' } });
  res.json(
    categorias.map((c) => ({
      id: c.id,
      tenantId: c.tenantId,
      nome: c.nome,
      atributosCustomizados: c.atributosCustomizados ?? undefined,
    })),
  );
});

const categoriaSchema = z.object({
  nome: z.string().min(1),
  atributosCustomizados: z.array(z.object({ chave: z.string(), tipo: z.enum(['TEXTO', 'NUMERO', 'DATA', 'BOOLEANO']) })).optional(),
});

categoriasRouter.post('/', async (req, res) => {
  const { tenantId } = req.usuario!;
  const parse = categoriaSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }

  const categoria = await prisma.categoria.create({ data: { ...parse.data, tenantId } });
  res.status(201).json({
    id: categoria.id,
    tenantId: categoria.tenantId,
    nome: categoria.nome,
    atributosCustomizados: categoria.atributosCustomizados ?? undefined,
  });
});

const renomearSchema = z.object({ nome: z.string().trim().min(1).max(191) });

categoriasRouter.put('/:id', async (req, res) => {
  const { tenantId } = req.usuario!;
  const parse = renomearSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Informe o nome da categoria.' });

  const categoria = await prisma.categoria.findFirst({ where: { id: req.params.id, tenantId } });
  if (!categoria) return res.status(404).json({ erro: 'Categoria não encontrada.' });
  const repetida = await prisma.categoria.findFirst({ where: { tenantId, nome: parse.data.nome, id: { not: categoria.id } } });
  if (repetida) return res.status(409).json({ erro: 'Já existe uma categoria com esse nome.' });

  const atualizada = await prisma.categoria.update({ where: { id: categoria.id }, data: { nome: parse.data.nome } });
  res.json({ id: atualizada.id, tenantId: atualizada.tenantId, nome: atualizada.nome });
});

/** Só exclui categoria sem produtos (nem inativos: o produto exige uma categoria). */
categoriasRouter.delete('/:id', async (req, res) => {
  const { tenantId } = req.usuario!;
  const categoria = await prisma.categoria.findFirst({ where: { id: req.params.id, tenantId } });
  if (!categoria) return res.status(404).json({ erro: 'Categoria não encontrada.' });

  const emUso = await prisma.produto.count({ where: { tenantId, categoriaId: categoria.id } });
  if (emUso > 0) {
    return res.status(409).json({ erro: `Há ${emUso} produto(s) nesta categoria. Mova-os para outra antes de excluir.` });
  }
  await prisma.categoria.delete({ where: { id: categoria.id } });
  await registrarAuditoria(tenantId, req.usuario!.id, 'categoria.excluir', categoria.nome);
  res.status(204).end();
});
