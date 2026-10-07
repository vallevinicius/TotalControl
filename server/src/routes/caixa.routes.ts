import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requerirAdmin, requerirTela } from '../middleware/permissao.js';
import { registrarAuditoria } from '../lib/auditoria.js';

export const caixaRouter = Router();
caixaRouter.use(requireAuth, requerirTela(['pdv']));

function serializarCaixa(c: {
  id: string;
  tenantId: string;
  status: string;
  valorAbertura: unknown;
  abertoEm: Date;
  abertoPorId: string;
  abertoPor?: { nome: string };
  valorContadoFechamento: unknown;
  observacaoFechamento: string | null;
  fechadoEm: Date | null;
  fechadoPorId: string | null;
  fechadoPor?: { nome: string } | null;
}) {
  return {
    id: c.id,
    tenantId: c.tenantId,
    status: c.status,
    valorAbertura: Number(c.valorAbertura),
    abertoEm: c.abertoEm.toISOString(),
    abertoPorNome: c.abertoPor?.nome,
    valorContadoFechamento:
      c.valorContadoFechamento === null || c.valorContadoFechamento === undefined
        ? undefined
        : Number(c.valorContadoFechamento),
    observacaoFechamento: c.observacaoFechamento ?? undefined,
    fechadoEm: c.fechadoEm ? c.fechadoEm.toISOString() : undefined,
    fechadoPorNome: c.fechadoPor?.nome,
  };
}

async function calcularResumo(tenantId: string, caixaId: string) {
  const vendas = await prisma.transacao.findMany({ where: { tenantId, caixaId, tipo: 'SAIDA' } });

  const totalVendido = Number(vendas.reduce((acc, v) => acc + Number(v.valorTotal), 0).toFixed(2));
  const quantidadeVendas = vendas.length;

  const porFormaPagamento = new Map<string, number>();
  for (const v of vendas) {
    const chave = v.formaPagamento ?? 'OUTRO';
    porFormaPagamento.set(chave, (porFormaPagamento.get(chave) ?? 0) + Number(v.valorTotal));
  }

  return {
    totalVendido,
    quantidadeVendas,
    totaisPorFormaPagamento: Object.fromEntries(
      Array.from(porFormaPagamento.entries()).map(([k, v]) => [k, Number(v.toFixed(2))]),
    ),
  };
}

const usuarioSelect = { select: { nome: true } };

caixaRouter.get('/:id/vendas', async (req, res) => {
  const { tenantId } = req.usuario!;
  const caixa = await prisma.caixa.findFirst({ where: { id: req.params.id, tenantId } });
  if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrado.' });

  const vendas = await prisma.transacao.findMany({
    where: { tenantId, caixaId: caixa.id, tipo: 'SAIDA' },
    include: { itens: true, cliente: true, vendedor: true },
    orderBy: { timestamp: 'desc' },
  });

  res.json(
    vendas.map((v) => ({
      id: v.id,
      timestamp: v.timestamp.toISOString(),
      valorTotal: Number(v.valorTotal),
      formaPagamento: v.formaPagamento ?? undefined,
      clienteNome: v.cliente?.nome,
      vendedorNome: v.vendedor?.nome,
      quantidadeItens: v.itens.reduce((acc, i) => acc + i.quantidade, 0),
      // Detalhe suficiente pra reemitir o comprovante da venda.
      clienteTelefone: v.cliente?.telefone ?? undefined,
      desconto: Number(v.desconto),
      taxas: Number(v.taxas),
      parcelas: v.parcelas,
      itens: v.itens.map((i) => ({
        nome: i.nomeProdutoSnapshot,
        quantidade: i.quantidade,
        valorUnitario: Number(i.valorUnitarioPraticado),
        subtotal: Number(i.subtotal),
      })),
    })),
  );
});

caixaRouter.get('/atual', async (req, res) => {
  const { tenantId } = req.usuario!;
  const caixa = await prisma.caixa.findFirst({
    where: { tenantId, status: 'ABERTO' },
    include: { abertoPor: usuarioSelect },
  });
  if (!caixa) return res.json(null);

  const resumo = await calcularResumo(tenantId, caixa.id);
  res.json({ ...serializarCaixa(caixa), resumo });
});

const abrirSchema = z.object({ valorAbertura: z.number().nonnegative(), senha: z.string().optional() });

caixaRouter.post('/abrir', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const parse = abrirSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Informe o valor de abertura.' });
  }

  // Loja configurada pra exigir senha na abertura (Editar loja > Operação): quem
  // abre precisa confirmar a própria senha, pra ninguém abrir o caixa na sessão
  // que outra pessoa deixou logada.
  const loja = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { exigirSenhaAoAbrirCaixa: true } });
  if (loja?.exigirSenhaAoAbrirCaixa) {
    const solicitante = await prisma.usuario.findUnique({ where: { id: usuarioId }, select: { senhaHash: true } });
    const senhaConfere = parse.data.senha && solicitante ? await bcrypt.compare(parse.data.senha, solicitante.senhaHash) : false;
    if (!senhaConfere) {
      return res.status(403).json({ erro: 'Confirme a sua senha para abrir o caixa.', codigo: 'SENHA_CAIXA' });
    }
  }

  const jaAberto = await prisma.caixa.findFirst({ where: { tenantId, status: 'ABERTO' } });
  if (jaAberto) {
    return res.status(409).json({ erro: 'Já existe um caixa aberto.' });
  }

  const caixa = await prisma.caixa.create({
    data: { tenantId, valorAbertura: parse.data.valorAbertura, abertoPorId: usuarioId },
    include: { abertoPor: usuarioSelect },
  });

  res.status(201).json({ ...serializarCaixa(caixa), resumo: { totalVendido: 0, quantidadeVendas: 0, totaisPorFormaPagamento: {} } });
});

const fecharSchema = z.object({
  valorContado: z.number().nonnegative().optional(),
  observacao: z.string().optional(),
});

caixaRouter.post('/:id/fechar', async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const parse = fecharSchema.safeParse(req.body);
  if (!parse.success) {
    return res.status(400).json({ erro: 'Dados inválidos.', detalhes: parse.error.flatten() });
  }

  const caixa = await prisma.caixa.findFirst({ where: { id: req.params.id, tenantId } });
  if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrado.' });
  if (caixa.status === 'FECHADO') return res.status(400).json({ erro: 'Esse caixa já está fechado.' });

  const resumo = await calcularResumo(tenantId, caixa.id);

  const atualizado = await prisma.caixa.update({
    where: { id: caixa.id },
    data: {
      status: 'FECHADO',
      fechadoEm: new Date(),
      fechadoPorId: usuarioId,
      valorContadoFechamento: parse.data.valorContado,
      observacaoFechamento: parse.data.observacao,
    },
    include: { abertoPor: usuarioSelect, fechadoPor: usuarioSelect },
  });

  await registrarAuditoria(
    tenantId,
    usuarioId,
    'caixa.fechar',
    `Total vendido: ${resumo.totalVendido.toFixed(2)} em ${resumo.quantidadeVendas} venda(s)`,
  );

  res.json({ ...serializarCaixa(atualizado), resumo });
});

caixaRouter.get('/', async (req, res) => {
  const { tenantId } = req.usuario!;
  const caixas = await prisma.caixa.findMany({
    where: { tenantId },
    orderBy: { abertoEm: 'desc' },
    take: 50,
    include: { abertoPor: usuarioSelect, fechadoPor: usuarioSelect },
  });

  const totais = await prisma.transacao.groupBy({
    by: ['caixaId'],
    where: { tenantId, tipo: 'SAIDA', caixaId: { in: caixas.map((c) => c.id) } },
    _sum: { valorTotal: true },
    _count: { _all: true },
  });
  const totaisPorCaixa = new Map(totais.map((t) => [t.caixaId, t]));

  res.json(
    caixas.map((c) => {
      const total = totaisPorCaixa.get(c.id);
      return {
        ...serializarCaixa(c),
        resumo: {
          totalVendido: Number(total?._sum.valorTotal ?? 0),
          quantidadeVendas: total?._count._all ?? 0,
        },
      };
    }),
  );
});
