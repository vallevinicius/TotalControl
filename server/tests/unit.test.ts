import { describe, expect, it } from 'vitest';
import { cnpjValido, cpfValido, normalizarCnpj } from '../src/lib/documentos.js';
import { codigoAtual, gerarSegredoTotp, verificarTotp } from '../src/lib/totp.js';
import { senhaForte } from '../src/lib/senha.js';
import { verificarProducao } from '../src/lib/verificarProducao.js';
import { custoDaVenda, resumirLucro, segundaDaSemana } from '../src/lib/lucro.js';
import { calcularTrialExpiraEm, DIAS_TRIAL, motivoAcessoExpirado } from '../src/config/planos.js';

describe('documentos', () => {
  it('valida CNPJ pelos dígitos verificadores e normaliza a máscara', () => {
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(normalizarCnpj('11222333000181')).toBe('11.222.333/0001-81');
    expect(cnpjValido('11.222.333/0001-82')).toBe(false);
    expect(cnpjValido('00000000000000')).toBe(false);
    expect(normalizarCnpj('123')).toBeNull();
  });

  it('valida CPF', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cpfValido('529.982.247-26')).toBe(false);
  });
});

describe('TOTP (2FA)', () => {
  it('gera o código do vetor de teste da RFC 6238', () => {
    const segredo = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
    const relogio = Date.now;
    try {
      Date.now = () => 59_000;
      expect(verificarTotp(segredo, '287082')).not.toBeNull();
      expect(verificarTotp(segredo, '000000')).toBeNull();
    } finally {
      Date.now = relogio;
    }
  });

  it('aceita o código vigente de um segredo novo', () => {
    const segredo = gerarSegredoTotp();
    expect(segredo).toHaveLength(32);
    expect(verificarTotp(segredo, codigoAtual(segredo))).not.toBeNull();
  });
});

describe('política de senha', () => {
  it('exige 8+ caracteres com letra e número', () => {
    expect(senhaForte.safeParse('Teste@123').success).toBe(true);
    expect(senhaForte.safeParse('curta1').success).toBe(false);
    expect(senhaForte.safeParse('somenteletras').success).toBe(false);
    expect(senhaForte.safeParse('12345678').success).toBe(false);
  });
});

describe('acesso por assinatura', () => {
  const agora = new Date('2026-10-07T12:00:00Z');
  const ontem = new Date('2026-10-06T12:00:00Z');
  const amanha = new Date('2026-10-08T12:00:00Z');

  it('teste grátis vencido sem assinatura bloqueia; com assinatura ativa não', () => {
    expect(motivoAcessoExpirado({ trialExpiraEm: ontem, assinaturaStatus: 'NENHUMA', acessoAte: null }, agora)).toBe('TRIAL');
    expect(motivoAcessoExpirado({ trialExpiraEm: ontem, assinaturaStatus: 'ATIVA', acessoAte: amanha }, agora)).toBeNull();
    expect(motivoAcessoExpirado({ trialExpiraEm: amanha, assinaturaStatus: 'NENHUMA', acessoAte: null }, agora)).toBeNull();
  });

  it('assinatura cancelada vale até o fim do período pago', () => {
    expect(motivoAcessoExpirado({ trialExpiraEm: null, assinaturaStatus: 'CANCELADA', acessoAte: amanha }, agora)).toBeNull();
    expect(motivoAcessoExpirado({ trialExpiraEm: null, assinaturaStatus: 'CANCELADA', acessoAte: ontem }, agora)).toBe('ASSINATURA');
  });
});

describe('calcularTrialExpiraEm', () => {
  const base = new Date('2026-01-10T12:00:00Z');

  it('usa os dias de teste padrão quando nenhum prazo é informado', () => {
    const fim = calcularTrialExpiraEm(undefined, base);
    expect(Math.round((fim.getTime() - base.getTime()) / 86_400_000)).toBe(DIAS_TRIAL);
  });

  it('soma os dias de carência informados sem alterar a data de origem', () => {
    const fim = calcularTrialExpiraEm(60, base);
    expect(Math.round((fim.getTime() - base.getTime()) / 86_400_000)).toBe(60);
    expect(base.toISOString()).toBe('2026-01-10T12:00:00.000Z');
  });

  it('a carência vencida bloqueia o acesso e a vigente não', () => {
    const agora = new Date('2026-03-01T12:00:00Z');
    const base = { assinaturaStatus: 'NENHUMA', acessoAte: null };
    expect(motivoAcessoExpirado({ ...base, trialExpiraEm: calcularTrialExpiraEm(30, new Date('2026-01-01T12:00:00Z')) }, agora)).toBe('TRIAL');
    expect(motivoAcessoExpirado({ ...base, trialExpiraEm: calcularTrialExpiraEm(90, new Date('2026-01-01T12:00:00Z')) }, agora)).toBeNull();
  });
});

describe('verificarProducao', () => {
  const ok = {
    NODE_ENV: 'production',
    DATABASE_URL: 'mysql://app:s3nha@db:3306/totalcontrol',
    JWT_SECRET: 'a'.repeat(48),
    ADMIN_EMAIL: 'admin@empresa.com.br',
    ADMIN_SENHA: 'Senh@Forte123',
    APP_URL: 'https://app.empresa.com.br',
    API_PUBLIC_URL: 'https://app.empresa.com.br',
    TRUST_PROXY: '1',
    SMTP_HOST: 'smtp.provedor.com',
    SMTP_USER: 'u',
    SMTP_PASS: 'p',
    MERCADOPAGO_ACCESS_TOKEN: 'APP_USR-123',
    MERCADOPAGO_WEBHOOK_SECRET: 'segredo',
    TURNSTILE_SECRET_KEY: '0x4AAA',
    SENTRY_DSN: 'https://x@sentry.io/1',
  };
  const vars = (env: Record<string, string | undefined>, nivel: 'erro' | 'aviso') =>
    verificarProducao(env).filter((p) => p.nivel === nivel).map((p) => p.variavel);

  it('configuração completa não tem erro nem aviso', () => {
    expect(verificarProducao(ok)).toEqual([]);
  });

  it('ambiente vazio acusa todos os erros obrigatórios', () => {
    expect(vars({}, 'erro')).toEqual(['NODE_ENV', 'DATABASE_URL', 'JWT_SECRET', 'ADMIN_EMAIL', 'ADMIN_SENHA', 'APP_URL']);
  });

  it('recusa segredo curto, valores de exemplo, root no banco e site sem https', () => {
    const erros = vars({ ...ok, JWT_SECRET: 'curto', ADMIN_SENHA: 'troque-por-uma-senha-forte', DATABASE_URL: 'mysql://root:x@db/app', APP_URL: 'http://app.com' }, 'erro');
    expect(erros).toEqual(['DATABASE_URL', 'JWT_SECRET', 'ADMIN_SENHA', 'APP_URL']);
  });

  it('serviços opcionais ausentes viram aviso, não erro', () => {
    const { SMTP_HOST: _a, MERCADOPAGO_ACCESS_TOKEN: _b, TURNSTILE_SECRET_KEY: _c, ...resto } = ok;
    expect(vars(resto, 'erro')).toEqual([]);
    expect(vars(resto, 'aviso')).toEqual(['SMTP_HOST', 'MERCADOPAGO_ACCESS_TOKEN', 'TURNSTILE_SECRET_KEY']);
  });
});

describe('lucro', () => {
  const item = (quantidade: number, custoUnitario: number | null, precoCusto: number) => ({ quantidade, custoUnitario, produto: { precoCusto } });

  it('custoDaVenda usa o custo gravado e, sem ele, o custo atual do produto', () => {
    expect(custoDaVenda([item(2, 3, 9), item(1, null, 4)])).toBe(10);
    expect(custoDaVenda([item(2, 0, 9)])).toBe(0); // custo gravado zero é válido, não cai no atual
    expect(custoDaVenda([])).toBe(0);
  });

  it('segundaDaSemana devolve a segunda da semana (domingo fecha a semana anterior)', () => {
    expect(segundaDaSemana('2026-03-11')).toBe('2026-03-09'); // quarta
    expect(segundaDaSemana('2026-03-09')).toBe('2026-03-09'); // segunda
    expect(segundaDaSemana('2026-03-15')).toBe('2026-03-09'); // domingo
    expect(segundaDaSemana('2026-03-01')).toBe('2026-02-23'); // atravessa o mês
  });

  it('resumirLucro separa hoje, semana e mês no fuso da loja', () => {
    const agora = new Date('2026-03-11T15:00:00Z'); // quarta, 12h em São Paulo
    const venda = (iso: string, valor: number, custo: number) => ({ timestamp: new Date(iso), valorTotal: valor, itens: [item(1, custo, 0)] });
    const r = resumirLucro(
      [
        venda('2026-03-11T14:00:00Z', 100, 40), // hoje
        venda('2026-03-10T14:00:00Z', 50, 20), // terça (semana)
        venda('2026-03-04T14:00:00Z', 30, 10), // semana passada (mês)
        venda('2026-02-27T14:00:00Z', 999, 1), // mês passado: fora
        venda('2026-03-12T14:00:00Z', 777, 1), // futuro: fora
      ],
      'America/Sao_Paulo',
      agora,
    );
    expect(r.hoje).toEqual({ faturamento: 100, custo: 40, lucro: 60, vendas: 1 });
    expect(r.semana).toEqual({ faturamento: 150, custo: 60, lucro: 90, vendas: 2 });
    expect(r.mes).toEqual({ faturamento: 180, custo: 70, lucro: 110, vendas: 3 });
    expect(r.desde).toEqual({ semana: '2026-03-09', mes: '2026-03-01' });
  });

  it('resumirLucro: venda das 23h cai no dia local, não no de UTC', () => {
    const agora = new Date('2026-03-11T15:00:00Z');
    const r = resumirLucro([{ timestamp: new Date('2026-03-11T02:00:00Z'), valorTotal: 10, itens: [] }], 'America/Sao_Paulo', agora);
    expect(r.hoje.vendas).toBe(0); // 23h do dia 10 em São Paulo
    expect(r.semana.vendas).toBe(1);
  });

  it('resumirLucro sem vendas devolve tudo zerado', () => {
    expect(resumirLucro([], 'America/Sao_Paulo').hoje).toEqual({ faturamento: 0, custo: 0, lucro: 0, vendas: 0 });
  });
});
