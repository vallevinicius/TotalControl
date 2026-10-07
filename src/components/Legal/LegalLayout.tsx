import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { LogoMark } from '@/components/Common/LogoMark';
import { dadosLegaisPendentes } from '@/config/empresa';

interface LegalLayoutProps {
  titulo: string;
  atualizadoEm: string;
  children: ReactNode;
}

/** Layout raso pras páginas institucionais (Termos, Privacidade) — sem
 * sidebar/app, só o cabeçalho da marca e o texto corrido. */
export function LegalLayout({ titulo, atualizadoEm, children }: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-ink-900">
      <header className="border-b border-ink-800">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <LogoMark className="h-8 w-8 rounded-lg" />
            <span className="font-display text-sm font-semibold tracking-tight text-ink-100">Total Control</span>
          </Link>
          <Link to="/" className="text-sm font-medium text-ink-300 hover:text-ink-100">
            Voltar para o início
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-12">
        {import.meta.env.DEV && dadosLegaisPendentes && (
          <p className="mb-6 rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-300">
            Aviso de desenvolvimento: faltam dados da empresa neste texto (campos entre colchetes). Preencha src/config/empresa.ts antes de publicar.
          </p>
        )}
        <h1 className="font-display text-3xl font-bold tracking-tight text-ink-100">{titulo}</h1>
        <p className="mt-2 text-sm text-ink-500">Última atualização: {atualizadoEm}</p>
        <div className="mt-8 space-y-6 text-sm leading-relaxed text-ink-300 [&_h2]:mt-8 [&_h2]:font-display [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:text-ink-100 [&_p]:mt-3 [&_ul]:mt-3 [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5">
          {children}
        </div>
      </main>
    </div>
  );
}
