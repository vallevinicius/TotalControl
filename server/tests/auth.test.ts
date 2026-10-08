import { describe, expect, it } from 'vitest';
import { app, criarEmpresa, criarUsuario, emailUnico, entrar, prisma, request, SENHA } from './helpers/index.js';
import { caixaDeSaidaDeTeste } from '../src/lib/email.js';

describe('login e sessão', () => {
  it('entra com a senha certa e devolve token de acesso e de renovação', async () => {
    const { dono } = await criarEmpresa();
    const r = await request(app).post('/api/auth/login').send({ email: dono.email, senha: SENHA });
    expect(r.status).toBe(200);
    expect(r.body.token).toBeTruthy();
    expect(r.body.refreshToken).toHaveLength(64);
  });

  it('recusa senha errada e e-mail inexistente com a mesma mensagem', async () => {
    const { dono } = await criarEmpresa();
    const a = await request(app).post('/api/auth/login').send({ email: dono.email, senha: 'errada123' });
    const b = await request(app).post('/api/auth/login').send({ email: emailUnico(), senha: 'errada123' });
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.erro).toBe(b.body.erro);
  });

  it('bloqueia depois de 8 tentativas erradas para o mesmo e-mail (429), sem afetar outro e-mail', async () => {
    const email = emailUnico();
    const status: number[] = [];
    for (let i = 0; i < 9; i++) status.push((await request(app).post('/api/auth/login').send({ email, senha: 'errada123' })).status);
    expect(status.slice(0, 8).every((s) => s === 401)).toBe(true);
    expect(status[8]).toBe(429);
    expect((await request(app).post('/api/auth/login').send({ email: emailUnico(), senha: 'errada123' })).status).toBe(401);
  });

  it('usuário desativado perde o acesso na hora, mesmo com token válido', async () => {
    const { loja } = await criarEmpresa();
    const op = await criarUsuario(loja.id, 'GERENTE');
    const { auth } = await entrar(op.email);
    expect((await request(app).get('/api/produtos').set(auth)).status).toBe(200);
    await prisma.usuario.update({ where: { id: op.id }, data: { ativo: false } });
    expect((await request(app).get('/api/produtos').set(auth)).status).toBe(401);
  });

  it('empresa suspensa perde o acesso na hora', async () => {
    const { empresa, dono } = await criarEmpresa();
    const { auth } = await entrar(dono.email);
    await prisma.empresa.update({ where: { id: empresa.id }, data: { ativo: false } });
    expect((await request(app).get('/api/produtos').set(auth)).status).toBe(403);
  });
});

describe('renovação de sessão', () => {
  it('troca o token de renovação por um par novo e o antigo deixa de valer', async () => {
    const { dono } = await criarEmpresa();
    const { refreshToken } = await entrar(dono.email);
    const r1 = await request(app).post('/api/auth/refresh').send({ refreshToken });
    expect(r1.status).toBe(200);
    expect(r1.body.refreshToken).not.toBe(refreshToken);
    expect((await request(app).get('/api/produtos').set({ Authorization: `Bearer ${r1.body.token}` })).status).toBe(200);
  });

  it('reusar um token de renovação já usado derruba todas as sessões da pessoa', async () => {
    const { dono } = await criarEmpresa();
    const { refreshToken } = await entrar(dono.email);
    const r1 = await request(app).post('/api/auth/refresh').send({ refreshToken });
    // O token antigo reaparece: sinal de roubo.
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken })).status).toBe(401);
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken: r1.body.refreshToken })).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${r1.body.token}` })).status).toBe(401);
  });

  it('logout invalida o token de renovação', async () => {
    const { dono } = await criarEmpresa();
    const { refreshToken } = await entrar(dono.email);
    await request(app).post('/api/auth/logout').send({ refreshToken });
    expect((await request(app).post('/api/auth/refresh').send({ refreshToken })).status).toBe(401);
  });
});

describe('recuperação de senha por e-mail', () => {
  // O e-mail sai depois da resposta (de propósito), então um e-mail de um teste
  // anterior pode chegar tarde: sempre filtra pelo destinatário.
  const emailsPara = (email: string) => caixaDeSaidaDeTeste.filter((e) => e.para === email);
  const tokenDoUltimoEmail = (email: string) => emailsPara(email).at(-1)!.texto.match(/token=([\w-]+)/)![1];

  it('responde igual exista ou não a conta (não revela quem está cadastrado)', async () => {
    const { dono } = await criarEmpresa();
    const existe = await request(app).post('/api/auth/esqueci-senha').send({ email: dono.email });
    const naoExiste = await request(app).post('/api/auth/esqueci-senha').send({ email: emailUnico() });
    expect(existe.status).toBe(200);
    expect(naoExiste.status).toBe(200);
    expect(existe.body).toEqual(naoExiste.body);
  });

  it('envia o link, a nova senha funciona, o link só vale uma vez e as sessões antigas caem', async () => {
    const { dono } = await criarEmpresa();
    const antiga = await entrar(dono.email);

    await request(app).post('/api/auth/esqueci-senha').send({ email: dono.email });
    await vi_esperar(() => emailsPara(dono.email).length === 1);
    const token = tokenDoUltimoEmail(dono.email);

    const novaSenha = 'NovaSenha@456';
    const r = await request(app).post('/api/auth/redefinir-senha').send({ token, senha: novaSenha });
    expect(r.status).toBe(200);

    expect((await request(app).post('/api/auth/login').send({ email: dono.email, senha: SENHA })).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: dono.email, senha: novaSenha })).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(antiga.auth)).status).toBe(401);
    // Segundo uso do mesmo link
    expect((await request(app).post('/api/auth/redefinir-senha').send({ token, senha: 'Outra@789x' })).status).toBe(400);
  });

  it('um novo pedido invalida o link anterior', async () => {
    const { dono } = await criarEmpresa();
    await request(app).post('/api/auth/esqueci-senha').send({ email: dono.email });
    await vi_esperar(() => emailsPara(dono.email).length === 1);
    const primeiro = tokenDoUltimoEmail(dono.email);
    await request(app).post('/api/auth/esqueci-senha').send({ email: dono.email });
    await vi_esperar(() => emailsPara(dono.email).length === 2);
    expect((await request(app).post('/api/auth/redefinir-senha').send({ token: primeiro, senha: 'Nova@12345' })).status).toBe(400);
    expect((await request(app).post('/api/auth/redefinir-senha').send({ token: tokenDoUltimoEmail(dono.email), senha: 'Nova@12345' })).status).toBe(200);
  });

  it('recusa senha fraca na redefinição', async () => {
    const { dono } = await criarEmpresa();
    await request(app).post('/api/auth/esqueci-senha').send({ email: dono.email });
    await vi_esperar(() => emailsPara(dono.email).length === 1);
    const r = await request(app).post('/api/auth/redefinir-senha').send({ token: tokenDoUltimoEmail(dono.email), senha: 'fraca' });
    expect(r.status).toBe(400);
  });

  it('link vencido não funciona', async () => {
    const { dono } = await criarEmpresa();
    await request(app).post('/api/auth/esqueci-senha').send({ email: dono.email });
    await vi_esperar(() => emailsPara(dono.email).length === 1);
    await prisma.tokenSenha.updateMany({ where: { usuarioId: dono.id }, data: { expiraEm: new Date(Date.now() - 1000) } });
    expect((await request(app).post('/api/auth/redefinir-senha').send({ token: tokenDoUltimoEmail(dono.email), senha: 'Nova@12345' })).status).toBe(400);
  });
});

describe('trocar a própria senha', () => {
  it('exige a senha atual, derruba as outras sessões e mantém esta logada', async () => {
    const { dono } = await criarEmpresa();
    const a = await entrar(dono.email);
    const outraSessao = await entrar(dono.email);

    expect((await request(app).post('/api/auth/alterar-senha').set(a.auth).send({ senhaAtual: 'errada', novaSenha: 'Nova@12345' })).status).toBe(400);
    expect((await request(app).post('/api/auth/alterar-senha').set(a.auth).send({ senhaAtual: SENHA, novaSenha: SENHA })).status).toBe(400);

    const r = await request(app).post('/api/auth/alterar-senha').set(a.auth).send({ senhaAtual: SENHA, novaSenha: 'Nova@12345' });
    expect(r.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set({ Authorization: `Bearer ${r.body.token}` })).status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(outraSessao.auth)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: dono.email, senha: 'Nova@12345' })).status).toBe(200);
  });

  it('atualiza nome e telefone do perfil', async () => {
    const { dono } = await criarEmpresa();
    const { auth } = await entrar(dono.email);
    expect((await request(app).put('/api/auth/perfil').set(auth).send({ nome: 'Maria Silva', telefone: '(22) 99999-0000' })).status).toBe(200);
    const me = await request(app).get('/api/auth/me').set(auth);
    expect(me.body.usuario.nome).toBe('Maria Silva');
  });
});

describe('cadastro', () => {
  const corpo = (extra: object = {}) => ({
    nomeFantasia: 'Loja Cadastro',
    razaoSocial: 'Loja Cadastro LTDA',
    cnpj: '11.222.333/0001-81',
    nomeAdmin: 'Fulano',
    email: emailUnico(),
    senha: 'Teste@123',
    aceitouTermos: true,
    ...extra,
  });

  it('exige o aceite dos termos, CNPJ válido e senha forte', async () => {
    expect((await request(app).post('/api/auth/register').send(corpo({ aceitouTermos: false }))).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send(corpo({ cnpj: '11.111.111/1111-11' }))).status).toBe(400);
    expect((await request(app).post('/api/auth/register').send(corpo({ senha: 'fraca' }))).status).toBe(400);
  });

  it('cria a conta, grava o aceite e impede CNPJ repetido', async () => {
    const dados = corpo({ cnpj: '22.333.444/0001-81' });
    const r = await request(app).post('/api/auth/register').send(dados);
    expect(r.status).toBe(201);
    expect(r.body.refreshToken).toBeTruthy();
    const u = await prisma.usuario.findUniqueOrThrow({ where: { email: dados.email } });
    expect(u.aceiteTermosEm).not.toBeNull();
    expect(u.aceiteTermosVersao).toBeTruthy();
    expect((await request(app).post('/api/auth/register').send({ ...dados, email: emailUnico() })).status).toBe(409);
  });
});

/** Espera uma condição (o e-mail é enviado depois da resposta, de propósito). */
async function vi_esperar(condicao: () => boolean, ms = 3000) {
  const limite = Date.now() + ms;
  while (!condicao() && Date.now() < limite) await new Promise((r) => setTimeout(r, 25));
  if (!condicao()) throw new Error('condição não ocorreu a tempo');
}

describe('convite de funcionário por e-mail', () => {
  it('cria o login sem senha, envia o link, e a pessoa define a própria senha', async () => {
    const { dono } = await criarEmpresa();
    const { auth } = await entrar(dono.email);
    const email = emailUnico();

    const r = await request(app).post('/api/usuarios').set(auth).send({ nome: 'Convidada', email, convidarPorEmail: true, papel: 'GERENTE', permissoes: ['pdv'] });
    expect(r.status).toBe(201);
    expect(r.body.conviteEnviado).toBe(true);
    await vi_esperar(() => caixaDeSaidaDeTeste.some((m) => m.para === email));
    const mail = caixaDeSaidaDeTeste.find((m) => m.para === email)!;
    expect(mail.assunto).toMatch(/convidou você/);
    const token = mail.texto.match(/token=([\w-]+)/)![1];

    // Sem o link, ninguém entra (a senha inicial é aleatória).
    expect((await request(app).post('/api/auth/login').send({ email, senha: 'Qualquer@123' })).status).toBe(401);
    expect((await request(app).post('/api/auth/redefinir-senha').send({ token, senha: 'MinhaSenha@1' })).status).toBe(200);
    expect((await request(app).post('/api/auth/login').send({ email, senha: 'MinhaSenha@1' })).status).toBe(200);
  });

  it('sem convite, a senha continua obrigatória', async () => {
    const { dono } = await criarEmpresa();
    const { auth } = await entrar(dono.email);
    const r = await request(app).post('/api/usuarios').set(auth).send({ nome: 'Sem senha', email: emailUnico(), papel: 'OPERADOR_CAIXA' });
    expect(r.status).toBe(400);
  });
});

describe('administrador redefine a senha de um funcionário', () => {
  it('gera uma senha temporária que funciona e derruba as sessões dele', async () => {
    const { dono, loja } = await criarEmpresa();
    const op = await criarUsuario(loja.id, 'OPERADOR_CAIXA');
    const sessaoOp = await entrar(op.email);
    const { auth } = await entrar(dono.email);

    const r = await request(app).post(`/api/usuarios/${op.id}/resetar-senha`).set(auth);
    expect(r.status).toBe(200);
    expect((await request(app).get('/api/auth/me').set(sessaoOp.auth)).status).toBe(401);
    expect((await request(app).post('/api/auth/login').send({ email: op.email, senha: r.body.senhaTemporaria })).status).toBe(200);
  });

  it('não redefine a conta principal, a própria senha, nem a de outro admin sendo só admin', async () => {
    const { dono, loja } = await criarEmpresa();
    const admin2 = await criarUsuario(loja.id, 'ADMIN');
    const admin3 = await criarUsuario(loja.id, 'ADMIN');
    const donoSessao = await entrar(dono.email);
    const admin2Sessao = await entrar(admin2.email);

    expect((await request(app).post(`/api/usuarios/${dono.id}/resetar-senha`).set(admin2Sessao.auth)).status).toBe(403); // conta principal
    expect((await request(app).post(`/api/usuarios/${admin3.id}/resetar-senha`).set(admin2Sessao.auth)).status).toBe(403); // admin por admin
    expect((await request(app).post(`/api/usuarios/${admin2.id}/resetar-senha`).set(admin2Sessao.auth)).status).toBe(400); // a própria
    expect((await request(app).post(`/api/usuarios/${admin3.id}/resetar-senha`).set(donoSessao.auth)).status).toBe(200); // a principal pode
  });

  it('funcionário comum não redefine ninguém', async () => {
    const { loja } = await criarEmpresa();
    const a = await criarUsuario(loja.id, 'GERENTE');
    const b = await criarUsuario(loja.id, 'OPERADOR_CAIXA');
    expect((await request(app).post(`/api/usuarios/${b.id}/resetar-senha`).set((await entrar(a.email)).auth)).status).toBe(403);
  });
});
