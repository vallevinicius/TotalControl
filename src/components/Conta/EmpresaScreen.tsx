import { useState, type FormEvent, type ReactNode } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { AppLayout } from '@/components/Layout/AppLayout';
import { ModalFundo } from '@/components/Admin/AdminModais';
import { LojaFormModal } from '@/components/Lojas/LojaFormModal';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { definirAvisosPorEmail, editarDadosDaEmpresa, excluirContaDaEmpresa, exportarDadosDaEmpresa, logout } from '@/services/apiService';
import { AuthCheckbox } from '@/components/Auth/AuthCheckbox';
import type { LojaGestao, Tenant } from '@/types';

function Dado({ rotulo, valor }: { rotulo: string; valor?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-ink-500">{rotulo}</p>
      <p className="mt-0.5 break-words text-sm text-ink-100">{valor || '-'}</p>
    </div>
  );
}

function Cartao({ titulo, acao, children }: { titulo: string; acao?: ReactNode; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-ink-700 bg-ink-800 p-6">
      <div className="flex items-start justify-between gap-3">
        <p className="font-display text-lg font-semibold text-ink-100">{titulo}</p>
        {acao}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** O formulário de loja espera uma LojaGestao; aqui ela vem do que a sessão já sabe da empresa. */
function lojaDoTenant(t: Tenant): LojaGestao {
  return {
    id: t.id,
    nomeFantasia: t.nomeFantasia,
    razaoSocial: t.razaoSocial,
    cnpj: t.cnpj,
    telefone: t.telefone,
    email: t.email,
    site: t.site,
    inscricaoEstadual: t.inscricaoEstadual,
    inscricaoMunicipal: t.inscricaoMunicipal,
    regimeTributario: t.regimeTributario,
    endereco: t.endereco ?? {},
    logoDaLojaUrl: t.configuracoes.logoDaLojaUrl,
    corPrincipalDoTema: t.configuracoes.corPrincipalDoTema,
    fusoHorario: t.configuracoes.fusoHorario,
    exigirSenhaAoAbrirCaixa: Boolean(t.configuracoes.exigirSenhaAoAbrirCaixa),
    ativo: true,
    criadoEm: t.criadoEm,
    atual: true,
    indicadores: { usuarios: 0, produtos: 0, vendasDoMes: 0, faturamentoDoMes: 0 },
  };
}

/** Dados cadastrais da empresa e direitos do titular (LGPD): exportar e excluir tudo. */
export function EmpresaScreen() {
  const { tenant, usuarioAtual, recarregarSessao } = useTenant();
  const toast = useToast();
  const navigate = useNavigate();
  const [editando, setEditando] = useState(false);
  const [exportando, setExportando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);

  if (tenant && usuarioAtual && !usuarioAtual.raiz) return <Navigate to="/" replace />;
  if (!tenant) return null;

  const e = tenant.endereco;
  const endereco = [[e?.logradouro, e?.numero].filter(Boolean).join(', '), e?.complemento, e?.bairro, [e?.cidade, e?.uf].filter(Boolean).join(' / '), e?.cep]
    .filter(Boolean)
    .join(' · ');

  async function exportar() {
    setExportando(true);
    try {
      const conteudo = await exportarDadosDaEmpresa();
      const url = URL.createObjectURL(new Blob([conteudo], { type: 'application/json' }));
      const link = Object.assign(document.createElement('a'), { href: url, download: `total-control-dados-${new Date().toISOString().slice(0, 10)}.json` });
      link.click();
      URL.revokeObjectURL(url);
      toast.sucesso('Arquivo gerado. Guarde-o em local seguro: ele contém dados pessoais.');
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Não foi possível exportar.');
    } finally {
      setExportando(false);
    }
  }

  return (
    <AppLayout titulo="Empresa" subtitulo="Dados cadastrais e privacidade">
      <div className="mx-auto max-w-3xl space-y-6">
        <Cartao
          titulo="Dados da empresa"
          acao={
            <button onClick={() => setEditando(true)} className="rounded-lg border border-ink-600 px-3 py-1.5 text-sm font-medium text-ink-200 hover:border-tenant hover:text-tenant">
              Editar
            </button>
          }
        >
          <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3">
            <Dado rotulo="Nome fantasia" valor={tenant.nomeFantasia} />
            <Dado rotulo="Razão social" valor={tenant.razaoSocial} />
            <Dado rotulo="CNPJ" valor={tenant.cnpj} />
            <Dado rotulo="Inscrição estadual" valor={tenant.inscricaoEstadual} />
            <Dado rotulo="Inscrição municipal" valor={tenant.inscricaoMunicipal} />
            <Dado rotulo="Tipo / regime" valor={tenant.regimeTributario} />
            <Dado rotulo="Telefone" valor={tenant.telefone} />
            <Dado rotulo="E-mail" valor={tenant.email} />
            <Dado rotulo="Site" valor={tenant.site} />
            <div className="col-span-2 sm:col-span-3">
              <Dado rotulo="Endereço" valor={endereco} />
            </div>
          </div>
        </Cartao>

        <Cartao titulo="Avisos por e-mail">
          <p className="mb-3 text-sm text-ink-400">
            A conta principal recebe um e-mail quando o teste grátis está acabando, quando um pagamento é recusado, quando há produtos com estoque baixo (resumo semanal) e quando há contas atrasadas ou vencendo.
          </p>
          <AuthCheckbox
            checked={tenant.avisosEmail !== false}
            onChange={async (ev) => {
              try {
                await definirAvisosPorEmail(ev.target.checked);
                await recarregarSessao();
                toast.sucesso(ev.target.checked ? 'Avisos por e-mail ligados.' : 'Avisos por e-mail desligados.');
              } catch (erro) {
                toast.erro(erro instanceof Error ? erro.message : 'Não foi possível salvar.');
              }
            }}
          >
            Receber avisos por e-mail
          </AuthCheckbox>
        </Cartao>

        <Cartao titulo="Seus dados e a LGPD">
          <p className="text-sm text-ink-400">
            Você pode levar uma cópia de tudo o que a empresa guarda no sistema ou pedir a exclusão definitiva da conta, a qualquer momento.
          </p>
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink-700 p-4">
            <div>
              <p className="text-sm font-medium text-ink-100">Exportar meus dados</p>
              <p className="text-xs text-ink-500">Um arquivo com lojas, produtos, clientes, vendas, financeiro e usuários (sem senhas).</p>
            </div>
            <button onClick={exportar} disabled={exportando} className="rounded-lg border border-ink-600 px-4 py-2 text-sm font-medium text-ink-200 hover:border-tenant hover:text-tenant disabled:opacity-40">
              {exportando ? 'Gerando…' : 'Baixar arquivo'}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-red-500/30 p-4">
            <div>
              <p className="text-sm font-medium text-red-400">Excluir a conta</p>
              <p className="text-xs text-ink-500">Apaga a empresa, todas as lojas e todos os dados. Cancela a assinatura. Não tem volta.</p>
            </div>
            <button onClick={() => setExcluindo(true)} className="rounded-lg border border-red-500/40 px-4 py-2 text-sm font-medium text-red-400 hover:bg-red-500/10">
              Excluir conta
            </button>
          </div>
        </Cartao>
      </div>

      {editando && (
        <LojaFormModal
          loja={lojaDoTenant(tenant)}
          salvarEdicao={editarDadosDaEmpresa}
          onFechar={() => setEditando(false)}
          onSalva={async () => {
            setEditando(false);
            await recarregarSessao();
          }}
        />
      )}

      {excluindo && (
        <ExcluirContaModal
          cnpj={tenant.cnpj}
          nome={tenant.nomeFantasia}
          onFechar={() => setExcluindo(false)}
          onExcluida={() => {
            logout();
            navigate('/', { replace: true });
            window.location.reload();
          }}
        />
      )}
    </AppLayout>
  );
}

function ExcluirContaModal({ cnpj, nome, onFechar, onExcluida }: { cnpj: string; nome: string; onFechar: () => void; onExcluida: () => void }) {
  const toast = useToast();
  const [cnpjDigitado, setCnpjDigitado] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const confere = cnpjDigitado.replace(/\D/g, '') === cnpj.replace(/\D/g, '');
  const campo = 'mt-1.5 w-full rounded-lg border border-ink-600 bg-ink-700/60 px-3 py-2.5 text-sm text-ink-100 focus:border-red-500 focus:outline-none focus:ring-2 focus:ring-red-500/20';

  async function enviar(ev: FormEvent) {
    ev.preventDefault();
    if (!confere || !senha) return;
    setEnviando(true);
    try {
      await excluirContaDaEmpresa({ senha, cnpj: cnpjDigitado });
      toast.sucesso('Conta excluída. Enviamos a confirmação por e-mail.');
      onExcluida();
    } catch (erro) {
      toast.erro(erro instanceof Error ? erro.message : 'Não foi possível excluir a conta.');
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalFundo onFechar={onFechar}>
      <form onSubmit={enviar} className="w-full max-w-md rounded-xl border border-ink-700 bg-ink-800 p-6">
        <p className="font-display text-lg font-semibold text-ink-100">Excluir a conta de "{nome}"</p>
        <p className="mt-2 text-sm text-ink-400">
          Todas as lojas, produtos, vendas, clientes, lançamentos financeiros e usuários serão apagados, e a assinatura será cancelada.{' '}
          <span className="font-medium text-red-400">Não dá para desfazer.</span> Baixe uma cópia dos seus dados antes, se precisar.
        </p>
        <label className="mt-4 block text-sm text-ink-300">
          Digite o CNPJ da loja principal (<span className="font-mono text-ink-100">{cnpj}</span>)
          <input autoFocus inputMode="numeric" value={cnpjDigitado} onChange={(ev) => setCnpjDigitado(ev.target.value)} className={campo} />
        </label>
        <label className="mt-3 block text-sm text-ink-300">
          Sua senha
          <input type="password" autoComplete="current-password" value={senha} onChange={(ev) => setSenha(ev.target.value)} className={campo} />
        </label>
        <div className="mt-6 flex justify-end gap-3">
          <button type="button" onClick={onFechar} className="rounded-lg px-4 py-2 text-sm text-ink-300 hover:text-ink-100">
            Cancelar
          </button>
          <button type="submit" disabled={enviando || !confere || !senha} className="rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">
            {enviando ? 'Excluindo…' : 'Excluir tudo para sempre'}
          </button>
        </div>
      </form>
    </ModalFundo>
  );
}
