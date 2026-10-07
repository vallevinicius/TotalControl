import { existsSync, readFileSync } from 'node:fs';

/** URL do banco de TESTE: a do desenvolvimento (variável DATABASE_URL ou server/.env)
 * com o nome do banco trocado por `<nome>_test`. Os testes nunca usam o banco real. */
export function urlDoBancoDeTeste(): string {
  let url = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url && existsSync('.env')) {
    url = readFileSync('.env', 'utf8').match(/^DATABASE_URL=(.*)$/m)?.[1]?.replace(/^"|"$/g, '');
  }
  if (!url) throw new Error('DATABASE_URL não encontrada (variável de ambiente ou server/.env).');
  return url.replace(/\/([^/?]+)(\?.*)?$/, (_t, nome: string, resto?: string) => `/${nome.endsWith('_test') ? nome : `${nome}_test`}${resto ?? ''}`);
}
