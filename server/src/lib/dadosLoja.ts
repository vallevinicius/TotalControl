import { z } from 'zod';
import type { Tenant } from '@prisma/client';
import { prisma } from './prisma.js';
import { normalizarCnpj } from './documentos.js';

const texto = z.string().trim().max(191);

/** Dados cadastrais e operacionais editáveis de uma loja. Compartilhado entre a
 * edição de qualquer loja da empresa (Enterprise, tela Lojas) e a edição dos
 * dados da própria empresa (todos os planos, tela Empresa). */
export const editarLojaSchema = z.object({
  nomeFantasia: z.string().trim().min(2).max(191),
  razaoSocial: texto.min(2),
  cnpj: z.string().min(1),
  inscricaoEstadual: texto.optional(),
  inscricaoMunicipal: texto.optional(),
  regimeTributario: texto.optional(),
  telefone: texto.optional(),
  email: z.string().trim().email().optional().or(z.literal('')),
  site: texto.optional(),
  cep: texto.optional(),
  logradouro: texto.optional(),
  numero: texto.optional(),
  complemento: texto.optional(),
  bairro: texto.optional(),
  cidade: texto.optional(),
  uf: z.string().trim().length(2).optional().or(z.literal('')),
  fusoHorario: z.string().trim().min(3).max(64).optional(),
  exigirSenhaAoAbrirCaixa: z.boolean().optional(),
});

export type EdicaoDaLoja = z.infer<typeof editarLojaSchema>;

export type ResultadoEdicao = { ok: true; loja: Tenant } | { ok: false; status: number; erro: string };

/** Valida o que precisa de consulta (CNPJ único, fuso real) e grava. Campo de texto
 * opcional enviado vazio apaga o valor; campo omitido fica como está. */
export async function aplicarEdicaoDaLoja(loja: Tenant, dados: EdicaoDaLoja): Promise<ResultadoEdicao> {
  const { cnpj: cnpjInformado, email, fusoHorario, exigirSenhaAoAbrirCaixa, ...resto } = dados;

  const cnpj = normalizarCnpj(cnpjInformado);
  if (!cnpj) return { ok: false, status: 400, erro: 'CNPJ inválido. Confira os números.' };

  if (cnpj !== loja.cnpj) {
    const duplicado = await prisma.tenant.findUnique({ where: { cnpj } });
    if (duplicado) return { ok: false, status: 409, erro: 'Já existe uma loja cadastrada com este CNPJ.' };
  }

  if (fusoHorario) {
    try {
      new Intl.DateTimeFormat('pt-BR', { timeZone: fusoHorario });
    } catch {
      return { ok: false, status: 400, erro: 'Fuso horário inválido.' };
    }
  }

  const dadosTexto = Object.fromEntries(Object.entries(resto).map(([k, v]) => [k, v === '' ? null : v]));
  const atualizada = await prisma.tenant.update({
    where: { id: loja.id },
    data: { ...dadosTexto, email: email === '' ? null : email, cnpj, fusoHorario, exigirSenhaAoAbrirCaixa },
  });
  return { ok: true, loja: atualizada };
}
