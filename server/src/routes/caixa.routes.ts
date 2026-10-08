import { Router } from 'express';
import { VENDA_VALIDA, totaisPorForma } from '../lib/vendas.js';
import { arredondar } from '../config/pdv.js';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAuth } from '../middleware/auth.js';
import { requerirAcao, requerirTela } from '../middleware/permissao.js';
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

/** Resumo do turno: vendas válidas (sem as canceladas), total por forma de pagamento e o
 * dinheiro que DEVERIA estar na gaveta (abertura + vendas em dinheiro + suprimentos - sangrias). */
async function calcularResumo(tenantId: string, caixaId: string) {
  const [caixa, vendas, movimentos] = await Promise.all([
    prisma.caixa.findUniqueOrThrow({ where: { id: caixaId }, select: { valorAbertura: true } }),
    prisma.transacao.findMany({ where: { tenantId, caixaId, ...VENDA_VALIDA }, include: { pagamentos: true } }),
    prisma.movimentoCaixa.findMany({ where: { tenantId, caixaId }, orderBy: { criadoEm: 'asc' } }),
  ]);

  const totalVendido = arredondar(vendas.reduce((acc, v) => acc + Number(v.valorTotal), 0));
  const totaisPorFormaPagamento = totaisPorForma(vendas);
  const totalSangrias = arredondar(movimentos.filter((m) => m.tipo === 'SANGRIA').reduce((a, m) => a + Number(m.valor), 0));
  const totalSuprimentos = arredondar(movimentos.filter((m) => m.tipo === 'SUPRIMENTO').reduce((a, m) => a + Number(m.valor), 0));
  const valorEsperadoEmDinheiro = arredondar(Number(caixa.valorAbertura) + (totaisPorFormaPagamento.DINHEIRO ?? 0) + totalSuprimentos - totalSangrias);

  return {
    totalVendido,
    quantidadeVendas: vendas.length,
    totaisPorFormaPagamento,
    totalSangrias,
    totalSuprimentos,
    valorEsperadoEmDinheiro,
    movimentos: movimentos.map((m) => ({ id: m.id, tipo: m.tipo, valor: Number(m.valor), motivo: m.motivo, criadoEm: m.criadoEm.toISOString() })),
  };
}

const usuarioSelect = { select: { nome: true } };

caixaRouter.get('/:id/vendas', async (req, res) => {
  const { tenantId } = req.usuario!;
  const caixa = await prisma.caixa.findFirst({ where: { id: req.params.id, tenantId } });
  if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrado.' });

  const vendas = await prisma.transacao.findMany({
    where: { tenantId, caixaId: caixa.id, tipo: 'SAIDA' }, // inclui as canceladas, marcadas como tal
    include: { itens: true, cliente: true, vendedor: true, pagamentos: true },
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
      cancelada: v.cancelada,
      motivoCancelamento: v.motivoCancelamento ?? undefined,
      pagamentos: v.pagamentos.map((p) => ({ forma: p.forma, valor: Number(p.valor), parcelas: p.parcelas })),
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

  res.json({
    ...serializarCaixa(atualizado),
    resumo,
    // Contado - esperado: sobra (+) ou falta (-) de dinheiro na gaveta.
    diferencaNoFechamento: parse.data.valorContado === undefined ? undefined : arredondar(parse.data.valorContado - resumo.valorEsperadoEmDinheiro),
  });
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
    where: { tenantId, ...VENDA_VALIDA, caixaId: { in: caixas.map((c) => c.id) } },
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

const movimentoSchema = z.object({
  tipo: z.enum(['SANGRIA', 'SUPRIMENTO']),
  valor: z.number().positive(),
  motivo: z.string().trim().min(3, 'Explique o motivo.').max(191),
});

/** Sangria (tira dinheiro da gaveta) ou suprimento (coloca troco). Só com o caixa aberto e
 * com a ação "sangria e suprimento"; a sangria não pode passar do dinheiro que há na gaveta. */
caixaRouter.post('/:id/movimentos', requerirAcao('caixa.sangria'), async (req, res) => {
  const { tenantId, id: usuarioId } = req.usuario!;
  const parse = movimentoSchema.safeParse(req.body);
  if (!parse.success) return res.status(400).json({ erro: parse.error.issues[0]?.message ?? 'Dados inválidos.' });

  const caixa = await prisma.caixa.findFirst({ where: { id: req.params.id, tenantId } });
  if (!caixa) return res.status(404).json({ erro: 'Caixa não encontrado.' });
  if (caixa.status !== 'ABERTO') return res.status(409).json({ erro: 'Esse caixa já está fechado.' });

  const { tipo, valor, motivo } = parse.data;
  if (tipo === 'SANGRIA') {
    const { valorEsperadoEmDinheiro } = await calcularResumo(tenantId, caixa.id);
    if (valor > valorEsperadoEmDinheiro + 0.004) {
      return res.status(400).json({ erro: `A sangria é maior que o dinheiro que deveria estar na gaveta (R$ ${valorEsperadoEmDinheiro.toFixed(2)}).` });
    }
  }

  const movimento = await prisma.movimentoCaixa.create({ data: { tenantId, caixaId: caixa.id, tipo, valor, motivo, usuarioId } });
  await registrarAuditoria(tenantId, usuarioId, tipo === 'SANGRIA' ? 'caixa.sangria' : 'caixa.suprimento', `R$ ${valor.toFixed(2)}: ${motivo}`);
  res.status(201).json({ id: movimento.id, tipo, valor, motivo, criadoEm: movimento.criadoEm.toISOString() });
});
