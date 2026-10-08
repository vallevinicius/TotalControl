import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '@/contexts/ToastContext';
import { redefinirSenha } from '@/services/apiService';
import { AuthLayout } from './AuthLayout';
import { AuthInput } from './AuthInput';
import { IconeSenha } from './icones';

export function RedefinirSenhaScreen() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const convite = params.get('convite') === '1';
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [enviando, setEnviando] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (senha !== confirmar) return toast.erro('As senhas não conferem.');
    if (senha.length < 8 || !/[A-Za-z]/.test(senha) || !/\d/.test(senha)) {
      return toast.erro('A senha precisa ter 8 ou mais caracteres, com letras e números.');
    }
    setEnviando(true);
    try {
      await redefinirSenha(token, senha);
      toast.sucesso(convite ? 'Senha criada. Agora é só entrar.' : 'Senha alterada. Entre com a nova senha.');
      navigate('/login', { replace: true });
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Não foi possível alterar a senha.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <AuthLayout
      titulo={convite ? 'Crie a sua senha' : 'Criar nova senha'}
      subtitulo={convite ? 'Você foi convidado para o Total Control. Escolha a senha de acesso' : 'Escolha uma senha que você não use em outros lugares'}
      rodape={
        <Link to="/login" className="font-medium text-tenant hover:underline">
          Voltar para o login
        </Link>
      }
    >
      {!token ? (
        <p className="rounded-lg bg-red-500/10 px-4 py-3 text-center text-sm text-red-400">
          Link inválido. Peça um novo em{' '}
          <Link to="/esqueci-senha" className="font-medium underline">
            Esqueci minha senha
          </Link>
          .
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <AuthInput
            label="Nova senha"
            type="password"
            required
            autoFocus
            minLength={8}
            placeholder="8+ caracteres, com letras e números"
            value={senha}
            onChange={(e) => setSenha(e.target.value)}
            icone={<IconeSenha className="h-4 w-4" />}
            alternarVisibilidade
          />
          <AuthInput
            label="Confirmar nova senha"
            type="password"
            required
            minLength={8}
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            icone={<IconeSenha className="h-4 w-4" />}
            alternarVisibilidade
          />
          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-lg bg-tenant py-2.5 text-sm font-semibold text-tenant-foreground shadow-sm shadow-tenant/20 transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {enviando ? 'Salvando…' : 'Salvar nova senha'}
          </button>
        </form>
      )}
    </AuthLayout>
  );
}
