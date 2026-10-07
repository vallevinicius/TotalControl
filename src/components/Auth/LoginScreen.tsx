import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { ErroApi, confirmarCodigoAdmin, loginAdmin } from '@/services/apiService';
import { AuthLayout } from './AuthLayout';
import { AuthInput } from './AuthInput';
import { AuthCheckbox } from './AuthCheckbox';
import { IconeEmail, IconeSenha } from './icones';

const CHAVE_EMAIL_LEMBRADO = 'tc-login-email-lembrado';

function lerEmailLembrado(): string {
  try {
    return localStorage.getItem(CHAVE_EMAIL_LEMBRADO) ?? '';
  } catch {
    return '';
  }
}

export function LoginScreen() {
  const { login } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();
  const [email, setEmail] = useState(lerEmailLembrado);
  const [senha, setSenha] = useState('');
  const [lembrar, setLembrar] = useState(() => Boolean(lerEmailLembrado()));
  const [enviando, setEnviando] = useState(false);
  // Admin com verificação em duas etapas: depois da senha, pede o código do app.
  const [desafioAdmin, setDesafioAdmin] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await login(email, senha);
      try {
        if (lembrar) localStorage.setItem(CHAVE_EMAIL_LEMBRADO, email);
        else localStorage.removeItem(CHAVE_EMAIL_LEMBRADO);
      } catch {
        // Armazenamento local indisponível (modo privado, etc.) — não impede o login.
      }
      navigate('/', { replace: true });
    } catch (erro) {
      // 401 = credenciais não batem com nenhuma loja — tenta como admin da
      // plataforma antes de desistir. Outros status (ex: 403 de loja
      // suspensa/trial expirado) já têm mensagem própria e não devem cair
      // nessa segunda tentativa.
      if (!(erro instanceof ErroApi) || erro.status !== 401) {
        toast.erro(erro instanceof Error ? erro.message : 'Erro ao entrar.');
        setEnviando(false);
        return;
      }
      try {
        const { desafio } = await loginAdmin(email, senha);
        if (desafio) {
          setDesafioAdmin(desafio);
          return;
        }
        navigate('/admin', { replace: true });
      } catch (erroAdmin) {
        // 429 = limite de tentativas: mostra o aviso do servidor em vez de "senha inválida".
        toast.erro(erroAdmin instanceof ErroApi && erroAdmin.status === 429 ? erroAdmin.message : 'E-mail ou senha inválidos.');
      }
    } finally {
      setEnviando(false);
    }
  }

  async function handleCodigo(e: FormEvent) {
    e.preventDefault();
    if (!desafioAdmin) return;
    setEnviando(true);
    try {
      await confirmarCodigoAdmin(desafioAdmin, codigo);
      navigate('/admin', { replace: true });
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Código inválido.');
      // Desafio vencido (5 min): volta pra senha.
      if (erro instanceof ErroApi && erro.status === 401 && /expirou/i.test(erro.message)) {
        setDesafioAdmin(null);
        setSenha('');
      }
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  }

  if (desafioAdmin) {
    return (
      <AuthLayout
        titulo="Verificação em duas etapas"
        subtitulo="Digite o código de 6 dígitos do seu aplicativo autenticador"
        rodape={
          <button onClick={() => { setDesafioAdmin(null); setSenha(''); setCodigo(''); }} className="font-medium text-tenant hover:underline">
            Voltar
          </button>
        }
      >
        <form onSubmit={handleCodigo} className="space-y-4">
          <AuthInput
            label="Código"
            required
            autoFocus
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            placeholder="000000"
            value={codigo}
            onChange={(e) => setCodigo(e.target.value.replace(/\D/g, ''))}
            icone={<IconeSenha className="h-4 w-4" />}
          />
          <button
            type="submit"
            disabled={enviando || codigo.length !== 6}
            className="w-full rounded-lg bg-tenant py-2.5 text-sm font-semibold text-tenant-foreground shadow-sm shadow-tenant/20 transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando ? 'Verificando…' : 'Confirmar'}
          </button>
        </form>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      titulo="Entrar"
      subtitulo="Acesse o painel da sua loja"
      rodape={
        <>
          Ainda não tem uma loja?{' '}
          <Link to="/registrar" className="font-medium text-tenant hover:underline">
            Criar conta
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthInput
          label="E-mail"
          type="email"
          required
          autoFocus
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          icone={<IconeEmail className="h-4 w-4" />}
        />

        <AuthInput
          label="Senha"
          type="password"
          required
          value={senha}
          onChange={(e) => setSenha(e.target.value)}
          icone={<IconeSenha className="h-4 w-4" />}
          alternarVisibilidade
        />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <AuthCheckbox checked={lembrar} onChange={(e) => setLembrar(e.target.checked)}>
            Lembrar meu e-mail
          </AuthCheckbox>
          <Link to="/esqueci-senha" className="text-sm font-medium text-tenant hover:underline">
            Esqueci minha senha
          </Link>
        </div>

        <button
          type="submit"
          disabled={enviando}
          className="w-full rounded-lg bg-tenant py-2.5 text-sm font-semibold text-tenant-foreground shadow-sm shadow-tenant/20 transition-all hover:shadow-md hover:shadow-tenant/25 hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
        >
          {enviando ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </AuthLayout>
  );
}
