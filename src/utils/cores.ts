/** Converte "#RRGGBB" pro formato "R G B" (espaços, sem vírgula/função) que
 * as variáveis CSS de cor deste projeto usam (ver src/index.css) — é o
 * formato que permite ao Tailwind aplicar opacidade (bg-tenant/60). */
export function hexParaRgb(hex: string): string | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const inteiro = parseInt(match[1], 16);
  const r = (inteiro >> 16) & 255;
  const g = (inteiro >> 8) & 255;
  const b = inteiro & 255;
  return `${r} ${g} ${b}`;
}

/** Clareia um hex em `quantidade` (0-1) na direção do branco — usado pra
 * derivar automaticamente a cor de hover a partir da cor principal, sem
 * precisar pedir uma segunda cor pro usuário escolher. */
export function clarearHex(hex: string, quantidade = 0.2): string {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return hex;
  const inteiro = parseInt(match[1], 16);
  const canal = (deslocamento: number) => {
    const valor = (inteiro >> deslocamento) & 255;
    return Math.round(valor + (255 - valor) * quantidade);
  };
  const paraHex = (v: number) => v.toString(16).padStart(2, '0');
  return `#${paraHex(canal(16))}${paraHex(canal(8))}${paraHex(canal(0))}`;
}

function luminancia(r: number, g: number, b: number): number {
  const linear = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

/** Cor do texto (no formato "r g b" das variáveis CSS) que fica mais legível sobre o fundo
 * `rgb` ("r g b"): quase preto ou branco, o que tiver maior contraste (WCAG). O verde padrão
 * da marca pede texto escuro; cores de loja escuras (azul-marinho etc.) pedem branco. */
export function corDoTextoSobre(rgb: string): string {
  const [r, g, b] = rgb.split(' ').map(Number);
  const fundo = luminancia(r, g, b);
  const contrasteComBranco = 1.05 / (fundo + 0.05);
  const contrasteComEscuro = (fundo + 0.05) / (luminancia(5, 5, 5) + 0.05);
  return contrasteComEscuro >= contrasteComBranco ? '5 5 5' : '255 255 255';
}
