import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { urlDoBancoDeTeste } from './url-teste.js';

/** Recria o banco de teste e aplica as migrations. Roda uma vez, antes de tudo. */
export default async function prepararBanco() {
  const url = urlDoBancoDeTeste();
  const nome = url.match(/\/([^/?]+)(\?.*)?$/)?.[1];
  if (!nome?.endsWith('_test')) throw new Error(`Recusado: "${nome}" não parece um banco de teste (precisa terminar em _test).`);

  // Conecta no banco administrativo "mysql" só pra poder criar/apagar o de teste.
  const admin = new PrismaClient({ datasources: { db: { url: url.replace(/\/[^/?]+(\?.*)?$/, '/mysql$1') } } });
  await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS \`${nome}\``);
  await admin.$executeRawUnsafe(`CREATE DATABASE \`${nome}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await admin.$disconnect();

  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
}
