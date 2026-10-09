import { useEffect, useRef } from 'react';

/** Chave pública do Turnstile (Cloudflare). Sem ela o captcha não aparece e o cadastro segue sem ele (dev). */
export const CHAVE_CAPTCHA = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;

interface Turnstile {
  render: (el: HTMLElement, opcoes: Record<string, unknown>) => string;
  reset: (id?: string) => void;
  remove: (id?: string) => void;
}
declare global {
  interface Window {
    turnstile?: Turnstile;
  }
}

let carregando: Promise<void> | null = null;
function carregarScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  carregando ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      carregando = null;
      reject(new Error('Não foi possível carregar o captcha.'));
    };
    document.head.appendChild(s);
  });
  return carregando;
}

interface Props {
  /** Chamado com o token quando a pessoa passa na verificação, e com null quando ele vence ou falha. */
  aoMudar: (token: string | null) => void;
  /** Mude este número para pedir um desafio novo (o token vale uma vez só). */
  reiniciar?: number;
}

/** Widget do captcha. Não renderiza nada se VITE_TURNSTILE_SITE_KEY não estiver definida. */
export function Captcha({ aoMudar, reiniciar = 0 }: Props) {
  const caixa = useRef<HTMLDivElement>(null);
  const idWidget = useRef<string>();
  const aoMudarRef = useRef(aoMudar);
  aoMudarRef.current = aoMudar;

  useEffect(() => {
    if (!CHAVE_CAPTCHA || !caixa.current) return;
    let ativo = true;
    carregarScript()
      .then(() => {
        if (!ativo || !caixa.current || !window.turnstile) return;
        idWidget.current = window.turnstile.render(caixa.current, {
          sitekey: CHAVE_CAPTCHA,
          language: 'pt-br',
          callback: (t: string) => aoMudarRef.current(t),
          'expired-callback': () => aoMudarRef.current(null),
          'error-callback': () => aoMudarRef.current(null),
        });
      })
      .catch(() => aoMudarRef.current(null));
    return () => {
      ativo = false;
      if (idWidget.current) window.turnstile?.remove(idWidget.current);
    };
  }, []);

  useEffect(() => {
    if (reiniciar > 0 && idWidget.current) {
      aoMudarRef.current(null);
      window.turnstile?.reset(idWidget.current);
    }
  }, [reiniciar]);

  if (!CHAVE_CAPTCHA) return null;
  return <div ref={caixa} className="flex min-h-[65px] justify-center" />;
}
