import { prisma } from './prisma.js';
import { emailAviso, enviarEmail } from './email.js';

const urlDoApp = () => (process.env.APP_URL ?? 'http://localhost:3099').replace(/\/$/, '');
const DIA = 86_400_000;
const data = (d: Date) => d.toISOString().slice(0, 10);

/** Quem recebe os avisos da empresa: a conta principal (raiz) ativa, se a empresa não os desligou. */
async function destinatario(empresaId: string): Promise<{ email: string; nome: string } | null> {
  const empresa = await prisma.empresa.findUnique({ where: { id: empresaId }, select: { avisosEmail: true, ativo: true } });
  if (!empresa?.avisosEmail || !empresa.ativo) return null;
  const raiz = await prisma.usuario.findFirst({ where: { raiz: true, ativo: true, tenant: { empresaId } }, select: { email: true, nome: true } });
  return raiz;
}

/** Envia o aviso uma única vez por (empresa, tipo, chave). Marca antes de enviar (dois
 * processos não mandam em duplicidade) e desmarca se o envio falhar, pra tentar de novo depois. */
export async function enviarAvisoUnico(
  empresaId: string,
  tipo: string,
  chave: string,
  montar: (nome: string) => Omit<Parameters<typeof enviarEmail>[0], 'para'>,
): Promise<boolean> {
  const alvo = await destinatario(empresaId);
  if (!alvo) return false;

  try {
    await prisma.avisoEnviado.create({ data: { empresaId, tipo, chave } });
  } catch {
    return false; // já enviado
  }
  try {
    await enviarEmail({ para: alvo.email, ...montar(alvo.nome) });
    return true;
  } catch (erro) {
    console.error(`Falha ao enviar o aviso ${tipo}:`, erro);
    await prisma.avisoEnviado.deleteMany({ where: { empresaId, tipo, chave } });
    return false;
  }
}

/** Cobrança recusada: avisa na hora (chamado quando a assinatura passa a "pausada"). */
export function avisarPagamentoRecusado(empresaId: string): Promise<boolean> {
  return enviarAvisoUnico(empresaId, 'PAGAMENTO_RECUSADO', data(new Date()), (nome) =>
    emailAviso('Não conseguimos cobrar a sua assinatura do Total Control', 'Pagamento recusado', [
      `Olá, ${nome}.`,
      'A última cobrança da sua assinatura foi recusada. Atualize a forma de pagamento no Mercado Pago ou assine de novo para não perder o acesso.',
    ], { botao: { texto: 'Ver meu plano', url: `${urlDoApp()}/plano` } }),
  );
}

/** Roda todas as verificações de aviso (idempotente: pode ser chamada várias vezes ao dia).
 * - teste grátis acabando ou acabado; assinatura cancelada chegando ao fim;
 * - estoque baixo (um resumo por semana); contas vencendo ou atrasadas (no máximo a cada 3 dias). */
export async function executarAvisos(agora = new Date()): Promise<{ enviados: number }> {
  let enviados = 0;
  const conta = (ok: boolean) => void (enviados += ok ? 1 : 0);
  const empresas = await prisma.empresa.findMany({ where: { ativo: true, avisosEmail: true } });

  for (const e of empresas) {
    // Teste grátis
    if (e.trialExpiraEm && e.assinaturaStatus !== 'ATIVA') {
      const dias = Math.ceil((e.trialExpiraEm.getTime() - agora.getTime()) / DIA);
      const venceuHaPouco = e.trialExpiraEm < agora && agora.getTime() - e.trialExpiraEm.getTime() < 3 * DIA;
      if (dias > 0 && dias <= 3) {
        conta(await enviarAvisoUnico(e.id, 'TRIAL_FIM_PROXIMO', data(e.trialExpiraEm), (nome) =>
          emailAviso(`Seu teste grátis termina em ${dias} dia(s)`, 'Seu teste grátis está acabando', [`Olá, ${nome}.`, `O teste grátis da sua empresa termina em ${dias} dia(s). Escolha um plano para continuar usando o Total Control sem interrupção. Seus dados ficam guardados.`], { botao: { texto: 'Escolher um plano', url: `${urlDoApp()}/plano` } }),
        ));
      } else if (venceuHaPouco) {
        conta(await enviarAvisoUnico(e.id, 'TRIAL_EXPIROU', data(e.trialExpiraEm), (nome) =>
          emailAviso('Seu teste grátis terminou', 'Seu teste grátis terminou', [`Olá, ${nome}.`, 'O período de teste terminou e o acesso está pausado. Escolha um plano para voltar: seus dados continuam guardados.'], { botao: { texto: 'Escolher um plano', url: `${urlDoApp()}/plano` } }),
        ));
      }
    }

    // Assinatura cancelada chegando ao fim
    if (e.assinaturaStatus === 'CANCELADA' && e.acessoAte) {
      const dias = Math.ceil((e.acessoAte.getTime() - agora.getTime()) / DIA);
      if (dias > 0 && dias <= 3) {
        conta(await enviarAvisoUnico(e.id, 'ASSINATURA_FIM_PROXIMO', data(e.acessoAte), (nome) =>
          emailAviso(`Seu acesso ao Total Control termina em ${dias} dia(s)`, 'Sua assinatura está chegando ao fim', [`Olá, ${nome}.`, `Você cancelou a assinatura e o acesso vai até ${e.acessoAte!.toLocaleDateString('pt-BR')}. Se mudou de ideia, assine de novo antes dessa data.`], { botao: { texto: 'Reativar assinatura', url: `${urlDoApp()}/plano` } }),
        ));
      }
    }

    // Estoque baixo (resumo semanal)
    const lojas = await prisma.tenant.findMany({ where: { empresaId: e.id, ativo: true }, select: { id: true, nomeFantasia: true } });
    const baixos: string[] = [];
    for (const loja of lojas) {
      const produtos = await prisma.produto.findMany({ where: { tenantId: loja.id, ativo: true }, select: { nome: true, quantidadeEmEstoque: true, estoqueMinimo: true } });
      for (const p of produtos.filter((x) => x.quantidadeEmEstoque <= x.estoqueMinimo)) {
        baixos.push(`${lojas.length > 1 ? `${loja.nomeFantasia}: ` : ''}${p.nome} (${p.quantidadeEmEstoque} em estoque, mínimo ${p.estoqueMinimo})`);
      }
    }
    if (baixos.length > 0) {
      const semana = Math.floor(agora.getTime() / (7 * DIA));
      conta(await enviarAvisoUnico(e.id, 'ESTOQUE_BAIXO', String(semana), (nome) =>
        emailAviso(`${baixos.length} produto(s) com estoque baixo`, 'Hora de repor o estoque', [`Olá, ${nome}.`, 'Estes produtos estão no estoque mínimo ou abaixo dele:'], { lista: baixos.slice(0, 20), botao: { texto: 'Abrir o estoque', url: `${urlDoApp()}/estoque` } }),
      ));
    }

    // Contas a pagar/receber
    const hoje = new Date(data(agora));
    const abertas = await prisma.lancamentoFinanceiro.findMany({ where: { tenantId: { in: lojas.map((l) => l.id) }, vencimento: { not: null }, pagoEm: null } });
    const atrasadas = abertas.filter((c) => c.vencimento! < hoje);
    const proximas = abertas.filter((c) => c.vencimento! >= hoje && c.vencimento!.getTime() <= hoje.getTime() + DIA);
    if (atrasadas.length + proximas.length > 0) {
      const linha = (c: (typeof abertas)[number]) => `${c.tipo === 'RECEITA' ? 'A receber' : 'A pagar'}: ${c.categoria}, R$ ${Number(c.valor).toFixed(2).replace('.', ',')}, vence em ${c.vencimento!.toLocaleDateString('pt-BR', { timeZone: 'UTC' })}`;
      conta(await enviarAvisoUnico(e.id, 'CONTAS', String(Math.floor(agora.getTime() / (3 * DIA))), (nome) =>
        emailAviso(`${atrasadas.length ? `${atrasadas.length} conta(s) em atraso` : 'Contas vencendo'}`, 'Contas que precisam de atenção', [`Olá, ${nome}.`, atrasadas.length ? `${atrasadas.length} conta(s) estão em atraso e ${proximas.length} vencem hoje ou amanhã.` : `${proximas.length} conta(s) vencem hoje ou amanhã.`], { lista: [...atrasadas, ...proximas].slice(0, 20).map(linha), botao: { texto: 'Ver contas', url: `${urlDoApp()}/financeiro/contas` } }),
      ));
    }
  }
  return { enviados };
}
