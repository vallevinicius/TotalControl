import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { AvisoAssinatura } from './AvisoAssinatura';
import { useTenant } from '@/contexts/TenantContext';
import { hexParaRgb, clarearHex } from '@/utils/cores';

interface AppLayoutProps {
  titulo: string;
  subtitulo?: string;
  children: ReactNode;
}

export function AppLayout({ titulo, subtitulo, children }: AppLayoutProps) {
  const { tenant } = useTenant();
  const [menuAberto, setMenuAberto] = useState(false);

  // Personalização de cor da loja (Sidebar > Aparência): sobrescreve só
  // dentro do app logado — a marca do produto (landing page, admin) continua
  // fixa, isso é só a identidade visual de quem já está logado na loja.
  const estiloPersonalizado = useMemo<CSSProperties | undefined>(() => {
    const cor = tenant?.configuracoes.corPrincipalDoTema;
    if (!cor) return undefined;
    const rgb = hexParaRgb(cor);
    if (!rgb) return undefined;
    const rgbHover = hexParaRgb(tenant?.configuracoes.corPrincipalHover ?? clarearHex(cor));
    return {
      '--tenant-primary': rgb,
      '--tenant-primary-hover': rgbHover ?? rgb,
      '--tenant-primary-soft': rgb,
    } as CSSProperties;
  }, [tenant?.configuracoes.corPrincipalDoTema, tenant?.configuracoes.corPrincipalHover]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-ink-900" style={estiloPersonalizado}>
      <Sidebar aberta={menuAberto} aoFechar={() => setMenuAberto(false)} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <Header titulo={titulo} subtitulo={subtitulo} aoAbrirMenu={() => setMenuAberto(true)} />
        <main className="flex-1 overflow-y-auto px-4 py-6 md:px-8">
          <AvisoAssinatura />
          {children}
        </main>
      </div>
    </div>
  );
}
