import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogoMark } from '@/components/Common/LogoMark';
import { ThemeToggle } from '@/components/Common/ThemeToggle';
import { LoadingState } from '@/components/Common/LoadingState';
import { useToast } from '@/contexts/ToastContext';
import { useConfirm } from '@/contexts/ConfirmContext';
import {
  ErroApi,
  adminDefinirEmpresaAtiva,
  adminDefinirLojaAtiva,
  adminDefinirPlano,
  adminDefinirUsuarioAtivo,
  adminExcluirEmpresa,
  adminExcluirLoja,
  admin2faStatus,
  adminListarEmpresas,
  adminResetarSenha,
  getAdminToken,
  limparTokenAdmin,
} from '@/services/apiService';
import type { EmpresaAdmin, LojaAdmin, PlanoSaaS } from '@/types';
import { AdminReceita } from './AdminReceita';
import { AdminResumo, emTrial } from './AdminResumo';
import { EmpresaItem, type AcoesEmpresa } from './EmpresaItem';
import { ModalExcluir, ModalSenhaGerada } from './AdminModais';
import { NovaEmpresaModal } from './NovaEmpresaModal';
import { SegurancaModal } from './SegurancaModal';

type Filtro = 'todas' | 'ativas' | 'suspensas' | 'trial';

const normalizar = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Painel interno da Total Software: gestão de todas as empresas, lojas e
 * logins do Total Control. Acesso só com login de admin da plataforma. */
export function AdminScreen() {
  const navigate = useNavigate();
  const toast = useToast();
  const confirmar = useConfirm();

  const [empresas, setEmpresas] = useState<EmpresaAdmin[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const [filtro, setFiltro] = useState<Filtro>('todas');
  const [plano, setPlano] = useState<PlanoSaaS | 'todos'>('todos');
  const [criando, setCriando] = useState(false);
  const [seguranca, setSeguranca] = useState(false);
  const [doisFatores, setDoisFatores] = useState<boolean | null>(null);
  const [excluirEmpresa, setExcluirEmpresa] = useState<EmpresaAdmin | null>(null);
  const [excluirLoja, setExcluirLoja] = useState<{ empresa: EmpresaAdmin; loja: LojaAdmin } | null>(null);
  const [senhaGerada, setSenhaGerada] = useState<{ nome: string; senha: string } | null>(null);

  const sair = useCallback(() => {
    limparTokenAdmin();
    navigate('/login', { replace: true });
  }, [navigate]);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      setEmpresas(await adminListarEmpresas());
    } catch (e) {
      // Token expirado/inválido: volta pro login em vez de mostrar erro.
      if (e instanceof ErroApi && (e.status === 401 || e.status === 403)) return sair();
      setErro(e instanceof Error ? e.message : 'Não foi possível carregar as empresas.');
    } finally {
      setCarregando(false);
    }
  }, [sair]);

  useEffect(() => {
    if (!getAdminToken()) return navigate('/login', { replace: true });
    carregar();
    admin2faStatus().then((r) => setDoisFatores(r.ativo)).catch(() => undefined);
  }, [carregar, navigate]);

  const visiveis = useMemo(() => {
    const termo = normalizar(busca.trim());
    return empresas.filter((e) => {
      if (filtro === 'ativas' && !e.ativo) return false;
      if (filtro === 'suspensas' && e.ativo) return false;
      if (filtro === 'trial' && !emTrial(e)) return false;
      if (plano !== 'todos' && e.planoAtual !== plano) return false;
      if (!termo) return true;
      const texto = [e.nome, ...e.lojas.flatMap((l) => [l.nomeFantasia, l.razaoSocial, l.cnpj, l.endereco.cidade, ...l.usuarios.flatMap((u) => [u.nome, u.email])])];
      return normalizar(texto.filter(Boolean).join(' ')).includes(termo);
    });
  }, [empresas, busca, filtro, plano]);

  /** Executa uma ação da API, mostra o resultado e recarrega a lista. */
  async function executar(acao: () => Promise<unknown>, sucesso: string) {
    try {
      await acao();
      toast.sucesso(sucesso);
      await carregar();
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Não foi possível concluir a ação.');
    }
  }

  const acoes: AcoesEmpresa = {
    onTrocarPlano: (empresa, novo) => executar(() => adminDefinirPlano(empresa.id, novo), `Plano alterado para ${novo}.`),
    onAlternarEmpresa: async (empresa) => {
      const suspender = empresa.ativo;
      const ok = await confirmar({
        titulo: suspender ? `Suspender "${empresa.nome}"?` : `Reativar "${empresa.nome}"?`,
        descricao: suspender
          ? 'Nenhum usuário de nenhuma loja dessa empresa vai conseguir entrar enquanto estiver suspensa.'
          : 'O acesso volta a funcionar normalmente.',
        textoConfirmar: suspender ? 'Suspender' : 'Reativar',
        perigoso: suspender,
      });
      if (ok) executar(() => adminDefinirEmpresaAtiva(empresa.id, !suspender), suspender ? 'Empresa suspensa.' : 'Empresa reativada.');
    },
    onExcluirEmpresa: setExcluirEmpresa,
    onAlternarLoja: async (loja) => {
      const desativar = loja.ativo;
      const ok = await confirmar({
        titulo: desativar ? `Desativar "${loja.nomeFantasia}"?` : `Reativar "${loja.nomeFantasia}"?`,
        descricao: desativar ? 'Ninguém consegue entrar nessa loja, mas nenhum dado é apagado.' : 'A loja volta a ficar disponível.',
        textoConfirmar: desativar ? 'Desativar' : 'Reativar',
        perigoso: desativar,
      });
      if (ok) executar(() => adminDefinirLojaAtiva(loja.id, !desativar), desativar ? 'Loja desativada.' : 'Loja reativada.');
    },
    onExcluirLoja: (empresa, loja) => setExcluirLoja({ empresa, loja }),
    onAlternarUsuario: (usuario) =>
      executar(() => adminDefinirUsuarioAtivo(usuario.id, !usuario.ativo), usuario.ativo ? 'Usuário desativado.' : 'Usuário ativado.'),
    onResetarSenha: async (usuario) => {
      const ok = await confirmar({ titulo: `Resetar a senha de ${usuario.nome}?`, descricao: 'Uma senha temporária será gerada e a atual deixa de funcionar.', textoConfirmar: 'Resetar' });
      if (!ok) return;
      try {
        setSenhaGerada({ nome: usuario.nome, senha: await adminResetarSenha(usuario.id) });
      } catch (e) {
        toast.erro(e instanceof Error ? e.message : 'Erro ao resetar a senha.');
      }
    },
  };

  const campo = 'rounded-lg border border-ink-600 bg-ink-700/60 px-3 py-2 text-sm text-ink-100 placeholder:text-ink-500 focus:border-tenant focus:outline-none focus:ring-2 focus:ring-tenant/15';

  return (
    <div className="min-h-screen bg-ink-900">
      <header className="sticky top-0 z-20 border-b border-ink-700 bg-ink-900/80 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-5 py-3.5">
          <div className="flex items-center gap-3">
            <LogoMark className="h-9 w-9 rounded-lg" />
            <div>
              <p className="font-display text-base font-semibold leading-tight text-ink-100">Total Control</p>
              <p className="text-xs text-ink-500">Painel da Total Software</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <ThemeToggle />
            <button onClick={() => setSeguranca(true)} className="text-sm text-ink-400 hover:text-ink-200">Segurança</button>
            <button onClick={sair} className="text-sm text-ink-400 hover:text-ink-200">Sair</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-5 py-8">
        {doisFatores === false && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-sm text-amber-300">Este painel dá acesso aos dados de todos os clientes. Proteja-o com a verificação em duas etapas.</p>
            <button onClick={() => setSeguranca(true)} className="rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-black hover:opacity-90">Ativar agora</button>
          </div>
        )}

        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-2xl font-bold tracking-tight text-ink-100">Empresas e lojas</h1>
            <p className="mt-1 text-sm text-ink-400">Gerencie planos, acessos e dados de todos os clientes do Total Control.</p>
          </div>
          <button onClick={() => setCriando(true)} className="rounded-lg bg-tenant px-4 py-2.5 text-sm font-semibold text-tenant-foreground hover:opacity-90">
            + Nova empresa
          </button>
        </div>

        {carregando ? (
          <LoadingState mensagem="Carregando empresas…" />
        ) : erro ? (
          <div className="rounded-xl border border-dashed border-ink-600 p-10 text-center text-sm text-ink-400">
            {erro}
            <div className="mt-4"><button onClick={() => { setCarregando(true); carregar(); }} className="rounded-lg border border-ink-600 px-4 py-2 text-ink-200 hover:border-ink-500">Tentar de novo</button></div>
          </div>
        ) : (
          <>
            <AdminReceita />
            <AdminResumo empresas={empresas} />

            <div className="flex flex-wrap gap-3">
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por empresa, CNPJ, cidade, nome ou e-mail…" className={`${campo} min-w-[240px] flex-1`} />
              <select value={filtro} onChange={(e) => setFiltro(e.target.value as Filtro)} className={campo} aria-label="Filtrar por situação">
                <option value="todas">Todas as situações</option>
                <option value="ativas">Ativas</option>
                <option value="suspensas">Suspensas</option>
                <option value="trial">Em teste grátis</option>
              </select>
              <select value={plano} onChange={(e) => setPlano(e.target.value as PlanoSaaS | 'todos')} className={campo} aria-label="Filtrar por plano">
                <option value="todos">Todos os planos</option>
                {(['FREE', 'STARTER', 'PRO', 'ENTERPRISE'] as const).map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>

            <div className="space-y-3">
              {visiveis.map((empresa) => (
                <EmpresaItem key={empresa.id} empresa={empresa} aberta={aberta === empresa.id} onAlternar={() => setAberta(aberta === empresa.id ? null : empresa.id)} acoes={acoes} />
              ))}
              {visiveis.length === 0 && (
                <p className="rounded-xl border border-dashed border-ink-600 p-10 text-center text-sm text-ink-400">
                  {empresas.length === 0 ? 'Nenhuma empresa cadastrada ainda.' : 'Nenhuma empresa encontrada com esses filtros.'}
                </p>
              )}
            </div>
          </>
        )}
      </main>

      {seguranca && <SegurancaModal onFechar={() => setSeguranca(false)} onMudou={setDoisFatores} />}
      {criando && <NovaEmpresaModal onFechar={() => setCriando(false)} onCriada={() => { setCriando(false); carregar(); }} />}

      {excluirEmpresa && (
        <ModalExcluir
          titulo={`Excluir "${excluirEmpresa.nome}"`}
          descricao="Apaga a empresa, todas as lojas, produtos, vendas, clientes, financeiro e todos os logins. Não dá pra desfazer."
          confirmacao={excluirEmpresa.nome}
          onCancelar={() => setExcluirEmpresa(null)}
          onConfirmar={async () => {
            try {
              await adminExcluirEmpresa(excluirEmpresa.id);
              toast.sucesso(`Empresa "${excluirEmpresa.nome}" excluída.`);
              setExcluirEmpresa(null);
              await carregar();
            } catch (e) {
              toast.erro(e instanceof Error ? e.message : 'Erro ao excluir a empresa.');
            }
          }}
        />
      )}

      {excluirLoja && (
        <ModalExcluir
          titulo={`Excluir a loja "${excluirLoja.loja.nomeFantasia}"`}
          descricao="Apaga a loja e tudo o que pertence a ela: produtos, vendas, clientes, financeiro, caixas e os logins criados nela. Não dá pra desfazer."
          confirmacao={excluirLoja.loja.cnpj}
          onCancelar={() => setExcluirLoja(null)}
          onConfirmar={async () => {
            try {
              await adminExcluirLoja(excluirLoja.loja.id);
              toast.sucesso(`Loja "${excluirLoja.loja.nomeFantasia}" excluída.`);
              setExcluirLoja(null);
              await carregar();
            } catch (e) {
              toast.erro(e instanceof Error ? e.message : 'Erro ao excluir a loja.');
            }
          }}
        />
      )}

      {senhaGerada && <ModalSenhaGerada usuarioNome={senhaGerada.nome} senha={senhaGerada.senha} onFechar={() => setSenhaGerada(null)} />}
    </div>
  );
}
