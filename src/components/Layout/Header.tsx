import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTenant } from '@/contexts/TenantContext';
import { ThemeToggle } from '@/components/Common/ThemeToggle';
import { NotificationBell } from './NotificationBell';
import { ConfiguracoesModal } from './ConfiguracoesModal';

interface HeaderProps {
  titulo: string;
  subtitulo?: string;
  aoAbrirMenu?: () => void;
}

export function Header({ titulo, subtitulo, aoAbrirMenu }: HeaderProps) {
  const { usuarioAtual, logout } = useTenant();
  const [mostrarConfiguracoes, setMostrarConfiguracoes] = useState(false);

  return (
    <header className="flex items-center justify-between border-b border-ink-700 bg-ink-800/60 px-4 py-5 md:px-8">
      <div className="flex items-center gap-3">
        <button
          onClick={aoAbrirMenu}
          aria-label="Abrir menu"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-600 text-ink-300 hover:border-ink-500 hover:text-ink-100 md:hidden"
        >
          <span aria-hidden className="text-base leading-none">
            ☰
          </span>
        </button>
        <div>
          <h1 className="font-display text-lg font-semibold text-ink-100 md:text-xl">{titulo}</h1>
          {subtitulo && <p className="mt-0.5 hidden text-sm text-ink-400 sm:block">{subtitulo}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2 md:gap-3">
        <ThemeToggle />
        <NotificationBell />

        {usuarioAtual?.raiz && (
          <button
            onClick={() => setMostrarConfiguracoes(true)}
            className="flex items-center gap-1.5 rounded-lg border border-ink-600 px-3 py-2 text-xs font-medium text-ink-300 hover:border-ink-500 hover:text-ink-100"
          >
            <span aria-hidden className="text-sm leading-none">
              ⚙
            </span>
            <span className="hidden sm:inline">Configurações</span>
          </button>
        )}

        <Link to="/conta" title="Minha conta" className="hidden items-center gap-2.5 rounded-full bg-ink-700 py-1.5 pl-1.5 pr-3.5 transition-colors hover:bg-ink-600 sm:flex">
          <div className="flex h-7 w-7 items-center justify-center rounded-full bg-tenant text-xs font-semibold text-tenant-foreground">
            {usuarioAtual?.nome.charAt(0) ?? '?'}
          </div>
          <div className="text-xs">
            <p className="font-medium text-ink-100">{usuarioAtual?.nome ?? 'Convidado'}</p>
            <p className="text-ink-400">{usuarioAtual?.papel}</p>
          </div>
        </Link>

        <button
          onClick={logout}
          className="rounded-lg border border-ink-600 px-3 py-2 text-xs font-medium text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100"
        >
          Sair
        </button>
      </div>

      {mostrarConfiguracoes && <ConfiguracoesModal aoFechar={() => setMostrarConfiguracoes(false)} />}
    </header>
  );
}
