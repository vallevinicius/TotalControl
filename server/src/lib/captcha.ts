/**
 * Captcha do cadastro (Cloudflare Turnstile: gratuito, sem quebra-cabeça na maioria dos casos).
 * Com TURNSTILE_SECRET_KEY definida o cadastro exige o token do widget; sem ela o captcha fica
 * desligado (desenvolvimento). O token só vale uma vez e é conferido na Cloudflare.
 */
const URL_PADRAO = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export const captchaAtivo = (): boolean => Boolean(process.env.TURNSTILE_SECRET_KEY);

export type ResultadoCaptcha = 'ok' | 'invalido' | 'indisponivel';

export async function validarCaptcha(token: string | undefined, ip?: string): Promise<ResultadoCaptcha> {
  if (!captchaAtivo()) return 'ok';
  if (!token) return 'invalido';
  try {
    const corpo = new URLSearchParams({ secret: process.env.TURNSTILE_SECRET_KEY!, response: token });
    if (ip) corpo.set('remoteip', ip);
    const r = await fetch(process.env.TURNSTILE_VERIFY_URL ?? URL_PADRAO, { method: 'POST', body: corpo, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return 'indisponivel';
    const json = (await r.json()) as { success?: boolean };
    return json.success ? 'ok' : 'invalido';
  } catch {
    // Não deu para falar com a Cloudflare: não deixa passar sem conferir (e não culpa a pessoa).
    return 'indisponivel';
  }
}
