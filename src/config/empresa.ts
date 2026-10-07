/**
 * Dados da Total Software que aparecem nos Termos de Uso e na Política de
 * Privacidade. PREENCHA antes de publicar o site: enquanto algum campo estiver
 * vazio, as páginas mostram o texto entre [colchetes] e o `vite build` avisa.
 * (Os textos em si precisam de revisão jurídica.)
 */
export const TOTAL_SOFTWARE = {
  razaoSocial: '',
  cnpj: '',
  /** Para dúvidas sobre os Termos de Uso. */
  emailContato: '',
  /** Encarregado de dados (DPO): recebe os pedidos de titulares (LGPD). */
  emailDpo: '',
};

const ROTULOS: Record<keyof typeof TOTAL_SOFTWARE, string> = {
  razaoSocial: 'Razão Social da Total Software LTDA',
  cnpj: '00.000.000/0000-00',
  emailContato: 'e-mail de contato da Total Software',
  emailDpo: 'e-mail do encarregado/DPO da Total Software',
};

/** O valor preenchido ou, se faltar, o marcador entre colchetes. */
export function dadoLegal(campo: keyof typeof TOTAL_SOFTWARE): string {
  return TOTAL_SOFTWARE[campo].trim() || `[${ROTULOS[campo]}]`;
}

export const dadosLegaisPendentes = Object.values(TOTAL_SOFTWARE).some((v) => !v.trim());
