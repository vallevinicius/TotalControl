import { describe, expect, it } from 'vitest';
import { app, criarEmpresa, criarProduto, entrar, prisma, request } from './helpers/index.js';
import { caixaDeSaidaDeTeste } from '../src/lib/email.js';
import { avisarPagamentoRecusado, executarAvisos } from '../src/lib/avisos.js';

const emailsPara = (email: string) => caixaDeSaidaDeTeste.filter((e) => e.para === email);
const DIA = 86_400_000;

describe('avisos por e-mail', () => {
  it('teste grátis acabando: avisa uma vez só, mesmo rodando várias vezes', async () => {
    const e = await criarEmpresa({ plano: 'STARTER', trialExpiraEm: new Date(Date.now() + 2 * DIA) });
    await executarAvisos();
    await executarAvisos();
    const mails = emailsPara(e.dono.email).filter((m) => /teste grátis termina/.test(m.assunto));
    expect(mails).toHaveLength(1);
    expect(mails[0].texto).toMatch(/\/plano/);
  });

  it('teste longe do fim não avisa; depois que acabou, avisa uma vez', async () => {
    const longe = await criarEmpresa({ plano: 'STARTER', trialExpiraEm: new Date(Date.now() + 10 * DIA) });
    const acabou = await criarEmpresa({ plano: 'STARTER', trialExpiraEm: new Date(Date.now() - 1 * DIA) });
    await executarAvisos();
    expect(emailsPara(longe.dono.email)).toHaveLength(0);
    expect(emailsPara(acabou.dono.email).filter((m) => /terminou/.test(m.assunto))).toHaveLength(1);
  });

  it('quem já assina não recebe aviso de teste', async () => {
    const e = await criarEmpresa({ plano: 'PRO', trialExpiraEm: new Date(Date.now() + 1 * DIA) });
    await prisma.empresa.update({ where: { id: e.empresa.id }, data: { assinaturaStatus: 'ATIVA' } });
    await executarAvisos();
    expect(emailsPara(e.dono.email)).toHaveLength(0);
  });

  it('assinatura cancelada perto do fim do período avisa', async () => {
    const e = await criarEmpresa({ plano: 'PRO' });
    await prisma.empresa.update({ where: { id: e.empresa.id }, data: { assinaturaStatus: 'CANCELADA', acessoAte: new Date(Date.now() + 2 * DIA) } });
    await executarAvisos();
    expect(emailsPara(e.dono.email).some((m) => /termina em/.test(m.assunto))).toBe(true);
  });

  it('estoque baixo: lista os produtos, no máximo um resumo por semana', async () => {
    const e = await criarEmpresa({ plano: 'PRO' });
    const p = await criarProduto(e.loja.id, { nome: 'Quase acabando', estoque: 1 }); // mínimo 1 no helper
    await criarProduto(e.loja.id, { nome: 'Sobrando', estoque: 50 });
    await executarAvisos();
    await executarAvisos();
    const mails = emailsPara(e.dono.email).filter((m) => /estoque baixo/.test(m.assunto));
    expect(mails).toHaveLength(1);
    expect(mails[0].texto).toContain('Quase acabando');
    expect(mails[0].texto).not.toContain('Sobrando');
    void p;
  });

  it('contas atrasadas e vencendo entram num resumo', async () => {
    const e = await criarEmpresa({ plano: 'PRO' });
    const { auth } = await entrar(e.dono.email);
    const dia = (d: number) => new Date(Date.now() + d * DIA).toISOString().slice(0, 10);
    await request(app).post('/api/financeiro/contas').set(auth).send({ tipo: 'DESPESA', categoria: 'Aluguel', valor: 1500, vencimento: dia(-2) });
    await request(app).post('/api/financeiro/contas').set(auth).send({ tipo: 'DESPESA', categoria: 'Luz', valor: 300, vencimento: dia(0) });
    await executarAvisos();
    const mail = emailsPara(e.dono.email).find((m) => /em atraso/.test(m.assunto))!;
    expect(mail).toBeTruthy();
    expect(mail.texto).toContain('Aluguel');
    expect(mail.texto).toContain('Luz');
  });

  it('respeita o desligamento dos avisos pela tela Empresa', async () => {
    const e = await criarEmpresa({ plano: 'STARTER', trialExpiraEm: new Date(Date.now() + 1 * DIA) });
    const { auth } = await entrar(e.dono.email);
    expect((await request(app).put('/api/tenant/avisos').set(auth).send({ ativo: false })).body.ativo).toBe(false);
    expect((await request(app).get('/api/auth/me').set(auth)).body.tenant.avisosEmail).toBe(false);
    await executarAvisos();
    expect(emailsPara(e.dono.email)).toHaveLength(0);
  });

  it('pagamento recusado avisa na hora, uma vez por dia', async () => {
    const e = await criarEmpresa({ plano: 'PRO' });
    expect(await avisarPagamentoRecusado(e.empresa.id)).toBe(true);
    expect(await avisarPagamentoRecusado(e.empresa.id)).toBe(false);
    expect(emailsPara(e.dono.email).filter((m) => /cobrar/.test(m.assunto))).toHaveLength(1);
  });

  it('empresa suspensa não recebe aviso', async () => {
    const e = await criarEmpresa({ plano: 'STARTER', trialExpiraEm: new Date(Date.now() + 1 * DIA) });
    await prisma.empresa.update({ where: { id: e.empresa.id }, data: { ativo: false } });
    await executarAvisos();
    expect(emailsPara(e.dono.email)).toHaveLength(0);
  });
});
