import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { app, request } from './helpers/index.js';
import { reportarErro } from '../src/lib/observabilidade.js';

describe('observabilidade', () => {
  it('toda resposta traz X-Request-Id, e um id inválido do cliente é trocado', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    const ok = await request(app).get('/api/health').set('X-Request-Id', 'abc-12345678');
    expect(ok.headers['x-request-id']).toBe('abc-12345678');
    const ruim = await request(app).get('/api/health').set('X-Request-Id', 'tem espaço e é grande demais');
    expect(ruim.headers['x-request-id']).not.toBe('tem espaço e é grande demais');
  });

  describe('Sentry', () => {
    const recebidos: string[] = [];
    let servidor: http.Server;
    beforeAll(async () => {
      servidor = http.createServer((req, res) => {
        let corpo = '';
        req.on('data', (c) => (corpo += c));
        req.on('end', () => {
          recebidos.push(`${req.url}|${req.headers['x-sentry-auth']}|${corpo}`);
          res.end('{}');
        });
      });
      await new Promise<void>((ok) => servidor.listen(4997, ok));
    });
    afterAll(() => {
      delete process.env.SENTRY_DSN;
      servidor.close();
    });

    it('sem DSN não envia nada; com DSN manda o evento no formato de envelope', async () => {
      delete process.env.SENTRY_DSN;
      await reportarErro(new Error('sem dsn'));
      expect(recebidos).toHaveLength(0);

      process.env.SENTRY_DSN = 'http://chave123@localhost:4997/42';
      await reportarErro(new Error('quebrou o caixa'), { rota: '/api/vendas', metodo: 'POST' });
      expect(recebidos).toHaveLength(1);
      const [url, auth, corpo] = recebidos[0].split('|');
      expect(url).toBe('/api/42/envelope/');
      expect(auth).toContain('sentry_key=chave123');
      expect(corpo).toContain('quebrou o caixa');
      expect(corpo).toContain('/api/vendas');
    });
  });
});
