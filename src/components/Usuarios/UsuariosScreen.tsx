import { useEffect, useState, type FormEvent } from 'react';
import { AppLayout } from '@/components/Layout/AppLayout';
import { LoadingState } from '@/components/Common/LoadingState';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { ModalSenhaGerada } from '@/components/Admin/AdminModais';
import { useConfirm } from '@/contexts/ConfirmContext';
import { getUsuarios, createUsuario, resetarSenhaDeUsuario, setUsuarioAtivo, atualizarAcessoUsuario, concederAcessoLoja } from '@/services/apiService';
import { slugificarNomeLoja } from '@/utils/slug';
import { ACOES_DISPONIVEIS, ACOES_PADRAO_POR_PAPEL, mesmasAcoes } from '@/utils/acoes';
import { TELAS_COM_PERMISSAO, PERMISSOES_PADRAO_POR_PAPEL } from '@/utils/permissoes';
import { LIMITES_POR_PLANO } from '@/utils/planos';
import type { AcaoUsuario, PapelUsuario, TelaComPermissao, Usuario } from '@/types';

const rotulosPapel: Record<string, string> = {
  ADMIN: 'Admin',
  GERENTE: 'Gerente',
  OPERADOR_CAIXA: 'Operador de caixa',
};

interface PermissoesChecklistProps {
  papel: PapelUsuario;
  selecionadas: TelaComPermissao[];
  aoAlterar: (telas: TelaComPermissao[]) => void;
}

function PermissoesChecklist({ papel, selecionadas, aoAlterar }: PermissoesChecklistProps) {
  if (papel === 'ADMIN') {
    return <p className="text-xs text-ink-400">Admin sempre tem acesso a todas as telas.</p>;
  }

  function alternar(tela: TelaComPermissao) {
    if (tela === 'dashboard') return; // sempre concedido, garante uma tela de entrada
    const jaTem = selecionadas.includes(tela);
    aoAlterar(jaTem ? selecionadas.filter((t) => t !== tela) : [...selecionadas, tela]);
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {TELAS_COM_PERMISSAO.filter((tela) => tela.chave !== 'vendedores').map((tela) => (
        <label
          key={tela.chave}
          className={[
            'flex items-center gap-2 rounded-lg border px-3 py-2 text-xs',
            tela.chave === 'dashboard' ? 'cursor-not-allowed opacity-60' : 'cursor-pointer',
            selecionadas.includes(tela.chave) ? 'border-tenant bg-tenant-soft text-tenant' : 'border-ink-600 text-ink-300',
          ].join(' ')}
        >
          <input
            type="checkbox"
            checked={tela.chave === 'dashboard' || selecionadas.includes(tela.chave)}
            disabled={tela.chave === 'dashboard'}
            onChange={() => alternar(tela.chave)}
            className="accent-tenant"
          />
          {tela.rotulo}
        </label>
      ))}
      <p className="col-span-3 mt-1 text-xs text-ink-500">
        "Vendedores" não aparece aqui: só a conta principal da loja tem acesso a essa tela.
      </p>
    </div>
  );
}

function AcoesChecklist({ papel, selecionadas, aoAlterar }: { papel: PapelUsuario; selecionadas: AcaoUsuario[]; aoAlterar: (a: AcaoUsuario[]) => void }) {
  if (papel === 'ADMIN') return <p className="text-xs text-ink-400">Admin sempre pode todas as ações.</p>;
  const padrao = ACOES_PADRAO_POR_PAPEL[papel];
  return (
    <div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ACOES_DISPONIVEIS.map((a) => {
          const marcada = selecionadas.includes(a.chave);
          return (
            <label key={a.chave} title={a.dica} className={['flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-xs', marcada ? 'border-tenant bg-tenant-soft text-tenant' : 'border-ink-600 text-ink-300'].join(' ')}>
              <input
                type="checkbox"
                checked={marcada}
                onChange={() => aoAlterar(marcada ? selecionadas.filter((x) => x !== a.chave) : [...selecionadas, a.chave])}
                className="mt-0.5 accent-tenant"
              />
              <span>
                {a.rotulo}
                <span className="block text-[11px] font-normal text-ink-500">{a.dica}</span>
              </span>
            </label>
          );
        })}
      </div>
      {!mesmasAcoes(selecionadas, padrao) && (
        <button type="button" onClick={() => aoAlterar(padrao)} className="mt-2 text-xs font-medium text-tenant hover:underline">
          Voltar ao padrão do papel
        </button>
      )}
    </div>
  );
}

export function UsuariosScreen() {
  const { tenant, usuarioAtual, lojas } = useTenant();
  const toast = useToast();
  const confirmar = useConfirm();

  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [mostrarFormulario, setMostrarFormulario] = useState(false);
  const [usuarioEditando, setUsuarioEditando] = useState<Usuario | null>(null);
  const [papelEdicao, setPapelEdicao] = useState<PapelUsuario>('OPERADOR_CAIXA');
  const [permissoesEdicao, setPermissoesEdicao] = useState<TelaComPermissao[]>([]);
  const [salvandoPermissoes, setSalvandoPermissoes] = useState(false);
  const [usuarioParaAcesso, setUsuarioParaAcesso] = useState<Usuario | null>(null);
  const [concedendoAcesso, setConcedendoAcesso] = useState<string | null>(null);

  // Domínio do e-mail de login: sempre o nome da loja — não é editável, para
  // manter todos os logins da loja com o mesmo padrão.
  const dominio = tenant ? slugificarNomeLoja(tenant.nomeFantasia) : 'loja';

  const [nome, setNome] = useState('');
  const [emailLocal, setEmailLocal] = useState('');
  const [senha, setSenha] = useState('');
  const [papel, setPapel] = useState<PapelUsuario>('OPERADOR_CAIXA');
  const [permissoes, setPermissoes] = useState<TelaComPermissao[]>(PERMISSOES_PADRAO_POR_PAPEL.OPERADOR_CAIXA);
  const [acoesNovo, setAcoesNovo] = useState<AcaoUsuario[]>(ACOES_PADRAO_POR_PAPEL.OPERADOR_CAIXA);
  const [acoesEdicao, setAcoesEdicao] = useState<AcaoUsuario[]>([]);
  const [enviando, setEnviando] = useState(false);
  // Convite por e-mail (e-mail real, a pessoa cria a própria senha) x login da loja (você define a senha).
  const [modoConvite, setModoConvite] = useState(false);
  const [emailConvite, setEmailConvite] = useState('');
  const [senhaGerada, setSenhaGerada] = useState<{ nome: string; senha: string } | null>(null);

  async function carregarUsuarios() {
    setCarregando(true);
    setUsuarios(await getUsuarios());
    setCarregando(false);
  }

  useEffect(() => {
    carregarUsuarios();
  }, []);

  function handleMudarPapel(novoPapel: PapelUsuario) {
    setPapel(novoPapel);
    setAcoesNovo(ACOES_PADRAO_POR_PAPEL[novoPapel]);
    setPermissoes(PERMISSOES_PADRAO_POR_PAPEL[novoPapel] ?? ['dashboard']);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!nome.trim()) return;
    if (modoConvite ? !emailConvite.trim() : !emailLocal.trim() || !senha) return;
    setEnviando(true);
    try {
      if (modoConvite) {
        const email = emailConvite.trim().toLowerCase();
        await createUsuario({ nome: nome.trim(), email, convidarPorEmail: true, papel, permissoes, acoes: mesmasAcoes(acoesNovo, ACOES_PADRAO_POR_PAPEL[papel]) ? undefined : acoesNovo });
        toast.sucesso(`Convite enviado para ${email}.`);
      } else {
        const email = `${emailLocal.trim()}@${dominio}.com`;
        await createUsuario({ nome: nome.trim(), email, senha, papel, permissoes, acoes: mesmasAcoes(acoesNovo, ACOES_PADRAO_POR_PAPEL[papel]) ? undefined : acoesNovo });
        toast.sucesso(`Login "${email}" criado.`);
      }
      setNome('');
      setEmailLocal('');
      setEmailConvite('');
      setSenha('');
      handleMudarPapel('OPERADOR_CAIXA');
      setMostrarFormulario(false);
      await carregarUsuarios();
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao criar login.');
    } finally {
      setEnviando(false);
    }
  }

  async function handleResetarSenha(usuario: Usuario) {
    const ok = await confirmar({
      titulo: `Redefinir a senha de ${usuario.nome}?`,
      descricao: 'Uma senha temporária é gerada e a senha atual deixa de funcionar. Repasse a nova senha com segurança: ela aparece uma única vez.',
      textoConfirmar: 'Redefinir',
    });
    if (!ok) return;
    try {
      setSenhaGerada({ nome: usuario.nome, senha: await resetarSenhaDeUsuario(usuario.id) });
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao redefinir a senha.');
    }
  }

  async function handleToggleAtivo(usuario: Usuario) {
    if (usuario.id === usuarioAtual?.id) {
      toast.erro('Você não pode desativar seu próprio login.');
      return;
    }
    if (usuario.raiz && usuario.ativo) {
      toast.erro('A conta principal da loja não pode ser desativada.');
      return;
    }
    const confirmou = await confirmar({
      titulo: usuario.ativo ? `Desativar login de "${usuario.nome}"?` : `Reativar login de "${usuario.nome}"?`,
      descricao: usuario.ativo ? 'A pessoa não vai mais conseguir entrar no sistema.' : undefined,
      textoConfirmar: usuario.ativo ? 'Desativar' : 'Ativar',
      perigoso: usuario.ativo,
    });
    if (!confirmou) return;

    try {
      await setUsuarioAtivo(usuario.id, !usuario.ativo);
      await carregarUsuarios();
      toast.sucesso(usuario.ativo ? 'Login desativado.' : 'Login reativado.');
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao atualizar login.');
    }
  }

  async function handleConcederAcesso(tenantId: string) {
    if (!usuarioParaAcesso) return;
    setConcedendoAcesso(tenantId);
    try {
      await concederAcessoLoja(tenantId, usuarioParaAcesso.id);
      const loja = lojas.find((l) => l.id === tenantId);
      toast.sucesso(`${usuarioParaAcesso.nome} agora acessa "${loja?.nomeFantasia ?? 'a loja'}".`);
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao conceder acesso.');
    } finally {
      setConcedendoAcesso(null);
    }
  }

  function abrirEdicaoPermissoes(usuario: Usuario) {
    setUsuarioEditando(usuario);
    setPapelEdicao(usuario.papel);
    setPermissoesEdicao(usuario.permissoes ?? PERMISSOES_PADRAO_POR_PAPEL[usuario.papel] ?? ['dashboard']);
    setAcoesEdicao(usuario.acoesEfetivas ?? ACOES_PADRAO_POR_PAPEL[usuario.papel]);
  }

  function handleMudarPapelEdicao(novoPapel: PapelUsuario) {
    setPapelEdicao(novoPapel);
    setPermissoesEdicao(PERMISSOES_PADRAO_POR_PAPEL[novoPapel] ?? ['dashboard']);
    setAcoesEdicao(ACOES_PADRAO_POR_PAPEL[novoPapel]);
  }

  async function salvarPermissoesEdicao() {
    if (!usuarioEditando) return;
    setSalvandoPermissoes(true);
    try {
      await atualizarAcessoUsuario(usuarioEditando.id, {
        papel: papelEdicao !== usuarioEditando.papel ? papelEdicao : undefined,
        permissoes: papelEdicao === 'ADMIN' ? undefined : permissoesEdicao,
        // Igual ao padrão do papel = sem personalização (null); senão, a lista exata.
        acoes: papelEdicao === 'ADMIN' ? undefined : mesmasAcoes(acoesEdicao, ACOES_PADRAO_POR_PAPEL[papelEdicao]) ? null : acoesEdicao,
      });
      toast.sucesso(`Acesso de "${usuarioEditando.nome}" atualizado.`);
      setUsuarioEditando(null);
      await carregarUsuarios();
    } catch (err) {
      toast.erro(err instanceof Error ? err.message : 'Erro ao salvar permissões.');
    } finally {
      setSalvandoPermissoes(false);
    }
  }

  if (usuarioAtual && usuarioAtual.papel !== 'ADMIN') {
    return (
      <AppLayout titulo="Usuários" subtitulo="Logins da sua loja">
        <div className="rounded-xl border border-dashed border-ink-700 p-10 text-center">
          <p className="text-sm text-ink-400">Só administradores podem gerenciar os logins da loja.</p>
        </div>
      </AppLayout>
    );
  }

  const maxUsuarios = tenant ? LIMITES_POR_PLANO[tenant.planoAtual].maxUsuarios : null;
  const limiteAtingido = maxUsuarios !== null && usuarios.length >= maxUsuarios;

  return (
    <AppLayout titulo="Usuários" subtitulo="Crie e gerencie os logins da sua loja, e o que cada um pode ver">
      <div className="mb-4 flex items-center justify-end gap-3">
        {maxUsuarios !== null && (
          <p className="text-xs text-ink-500">
            {usuarios.length}/{maxUsuarios} usuário(s) do plano {tenant?.planoAtual}
          </p>
        )}
        <button
          onClick={() => setMostrarFormulario((atual) => !atual)}
          disabled={!mostrarFormulario && limiteAtingido}
          title={limiteAtingido ? `Limite de usuários do plano ${tenant?.planoAtual} atingido.` : undefined}
          className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {mostrarFormulario ? 'Cancelar' : '+ Novo login'}
        </button>
      </div>

      {mostrarFormulario && (
        <form onSubmit={handleSubmit} className="mb-6 grid grid-cols-2 gap-4 rounded-xl border border-ink-700 bg-ink-800 p-6">
          <label className="block text-sm text-ink-300">
            Nome
            <input
              required
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            />
          </label>

          <label className="block text-sm text-ink-300">
            Papel
            <select
              value={papel}
              onChange={(e) => handleMudarPapel(e.target.value as PapelUsuario)}
              className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
            >
              <option value="OPERADOR_CAIXA">Operador de caixa</option>
              <option value="GERENTE">Gerente</option>
              <option value="ADMIN">Admin</option>
            </select>
          </label>

          <div className="col-span-2">
            <p className="mb-1.5 text-sm text-ink-300">Como a pessoa vai entrar</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { valor: false, titulo: 'Login da loja', texto: 'Você define o login e a senha.' },
                { valor: true, titulo: 'Convite por e-mail', texto: 'A pessoa cria a própria senha.' },
              ].map((o) => (
                <button
                  key={String(o.valor)}
                  type="button"
                  onClick={() => setModoConvite(o.valor)}
                  className={['rounded-lg border px-3 py-2.5 text-left transition-colors', modoConvite === o.valor ? 'border-tenant bg-tenant-soft' : 'border-ink-600 hover:border-ink-500'].join(' ')}
                >
                  <p className={['text-sm font-medium', modoConvite === o.valor ? 'text-tenant' : 'text-ink-100'].join(' ')}>{o.titulo}</p>
                  <p className="text-xs text-ink-400">{o.texto}</p>
                </button>
              ))}
            </div>
          </div>

          {modoConvite ? (
            <label className="col-span-2 block text-sm text-ink-300">
              E-mail da pessoa
              <input
                type="email"
                required
                value={emailConvite}
                onChange={(e) => setEmailConvite(e.target.value)}
                placeholder="nome@exemplo.com"
                className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
              />
              <span className="mt-1 block text-xs text-ink-500">Precisa ser um e-mail real: ela recebe um link para criar a senha (vale por 3 dias).</span>
            </label>
          ) : (
            <>
          <div className="col-span-2 text-sm text-ink-300">
                <label className="mb-1 block">E-mail de login</label>
                <div className="flex items-center gap-1.5">
                  <input
                    required
                    value={emailLocal}
                    onChange={(e) => setEmailLocal(e.target.value)}
                    placeholder="ex: caixa1"
                    className="w-40 rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 placeholder:text-ink-400 focus:border-tenant focus:outline-none"
                  />
                  <span className="text-ink-400">@</span>
                  <span className="rounded-lg border border-ink-700 bg-ink-800 px-3 py-2 text-ink-400">
                    {dominio}
                    <span className="text-ink-600">.com</span>
                  </span>
                </div>
                <p className="mt-1 text-xs text-ink-500">
                  O domínio é fixo, sempre o nome da sua loja: é só um identificador de login, não é um e-mail real.
                </p>
              </div>

              <label className="block text-sm text-ink-300">
                Senha
                <input
                  type="password"
                  required
                  minLength={8} placeholder="8+ caracteres, com letras e números"
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
                />
              </label>

            </>
          )}

          <div className="col-span-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">O que essa pessoa vai ver</p>
            <PermissoesChecklist papel={papel} selecionadas={permissoes} aoAlterar={setPermissoes} />
          </div>

          <div className="col-span-2">
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">O que essa pessoa pode fazer</p>
            <AcoesChecklist papel={papel} selecionadas={acoesNovo} aoAlterar={setAcoesNovo} />
          </div>

          <div className="col-span-2 flex justify-end">
            <button
              type="submit"
              disabled={enviando}
              className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {enviando ? 'Criando…' : 'Criar login'}
            </button>
          </div>
        </form>
      )}

      {carregando ? (
        <LoadingState mensagem="Carregando usuários…" />
      ) : (
        <div className="overflow-hidden rounded-xl border border-ink-700">
          <table className="w-full text-left text-sm">
            <thead className="bg-ink-800 text-xs uppercase tracking-wide text-ink-400">
              <tr>
                <th className="px-5 py-3 font-medium">Nome</th>
                <th className="px-5 py-3 font-medium">E-mail</th>
                <th className="px-5 py-3 font-medium">Papel</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Ação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-700 bg-ink-800/40">
              {usuarios.map((usuario) => (
                <tr key={usuario.id} className="transition-colors hover:bg-ink-800">
                  <td className="px-5 py-3.5 font-medium text-ink-100">
                    {usuario.nome}
                    {usuario.id === usuarioAtual?.id && <span className="ml-2 text-xs text-ink-500">(você)</span>}
                    {usuario.raiz && (
                      <span className="ml-2 rounded-full bg-tenant-soft px-2 py-0.5 text-[10px] font-medium text-tenant">
                        conta principal
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 font-mono text-xs text-ink-400">{usuario.email}</td>
                  <td className="px-5 py-3.5 text-ink-300">{rotulosPapel[usuario.papel] ?? usuario.papel}</td>
                  <td className="px-5 py-3.5">
                    <span
                      className={[
                        'rounded-full px-2.5 py-1 text-xs font-medium',
                        usuario.ativo ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400',
                      ].join(' ')}
                    >
                      {usuario.ativo ? 'Ativo' : 'Desativado'}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <div className="flex justify-end gap-2">
                      <button
                        onClick={() => abrirEdicaoPermissoes(usuario)}
                        className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant"
                      >
                        Acesso
                      </button>
                      {usuarioAtual?.raiz && lojas.length > 1 && (
                        <button
                          onClick={() => setUsuarioParaAcesso(usuario)}
                          className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant"
                        >
                          Lojas
                        </button>
                      )}
                      {usuario.id !== usuarioAtual?.id && !usuario.raiz && (usuario.papel !== 'ADMIN' || usuarioAtual?.raiz) && (
                        <button
                          onClick={() => handleResetarSenha(usuario)}
                          className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant"
                        >
                          Redefinir senha
                        </button>
                      )}
                      <button
                        onClick={() => handleToggleAtivo(usuario)}
                        disabled={usuario.id === usuarioAtual?.id || (usuario.raiz && usuario.ativo)}
                        title={usuario.raiz && usuario.ativo ? 'A conta principal não pode ser desativada.' : undefined}
                        className="rounded-lg border border-ink-600 px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-tenant hover:text-tenant disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {usuario.ativo ? 'Desativar' : 'Ativar'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {senhaGerada && <ModalSenhaGerada usuarioNome={senhaGerada.nome} senha={senhaGerada.senha} onFechar={() => setSenhaGerada(null)} />}

      {usuarioEditando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true">
          <div className="max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-xl border border-ink-700 bg-ink-800 p-6">
            <p className="font-display text-lg font-semibold text-ink-100">Acesso de {usuarioEditando.nome}</p>
            <p className="mt-1 text-sm text-ink-400">O que essa pessoa pode ver no sistema.</p>

            {usuarioAtual?.raiz && !usuarioEditando.raiz && usuarioEditando.id !== usuarioAtual?.id ? (
              <label className="mt-4 block text-sm text-ink-300">
                Papel
                <select
                  value={papelEdicao}
                  onChange={(e) => handleMudarPapelEdicao(e.target.value as PapelUsuario)}
                  className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-700 px-3 py-2 text-ink-100 focus:border-tenant focus:outline-none"
                >
                  <option value="OPERADOR_CAIXA">Operador de caixa</option>
                  <option value="GERENTE">Gerente</option>
                  <option value="ADMIN">Admin</option>
                </select>
              </label>
            ) : (
              <p className="mt-4 text-sm text-ink-300">
                Papel: <span className="text-ink-100">{rotulosPapel[usuarioEditando.papel] ?? usuarioEditando.papel}</span>
                {usuarioEditando.raiz && <span className="ml-1 text-xs text-ink-500">(conta principal, fixo)</span>}
              </p>
            )}

            <div className="mt-4">
              <PermissoesChecklist papel={papelEdicao} selecionadas={permissoesEdicao} aoAlterar={setPermissoesEdicao} />
            </div>

            <div className="mt-5">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-ink-400">O que essa pessoa pode fazer</p>
              <AcoesChecklist papel={papelEdicao} selecionadas={acoesEdicao} aoAlterar={setAcoesEdicao} />
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => setUsuarioEditando(null)}
                className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100"
              >
                Cancelar
              </button>
              <button
                onClick={salvarPermissoesEdicao}
                disabled={salvandoPermissoes}
                className="rounded-lg bg-tenant px-4 py-2 text-sm font-semibold text-tenant-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {salvandoPermissoes ? 'Salvando…' : 'Salvar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {usuarioParaAcesso && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-sm rounded-xl border border-ink-700 bg-ink-800 p-6">
            <p className="font-display text-lg font-semibold text-ink-100">Lojas de {usuarioParaAcesso.nome}</p>
            <p className="mt-1 text-sm text-ink-400">
              Conceda acesso a outra loja da sua empresa: a pessoa passa a poder trocar pra ela com o mesmo login.
            </p>

            <div className="mt-4 space-y-2">
              {lojas
                .filter((l) => l.id !== tenant?.id)
                .map((loja) => (
                  <button
                    key={loja.id}
                    onClick={() => handleConcederAcesso(loja.id)}
                    disabled={concedendoAcesso === loja.id}
                    className="flex w-full items-center justify-between rounded-lg border border-ink-600 px-3 py-2.5 text-sm text-ink-200 hover:border-tenant hover:text-tenant disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {loja.nomeFantasia}
                    <span className="text-xs text-ink-500">
                      {concedendoAcesso === loja.id ? 'Concedendo…' : 'Conceder acesso'}
                    </span>
                  </button>
                ))}
            </div>

            <div className="mt-6 flex justify-end">
              <button
                onClick={() => setUsuarioParaAcesso(null)}
                className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </AppLayout>
  );
}
