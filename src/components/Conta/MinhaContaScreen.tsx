import { useState, type FormEvent } from 'react';
import { AppLayout } from '@/components/Layout/AppLayout';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { alterarSenha, atualizarPerfil } from '@/services/apiService';
import { SessoesAtivas } from './SessoesAtivas';
import { mascararTelefone } from '@/utils/mascaras';

const CAMPO =
  'mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-700/60 px-3 py-2.5 text-sm text-ink-100 focus:border-tenant focus:outline-none focus:ring-2 focus:ring-tenant/15';
const PAPEIS = { ADMIN: 'Administrador', GERENTE: 'Gerente', OPERADOR_CAIXA: 'Operador de caixa' } as const;

/** Dados e senha da própria pessoa logada. */
export function MinhaContaScreen() {
  const { usuarioAtual, recarregarSessao } = useTenant();
  const toast = useToast();

  const [nome, setNome] = useState(usuarioAtual?.nome ?? '');
  const [telefone, setTelefone] = useState(mascararTelefone(usuarioAtual?.telefone ?? ''));
  const [salvandoPerfil, setSalvandoPerfil] = useState(false);

  const [senhaAtual, setSenhaAtual] = useState('');
  const [novaSenha, setNovaSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [salvandoSenha, setSalvandoSenha] = useState(false);

  async function salvarPerfil(e: FormEvent) {
    e.preventDefault();
    setSalvandoPerfil(true);
    try {
      await atualizarPerfil({ nome: nome.trim(), telefone: telefone.trim() || undefined });
      await recarregarSessao();
      toast.sucesso('Dados atualizados.');
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Não foi possível salvar.');
    } finally {
      setSalvandoPerfil(false);
    }
  }

  async function salvarSenha(e: FormEvent) {
    e.preventDefault();
    if (novaSenha !== confirmar) return toast.erro('As senhas não conferem.');
    if (novaSenha.length < 8 || !/[A-Za-z]/.test(novaSenha) || !/\d/.test(novaSenha)) {
      return toast.erro('A nova senha precisa ter 8 ou mais caracteres, com letras e números.');
    }
    setSalvandoSenha(true);
    try {
      await alterarSenha(senhaAtual, novaSenha);
      setSenhaAtual('');
      setNovaSenha('');
      setConfirmar('');
      toast.sucesso('Senha alterada. Seus outros aparelhos foram desconectados.');
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Não foi possível alterar a senha.');
    } finally {
      setSalvandoSenha(false);
    }
  }

  if (!usuarioAtual) return null;

  return (
    <AppLayout titulo="Minha conta" subtitulo="Seus dados de acesso">
      <div className="mx-auto max-w-2xl space-y-6">
        <form onSubmit={salvarPerfil} className="rounded-xl border border-ink-700 bg-ink-800 p-6">
          <p className="font-display text-lg font-semibold text-ink-100">Seus dados</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <label className="block text-sm text-ink-300 sm:col-span-2">
              Nome
              <input required minLength={2} value={nome} onChange={(e) => setNome(e.target.value)} className={CAMPO} />
            </label>
            <label className="block text-sm text-ink-300">
              E-mail de acesso
              <input value={usuarioAtual.email} disabled className={`${CAMPO} cursor-not-allowed opacity-60`} />
            </label>
            <label className="block text-sm text-ink-300">
              Telefone
              <input
                inputMode="numeric"
                maxLength={15}
                placeholder="(00) 00000-0000"
                value={telefone}
                onChange={(e) => setTelefone(mascararTelefone(e.target.value))}
                className={CAMPO}
              />
            </label>
          </div>
          <p className="mt-3 text-xs text-ink-500">Perfil: {PAPEIS[usuarioAtual.papel]}. Para mudar o e-mail ou o perfil, fale com o responsável pela loja.</p>
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={salvandoPerfil} className="rounded-lg bg-tenant px-5 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:opacity-40">
              {salvandoPerfil ? 'Salvando…' : 'Salvar dados'}
            </button>
          </div>
        </form>

        <form onSubmit={salvarSenha} className="rounded-xl border border-ink-700 bg-ink-800 p-6">
          <p className="font-display text-lg font-semibold text-ink-100">Trocar senha</p>
          <p className="mt-1 text-sm text-ink-400">Ao trocar, os outros aparelhos em que você estava logado são desconectados.</p>
          <div className="mt-4 space-y-4">
            <label className="block text-sm text-ink-300">
              Senha atual
              <input type="password" required autoComplete="current-password" value={senhaAtual} onChange={(e) => setSenhaAtual(e.target.value)} className={CAMPO} />
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm text-ink-300">
                Nova senha
                <input
                  type="password"
                  required
                  minLength={8}
                  autoComplete="new-password"
                  placeholder="8+ caracteres, com letras e números"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  className={CAMPO}
                />
              </label>
              <label className="block text-sm text-ink-300">
                Confirmar nova senha
                <input type="password" required minLength={8} autoComplete="new-password" value={confirmar} onChange={(e) => setConfirmar(e.target.value)} className={CAMPO} />
              </label>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <button type="submit" disabled={salvandoSenha} className="rounded-lg bg-tenant px-5 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:opacity-40">
              {salvandoSenha ? 'Salvando…' : 'Trocar senha'}
            </button>
          </div>
        </form>
        <SessoesAtivas />
      </div>
    </AppLayout>
  );
}
