import nodemailer, { type Transporter } from 'nodemailer';

/**
 * Envio de e-mail por SMTP (funciona com qualquer provedor: Resend, Amazon SES,
 * Mailgun, SendGrid, Gmail...). Configure em server/.env:
 *   SMTP_HOST, SMTP_PORT (587 ou 465), SMTP_USER, SMTP_PASS, EMAIL_FROM
 * Sem SMTP_HOST, o e-mail NÃO é enviado: o conteúdo vai pro log do servidor, o que
 * basta em desenvolvimento (o link de redefinição aparece no terminal).
 */

export interface EmailParaEnviar {
  para: string;
  assunto: string;
  texto: string;
  html: string;
}

/** Em testes automatizados, os e-mails "enviados" ficam aqui pra serem conferidos. */
export const caixaDeSaidaDeTeste: EmailParaEnviar[] = [];

let transporte: Transporter | null = null;

function obterTransporte(): Transporter | null {
  if (!process.env.SMTP_HOST) return null;
  transporte ??= nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: Number(process.env.SMTP_PORT ?? 587) === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transporte;
}

export async function enviarEmail(email: EmailParaEnviar): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    caixaDeSaidaDeTeste.push(email);
    return;
  }
  const t = obterTransporte();
  if (!t) {
    console.log(`[e-mail não enviado: SMTP não configurado]\nPara: ${email.para}\nAssunto: ${email.assunto}\n${email.texto}\n`);
    return;
  }
  await t.sendMail({
    from: process.env.EMAIL_FROM ?? 'Total Control <nao-responda@totalcontrol.local>',
    to: email.para,
    subject: email.assunto,
    text: email.texto,
    html: email.html,
  });
}

const escapar = (t: string) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

function modelo(titulo: string, paragrafos: string[], botao?: { texto: string; url: string }): string {
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#111">
<h2 style="margin:0 0 16px">${escapar(titulo)}</h2>
${paragrafos.map((p) => `<p style="line-height:1.5">${escapar(p)}</p>`).join('\n')}
${botao ? `<p style="margin:24px 0"><a href="${botao.url}" style="background:#10B981;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:bold">${escapar(botao.texto)}</a></p>
<p style="font-size:12px;color:#666">Se o botão não funcionar, copie este endereço no navegador:<br>${escapar(botao.url)}</p>` : ''}
<p style="font-size:12px;color:#888;margin-top:32px">Total Control, um produto Total Software.</p>
</div>`;
}

export function emailRecuperacaoDeSenha(nome: string, link: string): Omit<EmailParaEnviar, 'para'> {
  return {
    assunto: 'Redefinir sua senha do Total Control',
    texto: `Olá, ${nome}.\n\nRecebemos um pedido para redefinir a senha da sua conta. Use o link abaixo (vale por 1 hora):\n\n${link}\n\nSe não foi você, ignore este e-mail: sua senha continua a mesma.`,
    html: modelo(
      'Redefinir sua senha',
      [`Olá, ${nome}.`, 'Recebemos um pedido para redefinir a senha da sua conta. O link vale por 1 hora.', 'Se não foi você, ignore este e-mail: sua senha continua a mesma.'],
      { texto: 'Criar nova senha', url: link },
    ),
  };
}

export function emailSenhaAlterada(nome: string): Omit<EmailParaEnviar, 'para'> {
  return {
    assunto: 'Sua senha do Total Control foi alterada',
    texto: `Olá, ${nome}.\n\nA senha da sua conta foi alterada agora. Se não foi você, redefina a senha imediatamente pela tela de login ("Esqueci minha senha") e avise o responsável pela sua loja.`,
    html: modelo('Senha alterada', [`Olá, ${nome}.`, 'A senha da sua conta foi alterada agora.', 'Se não foi você, redefina a senha imediatamente pela tela de login ("Esqueci minha senha") e avise o responsável pela sua loja.']),
  };
}

export function emailContaExcluida(nome: string, empresa: string): Omit<EmailParaEnviar, 'para'> {
  return {
    assunto: 'Sua conta do Total Control foi excluída',
    texto: `Olá, ${nome}.\n\nConfirmamos a exclusão da conta "${empresa}" e de todos os dados dela (lojas, produtos, vendas, clientes, financeiro e usuários), a pedido do responsável. A assinatura foi cancelada e não haverá novas cobranças.\n\nSe você não fez esse pedido, responda a este e-mail imediatamente.`,
    html: modelo('Conta excluída', [`Olá, ${nome}.`, `Confirmamos a exclusão da conta "${empresa}" e de todos os dados dela (lojas, produtos, vendas, clientes, financeiro e usuários), a pedido do responsável.`, 'A assinatura foi cancelada e não haverá novas cobranças.', 'Se você não fez esse pedido, responda a este e-mail imediatamente.']),
  };
}

export function emailConvite(nome: string, convidadoPor: string, loja: string, link: string): Omit<EmailParaEnviar, 'para'> {
  return {
    assunto: `${convidadoPor} convidou você para o Total Control`,
    texto: `Olá, ${nome}.\n\n${convidadoPor} criou um acesso para você no Total Control, na loja ${loja}. Para entrar, crie a sua senha pelo link abaixo (vale por 3 dias):\n\n${link}\n\nDepois é só entrar com este e-mail e a senha que você escolher.`,
    html: modelo('Você foi convidado', [`Olá, ${nome}.`, `${convidadoPor} criou um acesso para você no Total Control, na loja ${loja}.`, 'Crie a sua senha pelo botão abaixo (o link vale por 3 dias). Depois é só entrar com este e-mail e a senha que você escolher.'], { texto: 'Criar minha senha', url: link }),
  };
}

/** E-mail de aviso simples (um título, parágrafos, uma lista opcional e um botão). */
export function emailAviso(assunto: string, titulo: string, paragrafos: string[], opcoes: { lista?: string[]; botao?: { texto: string; url: string } } = {}): Omit<EmailParaEnviar, 'para'> {
  const lista = opcoes.lista ?? [];
  return {
    assunto,
    texto: `${titulo}\n\n${paragrafos.join('\n\n')}${lista.length ? `\n\n${lista.map((l) => `- ${l}`).join('\n')}` : ''}${opcoes.botao ? `\n\n${opcoes.botao.texto}: ${opcoes.botao.url}` : ''}\n\nPara parar de receber estes avisos, desligue-os em Empresa > Avisos por e-mail.`,
    html: modelo(titulo, paragrafos, opcoes.botao).replace(
      '<p style="font-size:12px;color:#888;margin-top:32px">',
      `${lista.length ? `<ul style="line-height:1.6">${lista.map((l) => `<li>${escapar(l)}</li>`).join('')}</ul>` : ''}<p style="font-size:12px;color:#888;margin-top:32px">Para parar de receber estes avisos, desligue-os em Empresa &gt; Avisos por e-mail.<br>`,
    ),
  };
}
