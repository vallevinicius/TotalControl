import { useState, type ComponentType, type SVGProps } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { useTenant } from '@/contexts/TenantContext';
import { useToast } from '@/contexts/ToastContext';
import { TELAS_COM_PERMISSAO, podeVerTela } from '@/utils/permissoes';
import { diasRestantesTrial, planoPermiteMultiLoja, planoPermiteTela } from '@/utils/planos';
import type { TelaComPermissao } from '@/types';
import {
  IconeAuditoria,
  IconeCadeado,
  IconeCaixa,
  IconeConta,
  IconeClientes,
  IconeDashboard,
  IconeEstoque,
  IconeFinanceiro,
  IconeLojas,
  IconePlano,
  IconeRelatorios,
  IconeSeta,
  IconeUsuarios,
  IconeVendedores,
} from './iconesMenu';

type Icone = ComponentType<SVGProps<SVGSVGElement>>;

interface ItemLink {
  rota: string;
  rotulo: string;
  icone?: Icone;
  /** Só marca como ativo quando a rota bate exatamente (ex: "/" e "/financeiro"). */
  exato?: boolean;
  /** Tela que precisa de permissão do usuário e de um plano que a inclua. */
  tela?: TelaComPermissao;
  /** Recurso do plano exigido (ex: 'multiLoja'); sem ele o item aparece com cadeado. */
  planoRecurso?: 'multiLoja';
}

interface ItemGrupo {
  chave: string;
  rotulo: string;
  icone: Icone;
  tela: TelaComPermissao;
  filhos: ItemLink[];
}

interface Secao {
  rotulo: string;
  itens: Array<ItemLink | ItemGrupo>;
  /** Restringe a seção inteira (ex: só ADMIN vê "Conta"). */
  visivel?: boolean;
}

const ehGrupo = (item: ItemLink | ItemGrupo): item is ItemGrupo => 'filhos' in item;

interface SidebarProps {
  aberta: boolean;
  aoFechar: () => void;
}

export function Sidebar({ aberta, aoFechar }: SidebarProps) {
  const { tenant, usuarioAtual, lojas, trocarLoja } = useTenant();
  const toast = useToast();

  const plano = tenant?.planoAtual;
  const { pathname } = useLocation();
  const [gruposAbertos, setGruposAbertos] = useState<Record<string, boolean>>({});

  const contaAdmin = usuarioAtual?.papel === 'ADMIN';
  const secoes: Secao[] = [
    { rotulo: 'Geral', itens: [{ rota: '/', rotulo: 'Dashboard', icone: IconeDashboard, exato: true, tela: 'dashboard' }] },
    {
      rotulo: 'Operação',
      itens: [
        { rota: '/pdv', rotulo: 'Caixa', icone: IconeCaixa, tela: 'pdv' },
        { rota: '/estoque', rotulo: 'Estoque', icone: IconeEstoque, tela: 'estoque' },
        { rota: '/clientes', rotulo: 'Clientes', icone: IconeClientes, tela: 'clientes' },
        { rota: '/vendedores', rotulo: 'Vendedores', icone: IconeVendedores, tela: 'vendedores' },
      ],
    },
    {
      rotulo: 'Gestão',
      itens: [
        {
          chave: 'financeiro',
          rotulo: 'Financeiro',
          icone: IconeFinanceiro,
          tela: 'financeiro',
          filhos: [
            { rota: '/financeiro', rotulo: 'Visão geral', exato: true },
            { rota: '/financeiro/lancamentos', rotulo: 'Lançamentos' },
          ],
        },
        { rota: '/relatorios', rotulo: 'Relatórios', icone: IconeRelatorios, tela: 'relatorios' },
        ...(usuarioAtual?.raiz ? [{ rota: '/lojas', rotulo: 'Lojas', icone: IconeLojas, planoRecurso: 'multiLoja' as const }] : []),
      ],
    },
    {
      rotulo: 'Conta',
      itens: [
        { rota: '/conta', rotulo: 'Minha conta', icone: IconeConta },
        ...(contaAdmin
          ? [
              { rota: '/usuarios', rotulo: 'Usuários', icone: IconeUsuarios },
              { rota: '/plano', rotulo: 'Meu plano', icone: IconePlano },
            ]
          : []),
        ...(usuarioAtual?.raiz ? [{ rota: '/auditoria', rotulo: 'Auditoria', icone: IconeAuditoria }] : []),
      ],
    },
  ];

  // Some o que o usuário não pode ver; seções que ficam vazias também somem.
  const secoesVisiveis = secoes
    .filter((secao) => secao.visivel !== false)
    .map((secao) => ({
      ...secao,
      itens: secao.itens.filter((item) => !item.tela || podeVerTela(usuarioAtual, item.tela)),
    }))
    .filter((secao) => secao.itens.length > 0);

  const bloqueadoPeloPlano = (tela?: TelaComPermissao, recurso?: 'multiLoja') =>
    Boolean((tela && plano && !planoPermiteTela(plano, tela)) || (recurso === 'multiLoja' && plano && !planoPermiteMultiLoja(plano)));

  const diasTrial = diasRestantesTrial(tenant?.trialExpiraEm);

  async function handleTrocarLoja(tenantId: string) {
    if (tenantId === tenant?.id) return;
    try {
      await trocarLoja(tenantId);
    } catch (e) {
      toast.erro(e instanceof Error ? e.message : 'Erro ao trocar de loja.');
    }
  }

  return (
    <>
      {aberta && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={aoFechar} aria-hidden />
      )}
      <aside
        className={[
          'fixed inset-y-0 left-0 z-40 flex h-full w-64 flex-col border-r border-ink-700 bg-ink-800 transition-transform duration-200',
          aberta ? 'translate-x-0' : '-translate-x-full',
          'md:static md:translate-x-0',
        ].join(' ')}
      >
        <div className="flex items-center justify-between border-b border-ink-700 px-5 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-ink-500">Total Control</p>
          <button onClick={aoFechar} aria-label="Fechar menu" className="text-ink-400 hover:text-ink-100 md:hidden">
            ✕
          </button>
        </div>

        <div className="flex items-center gap-3 border-b border-ink-700 px-5 py-5">
          {tenant?.configuracoes.logoDaLojaUrl ? (
            <img
              src={tenant.configuracoes.logoDaLojaUrl}
              alt={`Logo de ${tenant.nomeFantasia}`}
              className="h-9 w-9 rounded-lg object-cover ring-1 ring-ink-600"
            />
          ) : (
            <div className="h-9 w-9 rounded-lg bg-tenant" />
          )}
          <div className="min-w-0 flex-1">
            {lojas.length > 1 ? (
              <select
                value={tenant?.id ?? ''}
                onChange={(e) => handleTrocarLoja(e.target.value)}
                className="w-full truncate rounded-md border border-ink-700 bg-ink-800 font-display text-sm font-semibold text-ink-100 focus:border-tenant focus:outline-none"
              >
                {lojas.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.nomeFantasia}
                  </option>
                ))}
              </select>
            ) : (
              <p className="truncate font-display text-sm font-semibold text-ink-100">
                {tenant?.nomeFantasia ?? 'Carregando…'}
              </p>
            )}
            <p className="truncate text-xs text-ink-400">Plano {tenant?.planoAtual ?? '|'}</p>
            {diasTrial !== null && (
              <p className={['truncate text-xs', diasTrial <= 3 ? 'text-amber-400' : 'text-ink-500'].join(' ')}>
                Teste grátis: {diasTrial > 0 ? `faltam ${diasTrial} dia(s)` : 'expirado'}
              </p>
            )}
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-3">
          {secoesVisiveis.map((secao) => (
            <div key={secao.rotulo} className="mb-4 last:mb-0">
              <p className="px-3 pb-1.5 pt-1 text-[10px] font-semibold uppercase tracking-widest text-ink-500">{secao.rotulo}</p>
              <div className="space-y-0.5">
                {secao.itens.map((item) => {
                  const bloqueado = bloqueadoPeloPlano(item.tela, ehGrupo(item) ? undefined : item.planoRecurso);
                  const titulo = `Disponível em planos superiores ao ${plano}`;

                  if (ehGrupo(item)) {
                    const dentro = pathname.startsWith(`/${item.chave}`);
                    const aberto = gruposAbertos[item.chave] ?? dentro;
                    const Icone = item.icone;
                    if (bloqueado) return <ItemBloqueado key={item.chave} rotulo={item.rotulo} titulo={titulo} Icone={Icone} />;
                    return (
                      <div key={item.chave}>
                        <button
                          onClick={() => setGruposAbertos((atual) => ({ ...atual, [item.chave]: !aberto }))}
                          aria-expanded={aberto}
                          className={[
                            'group flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                            dentro ? 'text-tenant' : 'text-ink-300 hover:bg-ink-700 hover:text-ink-100',
                          ].join(' ')}
                        >
                          <Icone className="h-[18px] w-[18px] shrink-0" />
                          {item.rotulo}
                          <IconeSeta className={['ml-auto h-3.5 w-3.5 transition-transform duration-200', aberto ? 'rotate-90' : ''].join(' ')} />
                        </button>
                        <AnimatePresence initial={false}>
                          {aberto && (
                            <motion.div
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                              className="overflow-hidden"
                            >
                              <div className="ml-[21px] mt-0.5 space-y-0.5 border-l border-ink-700 pl-3">
                                {item.filhos.map((filho) => (
                                  <NavLink
                                    key={filho.rota}
                                    to={filho.rota}
                                    end={filho.exato}
                                    onClick={aoFechar}
                                    className={({ isActive }) =>
                                      [
                                        'block rounded-md px-3 py-1.5 text-[13px] transition-colors',
                                        isActive ? 'bg-tenant-soft font-medium text-tenant' : 'text-ink-400 hover:bg-ink-700 hover:text-ink-100',
                                      ].join(' ')
                                    }
                                  >
                                    {filho.rotulo}
                                  </NavLink>
                                ))}
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  }

                  const Icone = item.icone!;
                  if (bloqueado) return <ItemBloqueado key={item.rota} rotulo={item.rotulo} titulo={titulo} Icone={Icone} />;
                  return (
                    <NavLink
                      key={item.rota}
                      to={item.rota}
                      end={item.exato}
                      onClick={aoFechar}
                      className={({ isActive }) =>
                        [
                          'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                          isActive
                            ? 'bg-tenant-soft text-tenant before:absolute before:-left-3 before:top-1.5 before:h-6 before:w-[3px] before:rounded-r-full before:bg-tenant'
                            : 'text-ink-300 hover:bg-ink-700 hover:text-ink-100',
                        ].join(' ')
                      }
                    >
                      <Icone className="h-[18px] w-[18px] shrink-0" />
                      {item.rotulo}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className="border-t border-ink-700 px-5 py-4 text-xs text-ink-400">
          <p className="truncate">{tenant?.razaoSocial}</p>
          <p>{tenant?.cnpj}</p>
        </div>
      </aside>
    </>
  );
}

function ItemBloqueado({ rotulo, titulo, Icone }: { rotulo: string; titulo: string; Icone: Icone }) {
  return (
    <div title={titulo} className="flex cursor-not-allowed items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-ink-500 opacity-60">
      <Icone className="h-[18px] w-[18px] shrink-0" />
      {rotulo}
      <IconeCadeado className="ml-auto h-3.5 w-3.5" />
    </div>
  );
}
