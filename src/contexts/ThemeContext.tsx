import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { flushSync } from 'react-dom';

/**
 * ThemeContext
 * ----------------------------------------------------------------------------
 * Modo claro/escuro do app. Não depende de nenhum dado de tenant: é só uma
 * preferência local do navegador, salva em localStorage. O tema vale pelo
 * atributo `data-theme` em <html>; toda a paleta (ink-*, tenant-*) é CSS var
 * definida em src/index.css, então nenhum componente precisa saber o tema
 * atual pra se adaptar.
 *
 * O padrão é o CLARO. O atributo também é aplicado por um script no <head> do
 * index.html, antes do React carregar, pra a página não "piscar" no tema errado.
 *
 * Ao trocar, a nova cor se espalha em círculo a partir do botão clicado (View
 * Transitions); sem esse recurso, ou com "reduzir movimento" ligado, a troca é
 * um fade suave (ou imediata, se a pessoa pediu menos movimento).
 * ----------------------------------------------------------------------------
 */

type Tema = 'dark' | 'light';

interface OrigemDaTroca {
  x: number;
  y: number;
}

interface ThemeContextValue {
  tema: Tema;
  alternarTema: (origem?: OrigemDaTroca) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

// "_v2": quem tinha o escuro salvo de antes volta ao claro (novo padrão) uma vez.
const CHAVE_TEMA = 'total_control_tema_v2';

function lerTemaSalvo(): Tema {
  try {
    return localStorage.getItem(CHAVE_TEMA) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
}

type DocumentoComTransicao = Document & {
  startViewTransition?: (callback: () => void) => { ready: Promise<void> };
};

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [tema, setTema] = useState<Tema>(lerTemaSalvo);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', tema);
    try {
      localStorage.setItem(CHAVE_TEMA, tema);
    } catch {
      // Armazenamento indisponível (modo privado): o tema só não fica lembrado.
    }
  }, [tema]);

  function alternarTema(origem?: OrigemDaTroca) {
    const proximo: Tema = tema === 'dark' ? 'light' : 'dark';
    const aplicar = () => {
      document.documentElement.setAttribute('data-theme', proximo);
      flushSync(() => setTema(proximo));
    };

    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return aplicar();

    const doc = document as DocumentoComTransicao;
    if (doc.startViewTransition && origem) {
      const { x, y } = origem;
      const raio = Math.hypot(Math.max(x, window.innerWidth - x), Math.max(y, window.innerHeight - y));
      doc
        .startViewTransition(aplicar)
        .ready.then(() => {
          document.documentElement.animate(
            { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${raio}px at ${x}px ${y}px)`] },
            { duration: 650, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', pseudoElement: '::view-transition-new(root)' },
          );
        })
        // Transição interrompida (ex: outra troca no meio): o tema já foi aplicado.
        .catch(() => undefined);
      return;
    }

    // Fallback: liga as transições de cor por um instante e troca.
    const raiz = document.documentElement;
    raiz.classList.add('tema-transicao');
    aplicar();
    window.setTimeout(() => raiz.classList.remove('tema-transicao'), 500);
  }

  return <ThemeContext.Provider value={{ tema, alternarTema }}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme precisa ser usado dentro de um <ThemeProvider>.');
  }
  return context;
}
