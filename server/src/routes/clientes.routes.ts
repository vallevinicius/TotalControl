import { Router } from 'express';
import { VENDA_VALIDA } from '../lib/vendas.js';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { registrarAuditoria } from '../lib/auditoria.js';
import { requerirAcao, requerirAdmin, requerirTela } from '../middleware/permissao.js';
import { lerPaginacao, montarResposta } from '../lib/paginacao.js';

export const clientesRouter = Router();
clientesRouter.use(requireAuth, requerirTela(['clientes'], { leitura: ['pdv'] }));

function serializarCliente(c: {
  id: string;
  tenantId: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  cpfCnpj: string | null;
  criadoEm: Date;
}) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    nome: c.nome,
    telefone: c.telefone ?? undefined,
    email: c.email ?? undefined,
    cpfCnpj: c.cpfCnpj ?? undefined,
    criadoEm: c.criadoEm.toISOString(),
  };
}

clientesRouter.get('/', async (req, res) => {
  const { tenantId } = req.usuario!;
  const termo = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const { pagina, tamanho } = lerPaginacao(req.query);

  const where = {
    tenantId,
    ...(termo
      ? { OR: [{ nome: { contains: termo } }, { telefone: { contains: termo } }, { cpfCnpj: { contains: termo } }] }
      : {}),
  };

  const [clientes, total] = await Promise.all([
    prisma.cliente.findMany({
      where,
      orderBy: { nome: 'asc' },
      skip: (pagina - 1) * tamanho,
      take: tamanho,
    }),
    prisma.cliente.count({ where }),
  ]);

  res.json(montarResposta(clientes.map(serializarCliente), total, pagina, tamanho));
});

const clienteSchema = z.object({
  nome: z.string().min(1),
  telefone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  cpfCnpj: z.string().optional(),
});

clientesRouter.post('/', async (req, res) => {
  const { tenantId } = req.usuario!;
  const parse = clienteSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }

  const cliente = await prisma.cliente.create({
    data: { tenantId, nome: parse.data.nome, telefone: parse.data.telefone, email: parse.data.email || undefined, cpfCnpj: parse.data.cpfCnpj },
  });
  res.status(201).json(serializarCliente(cliente));
});

const importarClientesSchema = z.object({
  clientes: z
    .array(
      z.object({
        nome: z.string().trim().min(1).max(191),
        telefone: z.string().trim().max(30).optional(),
        email: z.string().trim().email().optional().or(z.literal('')),
        cpfCnpj: z.string().trim().max(30).optional(),
      }),
    )
    .min(1)
    .max(2000),
});

/** Importação em massa por planilha. Quem já existe (mesmo CPF/CNPJ na loja, ou
 * repetido no próprio arquivo) é ignorado, pra importar duas vezes não duplicar. */
clientesRouter.post('/importar', requerirTela(['clientes']), async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const parse = importarClientesSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: 'Arquivo inválido: confira os dados (nome é obrigatório e e-mail precisa ser válido).' });

  const existentes = await prisma.cliente.findMany({ where: { tenantId, cpfCnpj: { not: null } }, select: { cpfCnpj: true } });
  const jaTem = new Set(existentes.map((c) => c.cpfCnpj!.replace(/\D/g, '')));

  const novos: Array<{ tenantId: string; nome: string; telefone?: string; email?: string; cpfCnpj?: string }> = [];
  let ignorados = 0;
  for (const c of parse.data.clientes) {
    const doc = c.cpfCnpj?.replace(/\D/g, '');
    if (doc) {
      if (jaTem.has(doc)) {
        ignorados += 1;
        continue;
      }
      jaTem.add(doc);
    }
    novos.push({ tenantId, nome: c.nome, telefone: c.telefone || undefined, email: c.email || undefined, cpfCnpj: c.cpfCnpj || undefined });
  }

  if (novos.length > 0) await prisma.cliente.createMany({ data: novos });
  await registrarAuditoria(tenantId, usuarioId, 'cliente.importarCsv', `${novos.length} cliente(s), ${ignorados} ignorado(s)`);
  res.status(201).json({ criados: novos.length, ignorados });
});

clientesRouter.put('/:id', async (req, res) => {
  const { tenantId } = req.usuario!;
  const parse = clienteSchema.partial().safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }

  const cliente = await prisma.cliente.findFirst({ where: { id: req.params.id, tenantId } });
  if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado.' });

  // Campo enviado vazio apaga o valor ("" vira null); campo omitido não muda.
  const vazioParaNulo = (v: string | undefined) => (v === undefined ? undefined : v.trim() === '' ? null : v.trim());
  const atualizado = await prisma.cliente.update({
    where: { id: cliente.id },
    data: {
      nome: parse.data.nome,
      telefone: vazioParaNulo(parse.data.telefone),
      email: vazioParaNulo(parse.data.email),
      cpfCnpj: vazioParaNulo(parse.data.cpfCnpj),
    },
  });
  res.json(serializarCliente(atualizado));
});

/** Histórico de compras do cliente — últimas 50 vendas, mais recente primeiro. */
clientesRouter.get('/:id/historico', async (req, res) => {
  const { tenantId } = req.usuario!;
  const cliente = await prisma.cliente.findFirst({ where: { id: req.params.id, tenantId } });
  if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado.' });

  const vendas = await prisma.transacao.findMany({
    where: { tenantId, clienteId: cliente.id, ...VENDA_VALIDA },
    include: { itens: true },
    orderBy: { timestamp: 'desc' },
    take: 50,
  });

  res.json({
    totalGasto: Number(vendas.reduce((acc, v) => acc + Number(v.valorTotal), 0).toFixed(2)),
    quantidadeCompras: vendas.length,
    vendas: vendas.map((v) => ({
      id: v.id,
      timestamp: v.timestamp.toISOString(),
      valorTotal: Number(v.valorTotal),
      formaPagamento: v.formaPagamento ?? undefined,
      quantidadeItens: v.itens.reduce((acc, i) => acc + i.quantidade, 0),
      itens: v.itens.map((i) => ({ nome: i.nomeProdutoSnapshot, quantidade: i.quantidade, subtotal: Number(i.subtotal) })),
    })),
  });
});

clientesRouter.delete('/:id', requerirAcao('registros.excluir'), async (req, res) => {
  const { tenantId } = req.usuario!;
  const cliente = await prisma.cliente.findFirst({ where: { id: req.params.id, tenantId } });
  if (!cliente) return res.status(404).json({ erro: 'Cliente não encontrado.' });

  // As vendas do cliente são registros financeiros da loja e ficam; só o vínculo
  // com a pessoa é removido, junto com os dados pessoais dela (nome, telefone, CPF).
  await prisma.$transaction([
    prisma.transacao.updateMany({ where: { tenantId, clienteId: cliente.id }, data: { clienteId: null } }),
    prisma.cliente.delete({ where: { id: cliente.id } }),
  ]);
  await registrarAuditoria(tenantId, req.usuario!.id, 'cliente.excluir', cliente.nome);
  res.status(204).send();
});
