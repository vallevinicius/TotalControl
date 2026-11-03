import { useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { ThemeToggle } from '@/components/Common/ThemeToggle';
import { LogoMark } from '@/components/Common/LogoMark';

const LINKS_ANCORA = [
  { href: '#recursos', rotulo: 'Recursos' },
  { href: '#como-funciona', rotulo: 'Como funciona' },
  { href: '#planos', rotulo: 'Planos' },
  { href: '#faq', rotulo: 'Dúvidas' },
];

// Rola até a seção sem gravar o #hash na barra de endereço.
function irParaSecao(evento: MouseEvent<HTMLAnchorElement>, href: string, aoRolar?: () => void) {
  const secao = document.getElementById(href.slice(1));
  if (!secao) return;
  evento.preventDefault();
  // Suavidade e prefers-reduced-motion vêm do CSS (html { scroll-behavior }).
  secao.scrollIntoView();
  aoRolar?.();
}

export function LandingHeader() {
  const [menuAberto, setMenuAberto] = useState(false);

  return (
    <header className="sticky top-0 z-20 border-b border-ink-700 bg-ink-900/80 shadow-sm shadow-black/[0.03] backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
        <div className="flex items-center gap-2.5">
          <LogoMark className="h-9 w-9 rounded-lg" />
          <span className="font-display text-base font-semibold tracking-tight text-ink-100">
            Total Control
          </span>
        </div>

        <nav className="hidden items-center gap-6 text-sm font-medium text-ink-300 md:flex">
          {LINKS_ANCORA.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(evento) => irParaSecao(evento, link.href)}
              className="transition-colors hover:text-ink-100"
            >
              {link.rotulo}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Link
            to="/login"
            className="hidden text-sm font-medium text-ink-200 hover:text-ink-100 md:inline-block"
          >
            Entrar
          </Link>
          <Link
            to="/registrar"
            className="hidden rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 md:inline-block"
          >
            Criar conta
          </Link>
          <button
            onClick={() => setMenuAberto((atual) => !atual)}
            aria-label={menuAberto ? 'Fechar menu' : 'Abrir menu'}
            aria-expanded={menuAberto}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-600 text-ink-300 hover:border-ink-500 hover:text-ink-100 md:hidden"
          >
            <span aria-hidden className="text-base leading-none">
              {menuAberto ? '✕' : '☰'}
            </span>
          </button>
        </div>
      </div>

      {menuAberto && (
        <nav className="flex flex-col gap-1 border-t border-ink-700 bg-ink-900 px-5 py-4 md:hidden">
          {LINKS_ANCORA.map((link) => (
            <a
              key={link.href}
              href={link.href}
              onClick={(evento) => irParaSecao(evento, link.href, () => setMenuAberto(false))}
              className="rounded-lg px-3 py-2.5 text-sm font-medium text-ink-300 hover:bg-ink-800 hover:text-ink-100"
            >
              {link.rotulo}
            </a>
          ))}
          <div className="mt-2 flex items-center gap-3 border-t border-ink-800 px-3 pt-3">
            <Link
              to="/login"
              onClick={() => setMenuAberto(false)}
              className="flex-1 rounded-lg border border-ink-600 py-2.5 text-center text-sm font-medium text-ink-200 hover:border-ink-500 hover:text-ink-100"
            >
              Entrar
            </Link>
            <Link
              to="/registrar"
              onClick={() => setMenuAberto(false)}
              className="flex-1 rounded-lg bg-tenant py-2.5 text-center text-sm font-semibold text-tenant-foreground hover:opacity-90"
            >
              Criar conta
            </Link>
          </div>
        </nav>
      )}
    </header>
  );
}
