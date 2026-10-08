import { describe, expect, it } from 'vitest';
import { app, criarEmpresa, criarUsuario, entrar, request } from './helpers/index.js';

describe('sessões ativas', () => {
  it('lista os aparelhos, marca a atual e encerra os outros', async () => {
    const { loja } = await criarEmpresa({ plano: 'PRO' });
    const u = await criarUsuario(loja.id, 'ADMIN');
    const a = await entrar(u.email);
    const b = await entrar(u.email);

    const lista = await request(app).get('/api/auth/sessoes').set(a.auth).set('X-Refresh-Token', a.refreshToken);
    expect(lista.status).toBe(200);
    expect(lista.body).toHaveLength(2);
    expect(lista.body.filter((s: { atual: boolean }) => s.atual)).toHaveLength(1);

    const r = await request(app).delete('/api/auth/sessoes/outras').set(a.auth).set('X-Refresh-Token', a.refreshToken);
    expect(r.body).toEqual({ encerradas: 1 });

    // A sessão encerrada não renova mais; a atual continua.
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: b.refreshToken })).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: a.refreshToken })).status).toBe(200);
  });

  it('não encerra sessão de outra pessoa', async () => {
    const { loja } = await criarEmpresa({ plano: 'PRO' });
    const u1 = await criarUsuario(loja.id, 'ADMIN');
    const u2 = await criarUsuario(loja.id, 'ADMIN');
    const s1 = await entrar(u1.email);
    const s2 = await entrar(u2.email);
    const alvo = (await request(app).get('/api/auth/sessoes').set(s2.auth)).body[0];
    expect((await request(app).delete(`/api/auth/sessoes/${alvo.id}`).set(s1.auth)).status).toBe(404);
  });
});
