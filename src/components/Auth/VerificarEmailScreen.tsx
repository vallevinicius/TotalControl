import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { verificarEmail } from '@/services/apiService';
import { AuthLayout } from './AuthLayout';

/** Destino do link do e-mail de confirmação. */
export function VerificarEmailScreen() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const [estado, setEstado] = useState<'verificando' | 'ok' | 'erro'>(token ? 'verificando' : 'erro');
  const [mensagem, setMensagem] = useState('');
  const jaTentou = useRef(false); // StrictMode roda o efeito duas vezes e o link vale uma vez só

  useEffect(() => {
    if (!token || jaTentou.current) return;
    jaTentou.current = true;
    verificarEmail(token)
      .then(() => setEstado('ok'))
      .catch((e) => {
        setMensagem(e instanceof Error ? e.message : '');
        setEstado('erro');
      });
  }, [token]);

  return (
    <AuthLayout
      titulo={estado === 'ok' ? 'E-mail confirmado' : estado === 'erro' ? 'Link inválido' : 'Confirmando…'}
      subtitulo={estado === 'ok' ? 'Sua conta está liberada' : estado === 'erro' ? 'Não foi possível confirmar o e-mail' : 'Só um instante'}
      rodape={
        <Link to="/login" className="font-medium text-tenant hover:underline">
          Ir para o login
        </Link>
      }
    >
      {estado === 'ok' && <p className="text-center text-sm text-ink-300">Pronto! Agora é só entrar com o seu e-mail e a senha que você criou.</p>}
      {estado === 'erro' && (
        <p className="rounded-lg bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
          {mensagem || 'Este link é inválido ou venceu.'} Na tela de login, tente entrar para receber um novo link.
        </p>
      )}
    </AuthLayout>
  );
}
