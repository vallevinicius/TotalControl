/** Imprime só uma parte da tela (o CSS de impressão em index.css esconde o resto).
 * `comprovante` usa a classe `.comprovante-impressao`; `relatorio`, a `.area-relatorio`. */
export function imprimir(modo: 'comprovante' | 'relatorio'): void {
  const classe = `imprimindo-${modo}`;
  const limpar = () => {
    document.body.classList.remove(classe);
    window.removeEventListener('afterprint', limpar);
  };
  document.body.classList.add(classe);
  window.addEventListener('afterprint', limpar);
  window.print();
  // Alguns navegadores não disparam "afterprint": garante que a classe não fique presa.
  window.setTimeout(limpar, 1000);
}
