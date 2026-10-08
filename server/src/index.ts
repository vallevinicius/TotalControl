import { app } from './app.js';
import { garantirAdminPlataforma } from './lib/adminBootstrap.js';
import { limparSessoesAntigas } from './lib/sessao.js';
import { executarAvisos } from './lib/avisos.js';
import { log, reportarErro } from './lib/observabilidade.js';

const PORT = process.env.PORT ? Number(process.env.PORT) : 4000;


process.on('unhandledRejection', (motivo) => {
  log('error', 'promessa_rejeitada', { erro: motivo instanceof Error ? motivo.stack ?? motivo.message : String(motivo) });
  void reportarErro(motivo);
});
process.on('uncaughtException', async (erro) => {
  log('error', 'excecao_nao_capturada', { erro: erro.stack ?? erro.message });
  await reportarErro(erro); // dá tempo de o aviso sair antes do processo cair
  process.exit(1);
});

// Falha ao garantir o admin (ex: banco fora do ar) não impede a API de subir:
// só avisa, e o painel admin fica sem login até o banco voltar e reiniciar.
garantirAdminPlataforma()
  .catch((erro) => console.error('Não foi possível preparar o admin da plataforma:', erro))
  .finally(() => {
    app.listen(PORT, () => {
      log('info', `API rodando em http://localhost:${PORT}`);
    });
    // Faxina das renovações vencidas: na subida e a cada 6 horas.
    const faxina = () => limparSessoesAntigas().catch((e) => console.error('Falha na limpeza de sessões:', e));
    faxina();
    setInterval(faxina, 6 * 3_600_000).unref();
    // Avisos por e-mail: de hora em hora, entre 8h e 20h (horário do servidor). Cada aviso
    // sai uma vez só (tabela AvisoEnviado), então repetir a verificação é inofensivo.
    setInterval(() => {
      const hora = new Date().getHours();
      if (hora >= 8 && hora <= 20) executarAvisos().catch((e) => console.error('Falha nos avisos por e-mail:', e));
    }, 3_600_000).unref();
  });
