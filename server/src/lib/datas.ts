/** Data "AAAA-MM-DD" de um instante, no fuso horário da loja (e não em UTC: uma venda
 * às 22h em São Paulo já é "amanhã" em UTC, e cairia no dia errado do gráfico). */
export function diaNoFuso(instante: Date, fuso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuso, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instante);
}

/** Os últimos `n` dias (do mais antigo ao de hoje) como "AAAA-MM-DD", no fuso da loja. */
export function ultimosDias(n: number, fuso: string, agora = new Date()): string[] {
  return Array.from({ length: n }, (_, i) => diaNoFuso(new Date(agora.getTime() - (n - 1 - i) * 86_400_000), fuso));
}

/** Dias de um período "AAAA-MM-DD" a "AAAA-MM-DD" (inclusive), limitado a `maximo` pra não gerar uma série gigante. */
export function diasDoPeriodo(inicio: string, fim: string, maximo = 92): string[] {
  const dias: string[] = [];
  for (let d = new Date(`${inicio}T00:00:00Z`); d <= new Date(`${fim}T00:00:00Z`) && dias.length < maximo; d = new Date(d.getTime() + 86_400_000)) {
    dias.push(d.toISOString().slice(0, 10));
  }
  return dias;
}
