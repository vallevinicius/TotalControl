/** Juros repassados ao cliente na parte paga no crédito em mais de PARCELAS_SEM_JUROS parcelas. */
export const TAXA_CARTAO_CREDITO = 0.05;

/** Até este número de parcelas no crédito não há juros; acima dele a taxa é repassada. */
export const PARCELAS_SEM_JUROS = 3;

/** Máximo de parcelas no crédito. */
export const MAX_PARCELAS = 12;

export const arredondar = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
