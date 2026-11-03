export interface ProblemaConfig {
  nivel: 'erro' | 'aviso';
  variavel: string;
  mensagem: string;
}

type Env = Record<string, string | undefined>;

const PLACEHOLDER = /troque|^-+$|seudominio|exemplo/i;

function preenchida(env: Env, nome: string): boolean {
  const v = env[nome]?.trim();
  return !!v && !PLACEHOLDER.test(v);
}

/** Confere se o ambiente está pronto para produção. `erro` impede de subir; `aviso`
 * sobe, mas deixa um recurso desligado ou menos seguro. Pura: não lê o processo. */
export function verificarProducao(env: Env): ProblemaConfig[] {
  const problemas: ProblemaConfig[] = [];
  const erro = (variavel: string, mensagem: string) => problemas.push({ nivel: 'erro', variavel, mensagem });
  const aviso = (variavel: string, mensagem: string) => problemas.push({ nivel: 'aviso', variavel, mensagem });

  if (env.NODE_ENV !== 'production') erro('NODE_ENV', 'Deve ser "production".');

  if (!env.DATABASE_URL?.startsWith('mysql://')) erro('DATABASE_URL', 'Falta a conexão com o MySQL (mysql://usuario:senha@host:3306/banco).');
  else if (/^mysql:\/\/root[:@]/.test(env.DATABASE_URL)) erro('DATABASE_URL', 'Não use o usuário root: crie um usuário próprio do banco.');

  const jwt = env.JWT_SECRET?.trim() ?? '';
  if (jwt.length < 32 || PLACEHOLDER.test(jwt)) erro('JWT_SECRET', 'Use um segredo aleatório de 32+ caracteres (openssl rand -hex 48).');

  if (!preenchida(env, 'ADMIN_EMAIL')) erro('ADMIN_EMAIL', 'Defina o e-mail de login do painel /admin.');
  if (!preenchida(env, 'ADMIN_SENHA')) erro('ADMIN_SENHA', 'Defina uma senha forte para o painel /admin.');

  if (!env.APP_URL?.startsWith('https://')) erro('APP_URL', 'Informe o endereço público do site com https:// (links de e-mail, CORS e retorno do pagamento).');

  if (!env.TRUST_PROXY?.trim()) aviso('TRUST_PROXY', 'Atrás de proxy, defina 1; sem isso o limite de tentativas vale para o proxy inteiro.');
  if (!preenchida(env, 'SMTP_HOST') || !preenchida(env, 'SMTP_USER') || !preenchida(env, 'SMTP_PASS')) {
    aviso('SMTP_HOST', 'E-mail desligado: recuperação de senha e verificação de e-mail não chegam.');
  }
  if (!preenchida(env, 'MERCADOPAGO_ACCESS_TOKEN')) aviso('MERCADOPAGO_ACCESS_TOKEN', 'Pagamento de assinaturas indisponível.');
  if (!preenchida(env, 'MERCADOPAGO_WEBHOOK_SECRET')) aviso('MERCADOPAGO_WEBHOOK_SECRET', 'Notificações do Mercado Pago sem assinatura serão aceitas.');
  if (!env.API_PUBLIC_URL?.startsWith('https://')) aviso('API_PUBLIC_URL', 'Sem o endereço público da API o Mercado Pago não consegue avisar pagamentos.');
  if (!preenchida(env, 'TURNSTILE_SECRET_KEY')) aviso('TURNSTILE_SECRET_KEY', 'Cadastro sem captcha.');
  if (!preenchida(env, 'SENTRY_DSN')) aviso('SENTRY_DSN', 'Erros não são enviados para monitoramento.');

  return problemas;
}
