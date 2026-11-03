// Uso: npm run verificar:producao   (lê server/.env; no servidor, as variáveis do ambiente)
import 'dotenv/config';
import { verificarProducao } from '../src/lib/verificarProducao.js';

const problemas = verificarProducao(process.env);
const erros = problemas.filter((p) => p.nivel === 'erro');

for (const p of problemas) console.log(`${p.nivel === 'erro' ? 'ERRO ' : 'aviso'}  ${p.variavel.padEnd(28)} ${p.mensagem}`);
console.log(
  problemas.length === 0
    ? 'Tudo certo para produção.'
    : `\n${erros.length} erro(s), ${problemas.length - erros.length} aviso(s).`,
);
process.exit(erros.length > 0 ? 1 : 0);
