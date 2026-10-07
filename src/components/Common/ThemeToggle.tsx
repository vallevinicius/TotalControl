import { useTheme } from '@/contexts/ThemeContext';

export function ThemeToggle() {
  const { tema, alternarTema } = useTheme();
  const ehEscuro = tema === 'dark';

  return (
    <button
      onClick={(e) => {
        // A troca de cor nasce no centro do botão (também funciona por teclado).
        const caixa = e.currentTarget.getBoundingClientRect();
        alternarTema({ x: caixa.left + caixa.width / 2, y: caixa.top + caixa.height / 2 });
      }}
      aria-label={ehEscuro ? 'Ativar modo claro' : 'Ativar modo escuro'}
      title={ehEscuro ? 'Modo claro' : 'Modo escuro'}
      className="flex h-9 w-9 items-center justify-center rounded-lg border border-ink-600 text-ink-300 transition-colors hover:border-ink-500 hover:text-ink-100"
    >
      {/* key = tema: o ícone é recriado e gira ao entrar a cada troca. */}
      <span key={tema} aria-hidden className="text-base leading-none" style={{ animation: 'tema-icone 0.45s cubic-bezier(0.22, 1, 0.36, 1)' }}>
        {ehEscuro ? '☀' : '☾'}
      </span>
    </button>
  );
}
