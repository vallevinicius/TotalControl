interface PontoDoGrafico {
  rotulo: string;
  valor: number;
  /** Texto do balão ao passar o mouse (e da leitura por acessibilidade). */
  descricao: string;
}

/** Gráfico de barras em SVG (sem biblioteca). Barras na cor de destaque da loja; o último
 * ponto (hoje) fica mais forte. Com muitos pontos, só alguns rótulos aparecem no eixo. */
export function GraficoBarras({ pontos, altura = 160, destacarUltimo = true }: { pontos: PontoDoGrafico[]; altura?: number; destacarUltimo?: boolean }) {
  const maximo = Math.max(...pontos.map((p) => p.valor), 0);
  const passoRotulo = Math.max(1, Math.ceil(pontos.length / 8));

  if (pontos.length === 0 || maximo === 0) {
    return <p className="flex items-center justify-center rounded-lg border border-dashed border-ink-700 text-sm text-ink-500" style={{ height: altura }}>Sem vendas no período.</p>;
  }

  return (
    <div role="img" aria-label={`Gráfico de barras: ${pontos.map((p) => p.descricao).join('; ')}`}>
      <div className="flex items-end gap-1 border-b border-ink-700" style={{ height: altura }}>
        {pontos.map((p, i) => {
          const ultimo = destacarUltimo && i === pontos.length - 1;
          return (
            <div key={`${p.rotulo}-${i}`} title={p.descricao} className="group flex h-full min-w-0 flex-1 items-end">
              <div
                className={['w-full rounded-t transition-colors', ultimo ? 'bg-tenant' : 'bg-tenant/55 group-hover:bg-tenant'].join(' ')}
                style={{ height: `${Math.max(p.valor > 0 ? 3 : 0, (p.valor / maximo) * 100)}%` }}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-1.5 flex gap-1">
        {pontos.map((p, i) => (
          <span key={`${p.rotulo}-r${i}`} className="min-w-0 flex-1 truncate text-center text-[10px] text-ink-500">
            {i % passoRotulo === 0 || i === pontos.length - 1 ? p.rotulo : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
