import { app } from './app.js';
import { garantirAdminPlataforma } from './lib/adminBootstrap.js';
import { limparSessoesAntigas } from './lib/sessao.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;


process.on('unhandledRejection', (motivo) => console.error('Promessa rejeitada sem tratamento:', motivo));
process.on('uncaughtException', (erro) => {
  console.error('Exceção não capturada, encerrando:', erro);
  process.exit(1);
});

// Falha ao garantir o admin (ex: banco fora do ar) não impede a API de subir:
// só avisa, e o painel admin fica sem login até o banco voltar e reiniciar.
garantirAdminPlataforma()
  .catch((erro) => console.error('Não foi possível preparar o admin da plataforma:', erro))
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`API rodando em http://localhost:${PORT}`);
    });
    // Faxina das renovações vencidas: na subida e a cada 6 horas.
    const faxina = () => limparSessoesAntigas().catch((e) => console.error('Falha na limpeza de sessões:', e));
    faxina();
    setInterval(faxina, 6 * 3_600_000).unref();
  });
