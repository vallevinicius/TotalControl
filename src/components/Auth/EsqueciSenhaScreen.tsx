import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '@/contexts/ToastContext';
import { esqueciSenha } from '@/services/apiService';
import { AuthLayout } from './AuthLayout';
import { AuthInput } from './AuthInput';
import { IconeEmail } from './icones';

export function EsqueciSenhaScreen() {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setEnviando(true);
    try {
      await esqueciSenha(email.trim());
      setEnviado(true);
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Não foi possível enviar agora.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AuthLayout
      titulo="Esqueci minha senha"
      subtitulo="Enviamos um link para você criar uma nova"
      rodape={
        <Link to="/login" className="font-medium text-tenant hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {enviado ? (
        <div className="space-y-3 text-center">
          <p className="rounded-lg bg-emerald-500/10 px-4 py-3 text-sm text-emerald-400">
            Se existir uma conta com <span className="font-medium">{email}</span>, o link já está a caminho.
          </p>
          <p className="text-xs text-ink-500">O link vale por 1 hora. Não chegou? Veja o spam ou tente de novo em alguns minutos.</p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthInput
            label="E-mail da sua conta"
            type="email"
            required
            autoFocus
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            icone={<IconeEmail className="h-4 w-4" />}
          />
          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-lg bg-tenant py-2.5 text-sm font-semibold text-tenant-foreground shadow-sm shadow-tenant/20 transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando ? 'Enviando…' : 'Enviar link'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
