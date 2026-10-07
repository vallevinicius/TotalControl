import { describe, expect, it } from 'vitest';
import { cnpjValido, cpfValido, normalizarCnpj } from '../src/lib/documentos.js';
import { codigoAtual, gerarSegredoTotp, verificarTotp } from '../src/lib/totp.js';
import { senhaForte } from '../src/lib/senha.js';
import { motivoAcessoExpirado } from '../src/config/planos.js';

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
