import { useState, type FormEvent, type ReactNode } from 'react';
import { Captcha, CHAVE_CAPTCHA } from './Captcha';
import { ConfirmeEmail } from './ConfirmeEmail';
import { Link, useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { ThemeToggle } from '@/components/Common/ThemeToggle';
import { LogoMark } from '@/components/Common/LogoMark';
import { SparklesCore } from '@/components/ui/sparkles';
import { cnpjValido, cpfValido, mascararCep, mascararCnpj, mascararCpf, mascararTelefone } from '@/utils/mascaras';
import { AuthInput } from './AuthInput';
import { AuthCheckbox } from './AuthCheckbox';
import { AuthCombobox } from './AuthCombobox';
import { TIPOS_EMPRESA, UFS } from '@/utils/empresa';
import { IconeEmail, IconeId, IconeLoja, IconeSenha, IconeTelefone, IconeUsuario } from './icones';

const CLASSE_CAMPO =
  'w-full rounded-lg border border-ink-600 bg-ink-700/60 px-3 py-2.5 text-sm text-ink-100 placeholder:text-ink-500 transition-colors focus:border-tenant focus:bg-ink-700 focus:outline-none focus:ring-2 focus:ring-tenant/15';

function Secao({ numero, titulo, descricao, children }: { numero: number; titulo: string; descricao: string; children: ReactNode }) {
  const reduzirMovimento = useReducedMotion();
  return (
    <motion.section
      initial={reduzirMovimento ? false : { opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl border border-ink-700 bg-ink-800 p-6 shadow-xl shadow-black/5 sm:p-7"
    >
      <div className="flex items-start gap-3.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-tenant font-display text-sm font-bold text-tenant-foreground">
          {numero}
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-ink-100">{titulo}</h2>
          <p className="mt-0.5 text-sm text-ink-400">{descricao}</p>
        </div>
      </div>
      <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-6">{children}</div>
    </motion.section>
  );
}

/** Coluna do grid da seção (o grid tem 6 colunas em telas ≥ sm). */
function Col({ span = 6, children }: { span?: 2 | 3 | 4 | 6; children: ReactNode }) {
  const classe = { 2: 'sm:col-span-2', 3: 'sm:col-span-3', 4: 'sm:col-span-4', 6: 'sm:col-span-6' }[span];
  return <div className={classe}>{children}</div>;
}

export function RegisterScreen() {
  const { registrar } = useTenant();
  const [captchaToken, setCaptchaToken] = useState<string | null>(null);
  const [reiniciarCaptcha, setReiniciarCaptcha] = useState(0);
  const [emailCadastrado, setEmailCadastrado] = useState<string | null>(null);
  const toast = useToast();
  const navigate = useNavigate();
  const reduzirMovimento = useReducedMotion();

  // Empresa
  const [cnpj, setCnpj] = useState('');
  const [razaoSocial, setRazaoSocial] = useState('');
  const [nomeFantasia, setNomeFantasia] = useState('');
  const [inscricaoEstadual, setInscricaoEstadual] = useState('');
  const [inscricaoMunicipal, setInscricaoMunicipal] = useState('');
  const [regimeTributario, setRegimeTributario] = useState('');
  // Contato
  const [telefone, setTelefone] = useState('');
  const [emailContato, setEmailContato] = useState('');
  const [site, setSite] = useState('');
  // Endereço
  const [cep, setCep] = useState('');
  const [logradouro, setLogradouro] = useState('');
  const [numero, setNumero] = useState('');
  const [complemento, setComplemento] = useState('');
  const [bairro, setBairro] = useState('');
  const [cidade, setCidade] = useState('');
  const [uf, setUf] = useState('');
  // Responsável
  const [nomeAdmin, setNomeAdmin] = useState('');
  const [cpfAdmin, setCpfAdmin] = useState('');
  const [telefoneAdmin, setTelefoneAdmin] = useState('');
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [confirmarSenha, setConfirmarSenha] = useState('');

  const [aceitouTermos, setAceitouTermos] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [buscandoCnpj, setBuscandoCnpj] = useState(false);
  const [buscandoCep, setBuscandoCep] = useState(false);

  /** Preenche os dados da empresa pelo CNPJ (BrasilAPI, consulta pública à
   * Receita). Só roda quando a pessoa clica — nada é enviado sozinho. */
  async function buscarCnpj() {
    const digitos = cnpj.replace(/\D/g, '');
    if (!cnpjValido(digitos)) {
      toast.erro('Informe um CNPJ válido para buscar os dados.');
      return;
    }
    setBuscandoCnpj(true);
    try {
      const resp = await fetch(`https://brasilapi.com.br/api/cnpj/v1/${digitos}`);
      if (!resp.ok) throw new Error();
      const d = await resp.json();
      if (d.razao_social) setRazaoSocial(d.razao_social);
      if (d.nome_fantasia || d.razao_social) setNomeFantasia(d.nome_fantasia || d.razao_social);
      if (d.ddd_telefone_1) setTelefone(mascararTelefone(String(d.ddd_telefone_1)));
      if (d.email) setEmailContato(String(d.email).toLowerCase());
      if (d.cep) setCep(mascararCep(String(d.cep)));
      if (d.logradouro) setLogradouro([d.descricao_tipo_de_logradouro, d.logradouro].filter(Boolean).join(' '));
      if (d.numero) setNumero(String(d.numero));
      if (d.complemento) setComplemento(d.complemento);
      if (d.bairro) setBairro(d.bairro);
      if (d.municipio) setCidade(d.municipio);
      if (d.uf) setUf(d.uf);
      toast.sucesso('Dados da empresa preenchidos. Confira e complete o que faltar.');
    } catch {
      toast.erro('Não encontramos esse CNPJ. Preencha os dados manualmente.');
    } finally {
      setBuscandoCnpj(false);
    }
  }

  /** Completa o endereço assim que o CEP tem 8 dígitos (ViaCEP). */
  async function buscarCep(valor: string) {
    const digitos = valor.replace(/\D/g, '');
    if (digitos.length !== 8) return;
    setBuscandoCep(true);
    try {
      const resp = await fetch(`https://viacep.com.br/ws/${digitos}/json/`);
      const d = await resp.json();
      if (d.erro) return;
      if (d.logradouro) setLogradouro(d.logradouro);
      if (d.bairro) setBairro(d.bairro);
      if (d.localidade) setCidade(d.localidade);
      if (d.uf) setUf(d.uf);
    } catch {
      // Sem internet ou serviço fora do ar: a pessoa preenche na mão.
    } finally {
      setBuscandoCep(false);
    }
  }

  // Progresso mostrado na lateral: cada etapa marca o check quando o que é
  // essencial nela está preenchido (opcionais como site e complemento não contam).
  const etapas = [
    {
      titulo: 'Dados da empresa',
      dica: 'CNPJ, razão social e nome fantasia',
      completa: cnpjValido(cnpj) && razaoSocial.trim().length >= 2 && nomeFantasia.trim().length >= 2,
    },
    {
      titulo: 'Contato e endereço',
      dica: 'Telefone ou e-mail, e endereço',
      completa:
        Boolean(telefone.trim() || emailContato.trim()) &&
        Boolean(cep.trim() && logradouro.trim() && numero.trim() && cidade.trim() && uf),
    },
    {
      titulo: 'Responsável e acesso',
      dica: 'Nome, e-mail e senha',
      completa:
        nomeAdmin.trim().length >= 2 &&
        /\S+@\S+\.\S+/.test(email) &&
        senha.length >= 6 &&
        senha === confirmarSenha,
    },
  ];
  const etapaAtual = etapas.findIndex((etapa) => !etapa.completa);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!aceitouTermos) return;
    if (CHAVE_CAPTCHA && !captchaToken) return toast.erro('Conclua a verificação de segurança antes de continuar.');
    if (!cnpjValido(cnpj)) return toast.erro('CNPJ inválido. Confira os números.');
    if (cpfAdmin && !cpfValido(cpfAdmin)) return toast.erro('CPF do responsável inválido.');
    if (senha !== confirmarSenha) return toast.erro('As senhas não conferem.');
    if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) return toast.erro('A senha precisa ter 8 ou mais caracteres, com letras e números.');

    setEnviando(true);
    try {
      await registrar({
        aceitouTermos,
        nomeFantasia,
        razaoSocial,
        cnpj,
        inscricaoEstadual: inscricaoEstadual || undefined,
        inscricaoMunicipal: inscricaoMunicipal || undefined,
        regimeTributario: regimeTributario || undefined,
        telefone: telefone || undefined,
        emailContato: emailContato || undefined,
        site: site || undefined,
        cep: cep || undefined,
        logradouro: logradouro || undefined,
        numero: numero || undefined,
        complemento: complemento || undefined,
        bairro: bairro || undefined,
        cidade: cidade || undefined,
        uf: uf || undefined,
        nomeAdmin,
        cpfAdmin: cpfAdmin || undefined,
        telefoneAdmin: telefoneAdmin || undefined,
        email,
        senha,
        captchaToken: captchaToken ?? undefined,
      });
      setEmailCadastrado(email);
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Erro ao criar a loja.');
      setReiniciarCaptcha((n) => n + 1); // o token do captcha vale uma vez só
    } finally {
      setEnviando(false);
    }
  }

  if (emailCadastrado) return <ConfirmeEmail email={emailCadastrado} />;

  return (
    <div className="relative min-h-screen w-full bg-ink-900">
      {!reduzirMovimento && (
        <div className="pointer-events-none fixed inset-0" aria-hidden>
          <SparklesCore background="transparent" minSize={0.4} maxSize={1.1} particleDensity={40} speed={0.6} particleColor="#10B981" className="h-full w-full" />
        </div>
      )}
      <div
        className="pointer-events-none fixed -left-32 -top-32 h-96 w-96 rounded-full bg-tenant/15 blur-3xl"
        style={{ animation: 'auth-flutuar 12s ease-in-out infinite' }}
        aria-hidden
      />

      <header className="relative z-10 border-b border-ink-700 bg-ink-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-5 py-4">
          <Link to="/" className="flex items-center gap-2.5">
            <LogoMark className="h-9 w-9 rounded-lg" />
            <span className="font-display text-base font-semibold tracking-tight text-ink-100">Total Control</span>
          </Link>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <p className="hidden text-sm text-ink-400 sm:block">
              Já tem uma conta?{' '}
              <Link to="/login" className="font-medium text-tenant hover:underline">
                Entrar
              </Link>
            </p>
          </div>
        </div>
      </header>

      <main className="relative mx-auto grid max-w-6xl gap-10 px-5 py-10 lg:grid-cols-[320px_1fr] lg:py-14">
        <motion.aside
          initial={reduzirMovimento ? false : { opacity: 0, x: -24 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
          className="lg:sticky lg:top-10 lg:self-start"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-ink-700 bg-ink-800 px-3 py-1 text-xs font-medium text-tenant">
            <span className="h-1.5 w-1.5 rounded-full bg-tenant" aria-hidden />
            14 dias grátis, sem cartão
          </span>
          <h1 className="mt-4 font-display text-3xl font-bold leading-tight tracking-tight text-ink-100">
            Cadastre sua empresa
          </h1>
          <p className="mt-3 text-ink-400">
            Com os dados completos, o sistema já sai configurado pra sua loja. Se você tem o CNPJ à mão, buscamos boa parte
            das informações pra você.
          </p>
          <ol className="mt-7">
            {etapas.map((etapa, i) => {
              const atual = i === etapaAtual;
              return (
                <li key={etapa.titulo} className="relative flex gap-3.5 pb-6 last:pb-0">
                  {i < etapas.length - 1 && (
                    <span aria-hidden className="absolute left-[13px] top-7 h-[calc(100%-1.75rem)] w-0.5 bg-ink-700">
                      <span
                        className="block w-full origin-top bg-tenant transition-transform duration-500"
                        style={{ height: '100%', transform: `scaleY(${etapa.completa ? 1 : 0})` }}
                      />
                    </span>
                  )}
                  <span
                    className={[
                      'relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold transition-all duration-300',
                      etapa.completa
                        ? 'border-tenant bg-tenant text-tenant-foreground shadow-md shadow-tenant/30'
                        : atual
                          ? 'border-tenant text-tenant ring-4 ring-tenant/15'
                          : 'border-ink-600 text-ink-500',
                    ].join(' ')}
                  >
                    {etapa.completa ? (
                      <motion.svg
                        key="check"
                        viewBox="0 0 16 16"
                        className="h-3.5 w-3.5"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth={2.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      >
                        <motion.path
                          d="m3.5 8.5 3 3 6-7"
                          initial={{ pathLength: 0 }}
                          animate={{ pathLength: 1 }}
                          transition={{ duration: 0.35, ease: 'easeOut' }}
                        />
                      </motion.svg>
                    ) : (
                      i + 1
                    )}
                  </span>
                  <div className="pt-0.5">
                    <p className={['text-sm font-medium transition-colors', etapa.completa || atual ? 'text-ink-100' : 'text-ink-400'].join(' ')}>
                      {etapa.titulo}
                    </p>
                    <p className="text-xs text-ink-500">{etapa.completa ? 'Concluído' : etapa.dica}</p>
                  </div>
                </li>
              );
            })}
          </ol>
          <p className="mt-6 text-xs text-ink-500">Campos com * são obrigatórios.</p>
        </motion.aside>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Secao numero={1} titulo="Dados da empresa" descricao="Informações que identificam sua empresa.">
            <Col span={4}>
              <AuthInput
                label="CNPJ *"
                required
                autoFocus
                inputMode="numeric"
                value={cnpj}
                onChange={(e) => setCnpj(mascararCnpj(e.target.value))}
                placeholder="00.000.000/0001-00"
                maxLength={18}
                icone={<IconeId className="h-4 w-4" />}
              />
            </Col>
            <div className="flex items-end sm:col-span-2">
              <button
                type="button"
                onClick={buscarCnpj}
                disabled={buscandoCnpj || cnpj.replace(/\D/g, '').length !== 14}
                className="w-full rounded-lg border border-tenant/50 px-3 py-2.5 text-sm font-semibold text-tenant transition-colors hover:bg-tenant-soft disabled:cursor-not-allowed disabled:opacity-40"
              >
                {buscandoCnpj ? 'Buscando…' : 'Buscar dados'}
              </button>
            </div>
            <Col span={3}>
              <AuthInput label="Razão social *" required value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)} />
            </Col>
            <Col span={3}>
              <AuthInput
                label="Nome fantasia *"
                required
                value={nomeFantasia}
                onChange={(e) => setNomeFantasia(e.target.value)}
                icone={<IconeLoja className="h-4 w-4" />}
              />
            </Col>
            <Col span={3}>
              <AuthInput label="Inscrição estadual" value={inscricaoEstadual} onChange={(e) => setInscricaoEstadual(e.target.value)} />
            </Col>
            <Col span={3}>
              <AuthInput label="Inscrição municipal" value={inscricaoMunicipal} onChange={(e) => setInscricaoMunicipal(e.target.value)} />
            </Col>
            <Col span={6}>
              <AuthCombobox
                label="Tipo de empresa / regime tributário"
                value={regimeTributario}
                onChange={setRegimeTributario}
                grupos={TIPOS_EMPRESA}
                placeholder="Escolha uma opção ou digite"
              />
            </Col>
          </Secao>

          <Secao numero={2} titulo="Contato e endereço" descricao="Como falar com a empresa e onde ela fica.">
            <Col span={2}>
              <AuthInput
                label="Telefone"
                inputMode="numeric"
                value={telefone}
                onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
                placeholder="(00) 00000-0000"
                maxLength={15}
                icone={<IconeTelefone className="h-4 w-4" />}
              />
            </Col>
            <Col span={2}>
              <AuthInput
                label="E-mail da empresa"
                type="email"
                value={emailContato}
                onChange={(e) => setEmailContato(e.target.value)}
                icone={<IconeEmail className="h-4 w-4" />}
              />
            </Col>
            <Col span={2}>
              <AuthInput label="Site" value={site} onChange={(e) => setSite(e.target.value)} placeholder="www.suaempresa.com.br" />
            </Col>

            <Col span={2}>
              <AuthInput
                label={buscandoCep ? 'CEP (buscando…)' : 'CEP'}
                inputMode="numeric"
                value={cep}
                onChange={(e) => {
                  const valor = mascararCep(e.target.value);
                  setCep(valor);
                  buscarCep(valor);
                }}
                placeholder="00000-000"
                maxLength={9}
              />
            </Col>
            <Col span={4}>
              <AuthInput label="Rua / Avenida" value={logradouro} onChange={(e) => setLogradouro(e.target.value)} />
            </Col>
            <Col span={2}>
              <AuthInput label="Número" value={numero} onChange={(e) => setNumero(e.target.value)} />
            </Col>
            <Col span={4}>
              <AuthInput label="Complemento" value={complemento} onChange={(e) => setComplemento(e.target.value)} />
            </Col>
            <Col span={2}>
              <AuthInput label="Bairro" value={bairro} onChange={(e) => setBairro(e.target.value)} />
            </Col>
            <Col span={4}>
              <AuthInput label="Cidade" value={cidade} onChange={(e) => setCidade(e.target.value)} />
            </Col>
            <Col span={2}>
              <label className="block text-sm font-medium text-ink-300">
                Estado
                <select value={uf} onChange={(e) => setUf(e.target.value)} className={`${CLASSE_CAMPO} mt-1.5`}>
                  <option value="">UF</option>
                  {UFS.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              </label>
            </Col>
          </Secao>

          <Secao numero={3} titulo="Responsável e acesso" descricao="Quem administra a conta e entra no sistema.">
            <Col span={3}>
              <AuthInput
                label="Nome completo *"
                required
                value={nomeAdmin}
                onChange={(e) => setNomeAdmin(e.target.value)}
                icone={<IconeUsuario className="h-4 w-4" />}
              />
            </Col>
            <Col span={3}>
              <AuthInput
                label="CPF"
                inputMode="numeric"
                value={cpfAdmin}
                onChange={(e) => setCpfAdmin(mascararCpf(e.target.value))}
                placeholder="000.000.000-00"
                maxLength={14}
                icone={<IconeId className="h-4 w-4" />}
              />
            </Col>
            <Col span={3}>
              <AuthInput
                label="Celular / WhatsApp"
                inputMode="numeric"
                value={telefoneAdmin}
                onChange={(e) => setTelefoneAdmin(mascararTelefone(e.target.value))}
                placeholder="(00) 00000-0000"
                maxLength={15}
                icone={<IconeTelefone className="h-4 w-4" />}
              />
            </Col>
            <Col span={3}>
              <AuthInput
                label="E-mail de acesso *"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                icone={<IconeEmail className="h-4 w-4" />}
              />
            </Col>
            <Col span={3}>
              <AuthInput
                label="Senha *"
                type="password"
                required
                minLength={8}
                placeholder="8+ caracteres, com letras e números"
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                icone={<IconeSenha className="h-4 w-4" />}
                alternarVisibilidade
              />
            </Col>
            <Col span={3}>
              <AuthInput
                label="Confirmar senha *"
                type="password"
                required
                minLength={8} placeholder="8+ caracteres, com letras e números"
                value={confirmarSenha}
                onChange={(e) => setConfirmarSenha(e.target.value)}
                icone={<IconeSenha className="h-4 w-4" />}
                alternarVisibilidade
              />
            </Col>
          </Secao>

          <div className="rounded-2xl border border-ink-700 bg-ink-800 p-6 shadow-xl shadow-black/5 sm:p-7">
            <AuthCheckbox required checked={aceitouTermos} onChange={(e) => setAceitouTermos(e.target.checked)}>
              Li e concordo com os{' '}
              <Link to="/termos" target="_blank" className="font-medium text-tenant hover:underline">
                Termos de Uso
              </Link>{' '}
              e a{' '}
              <Link to="/privacidade" target="_blank" className="font-medium text-tenant hover:underline">
                Política de Privacidade
              </Link>
              .
            </AuthCheckbox>

            <div className="mt-5">
              <Captcha aoMudar={setCaptchaToken} reiniciar={reiniciarCaptcha} />
            </div>

            <button
              type="submit"
              disabled={enviando || !aceitouTermos || Boolean(CHAVE_CAPTCHA && !captchaToken)}
              className="mt-5 w-full rounded-lg bg-tenant py-3 text-sm font-semibold text-tenant-foreground shadow-sm shadow-tenant/20 transition-all hover:shadow-md hover:shadow-tenant/25 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
            >
              {enviando ? 'Criando loja…' : 'Criar minha loja'}
            </button>
            <p className="mt-4 text-center text-sm text-ink-400 sm:hidden">
              Já tem uma conta?{' '}
              <Link to="/login" className="font-medium text-tenant hover:underline">
                Entrar
              </Link>
            </p>
          </div>
        </form>
      </main>
    </div>
  );
}
