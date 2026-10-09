import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useToast } from '@/contexts/ToastContext';
import { reenviarVerificacao } from '@/services/apiService';
import { AuthLayout } from './AuthLayout';

/** "Enviamos um link": tela pós-cadastro (e do login de conta ainda não confirmada). */
export function ConfirmeEmail({ email }: { email: string }) {
  const toast = useToast();
  const [espera, setEspera] = useState(60);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (espera <= 0) return;
    const t = setTimeout(() => setEspera((e) => e - 1), 1000);
    return () => clearTimeout(t);
  }, [espera]);

  async function reenviar() {
    setEnviando(true);
    try {
      await reenviarVerificacao(email);
      toast.sucesso('Pronto, enviamos um novo link.');
      setEspera(60);
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível reenviar.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AuthLayout
      titulo="Confirme seu e-mail"
      subtitulo="Falta só um passo para liberar a sua conta"
      rodape={
        <Link to="/login" className="font-medium text-tenant hover:underline">
          Ir para o login
        </Link>
      }
    >
      <div className="space-y-4 text-center text-sm text-ink-300">
        <p>
          Enviamos um link de confirmação para <span className="font-medium text-ink-100">{email}</span>. Clique nele para ativar a conta (vale por 24 horas).
        </p>
        <p className="text-xs text-ink-400">Não achou? Olhe também a caixa de spam.</p>
        <button
          onClick={reenviar}
          disabled={enviando || espera > 0}
          className="rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-200 hover:border-tenant hover:text-tenant disabled:cursor-not-allowed disabled:opacity-40"
        >
          {enviando ? 'Enviando…' : espera > 0 ? `Reenviar e-mail (${espera}s)` : 'Reenviar e-mail'}
        </button>
      </div>
    </AuthLayout>
  );
}
