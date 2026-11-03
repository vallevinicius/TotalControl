import { describe, expect, it } from 'vitest';
import { corDoTextoSobre, hexParaRgb } from '../../src/utils/cores';

describe('corDoTextoSobre', () => {
  it('usa texto escuro sobre o verde da marca (branco ali tem contraste baixo)', () => {
    expect(corDoTextoSobre('16 185 129')).toBe('5 5 5');
  });

  it('usa texto claro sobre cores escuras', () => {
    expect(corDoTextoSobre(hexParaRgb('#1E3A8A')!)).toBe('255 255 255'); // azul-marinho
    expect(corDoTextoSobre('0 0 0')).toBe('255 255 255');
  });

  it('usa texto escuro sobre cores claras', () => {
    expect(corDoTextoSobre(hexParaRgb('#FDE68A')!)).toBe('5 5 5'); // amarelo claro
    expect(corDoTextoSobre('255 255 255')).toBe('5 5 5');
  });
});
