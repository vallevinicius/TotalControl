import type { SVGProps } from 'react';

/** Ícones de linha do menu lateral — mesmo traço em todos, herdam a cor do texto. */
function Base(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      {...props}
    />
  );
}

export const IconeDashboard = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="3" y="3" width="7.5" height="9" rx="1.5" />
    <rect x="13.5" y="3" width="7.5" height="5" rx="1.5" />
    <rect x="13.5" y="11" width="7.5" height="10" rx="1.5" />
    <rect x="3" y="15" width="7.5" height="6" rx="1.5" />
  </Base>
);

export const IconeCaixa = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M3 4h2.2l2 11h10.4l2-8H6.2" />
    <circle cx="9" cy="19.5" r="1.3" />
    <circle cx="17" cy="19.5" r="1.3" />
  </Base>
);

export const IconeEstoque = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M21 8 12 3 3 8v8l9 5 9-5V8Z" />
    <path d="m3 8 9 5 9-5M12 13v8" />
  </Base>
);

export const IconeClientes = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M18 14.8c1.8.7 3 2.4 3 5.2" />
  </Base>
);

export const IconeVendedores = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="10" cy="8" r="3.2" />
    <path d="M4 20c0-3.3 2.7-5.5 6-5.5 1.4 0 2.6.4 3.6 1" />
    <path d="m15.5 18.5 2 2 4-4.5" />
  </Base>
);

export const IconeFinanceiro = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="3" y="6" width="18" height="13" rx="2.5" />
    <path d="M3 10h18" />
    <path d="M7 15h3" />
  </Base>
);

export const IconeRelatorios = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M21 20H3" />
  </Base>
);

export const IconeUsuarios = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c0-3.6 3.1-6 7-6s7 2.4 7 6" />
  </Base>
);

export const IconePlano = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="m12 3 2.6 5.6 6 .7-4.4 4.1 1.2 6L12 16.5 6.6 19.4l1.2-6L3.4 9.3l6-.7L12 3Z" />
  </Base>
);

export const IconeAuditoria = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M12 3 4.5 6v5.5c0 4.5 3.1 8.2 7.5 9.5 4.4-1.3 7.5-5 7.5-9.5V6L12 3Z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Base>
);

export const IconeSeta = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="m9 6 6 6-6 6" />
  </Base>
);

export const IconeCadeado = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <rect x="5" y="11" width="14" height="9" rx="2" />
    <path d="M8 11V8a4 4 0 0 1 8 0v3" />
  </Base>
);

export const IconeLojas = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <path d="M4 9.5 5.5 4h13L20 9.5" />
    <path d="M4 9.5c0 1.4 1.1 2.5 2.5 2.5S9 10.9 9 9.5c0 1.4 1.1 2.5 2.5 2.5h1c1.4 0 2.5-1.1 2.5-2.5 0 1.4 1.1 2.5 2.5 2.5s2.5-1.1 2.5-2.5" />
    <path d="M5.5 12v8h13v-8M10 20v-4.5h4V20" />
  </Base>
);

export const IconeConta = (p: SVGProps<SVGSVGElement>) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="10" r="3" />
    <path d="M6.5 18.2c1.2-2 3-3 5.5-3s4.3 1 5.5 3" />
  </Base>
);
