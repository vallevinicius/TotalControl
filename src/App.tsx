import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TenantProvider, useTenant } from '@/contexts/TenantContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LoadingState } from '@/components/Common/LoadingState';
import { LoginScreen } from '@/components/Auth/LoginScreen';
import { NotFoundScreen } from '@/components/Common/NotFoundScreen';
import { podeVerTela } from '@/utils/permissoes';
import { planoPermiteTela } from '@/utils/planos';
import type { TelaComPermissao } from '@/types';

// Cada tela vira um arquivo separado, baixado só quando a pessoa a abre (o carregamento inicial fica bem menor).
const DashboardScreen = lazy(() => import('@/components/Dashboard/DashboardScreen').then((m) => ({ default: m.DashboardScreen })));
const PDVScreen = lazy(() => import('@/components/PDV/PDVScreen').then((m) => ({ default: m.PDVScreen })));
const EstoqueScreen = lazy(() => import('@/components/Estoque/EstoqueScreen').then((m) => ({ default: m.EstoqueScreen })));
const ClientesScreen = lazy(() => import('@/components/Clientes/ClientesScreen').then((m) => ({ default: m.ClientesScreen })));
const VendedoresScreen = lazy(() => import('@/components/Vendedores/VendedoresScreen').then((m) => ({ default: m.VendedoresScreen })));
const RelatoriosScreen = lazy(() => import('@/components/Relatorios/RelatoriosScreen').then((m) => ({ default: m.RelatoriosScreen })));
const FinanceiroScreen = lazy(() => import('@/components/Financeiro/FinanceiroScreen').then((m) => ({ default: m.FinanceiroScreen })));
const LojasScreen = lazy(() => import('@/components/Lojas/LojasScreen').then((m) => ({ default: m.LojasScreen })));
const LancamentosScreen = lazy(() => import('@/components/Financeiro/LancamentosScreen').then((m) => ({ default: m.LancamentosScreen })));
const ContasScreen = lazy(() => import('@/components/Financeiro/ContasScreen').then((m) => ({ default: m.ContasScreen })));
const UsuariosScreen = lazy(() => import('@/components/Usuarios/UsuariosScreen').then((m) => ({ default: m.UsuariosScreen })));
const MeuPlanoScreen = lazy(() => import('@/components/Conta/MeuPlanoScreen').then((m) => ({ default: m.MeuPlanoScreen })));
const AuditoriaScreen = lazy(() => import('@/components/Conta/AuditoriaScreen').then((m) => ({ default: m.AuditoriaScreen })));
const RegisterScreen = lazy(() => import('@/components/Auth/RegisterScreen').then((m) => ({ default: m.RegisterScreen })));
const EsqueciSenhaScreen = lazy(() => import('@/components/Auth/EsqueciSenhaScreen').then((m) => ({ default: m.EsqueciSenhaScreen })));
const RedefinirSenhaScreen = lazy(() => import('@/components/Auth/RedefinirSenhaScreen').then((m) => ({ default: m.RedefinirSenhaScreen })));
const MinhaContaScreen = lazy(() => import('@/components/Conta/MinhaContaScreen').then((m) => ({ default: m.MinhaContaScreen })));
const EmpresaScreen = lazy(() => import('@/components/Conta/EmpresaScreen').then((m) => ({ default: m.EmpresaScreen })));
const AdminScreen = lazy(() => import('@/components/Admin/AdminScreen').then((m) => ({ default: m.AdminScreen })));
const LandingPage = lazy(() => import('@/components/Marketing/LandingPage').then((m) => ({ default: m.LandingPage })));
const TermosScreen = lazy(() => import('@/components/Legal/TermosScreen').then((m) => ({ default: m.TermosScreen })));
const PrivacidadeScreen = lazy(() => import('@/components/Legal/PrivacidadeScreen').then((m) => ({ default: m.PrivacidadeScreen })));

function TelaCarregando() {
  return (
    <div className="flex h-screen items-center justify-center bg-ink-900">
      <LoadingState mensagem="Carregando sessão…" />
    </div>
  );
}

/** Rotas da loja (tenant) — sessão resolvida via TenantContext. Se `tela` for
 * informado, também exige que o usuário logado tenha permissão pra ela
 * (ADMIN sempre tem; usuários sem permissoes.length também têm, pra não
 * bloquear contas de antes desse recurso existir). */
function RotaProtegida({
  children,
  tela,
  fallbackPublico,
  permiteExpirado,
}: {
  children: ReactNode;
  tela?: TelaComPermissao;
  /** Renderizado no lugar do redirect pra /login quando não autenticado —
   * usado só na rota "/" pra mostrar a landing page em vez de forçar login. */
  fallbackPublico?: ReactNode;
  /** Rotas que continuam abertas com o acesso expirado (só a tela do plano). */
  permiteExpirado?: boolean;
}) {
  const { autenticado, carregando, usuarioAtual, tenant } = useTenant();
  if (carregando) return <TelaCarregando />;
  if (!autenticado) return fallbackPublico ? <>{fallbackPublico}</> : <Navigate to="/login" replace />;
  // Teste grátis acabado ou assinatura vencida: só a tela do plano abre.
  if (tenant?.acessoExpirado && !permiteExpirado) return <Navigate to="/plano" replace />;
  if (tela && !podeVerTela(usuarioAtual, tela)) return <Navigate to="/" replace />;
  if (tela && tenant && !planoPermiteTela(tenant.planoAtual, tela)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RotaPublica({ children }: { children: ReactNode }) {
  const { autenticado, carregando } = useTenant();
  if (carregando) return <TelaCarregando />;
  if (autenticado) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function Roteador() {
  const { autenticado } = useTenant();
  // Já logado: baixa em segundo plano a tela do PDV (e o service worker a guarda), para ela abrir mesmo sem internet.
  useEffect(() => {
    if (!autenticado) return;
    const baixar = () => void import('@/components/PDV/PDVScreen');
    const ocioso = (window as { requestIdleCallback?: (f: () => void) => number }).requestIdleCallback;
    if (ocioso) ocioso(baixar);
    else setTimeout(baixar, 2000);
  }, [autenticado]);

  return (
    <Routes>
      <Route
        path="/login"
        element={
          <RotaPublica>
            <LoginScreen />
          </RotaPublica>
        }
      />
      <Route
        path="/esqueci-senha"
        element={
          <RotaPublica>
            <EsqueciSenhaScreen />
          </RotaPublica>
        }
      />
      {/* Aberta mesmo com sessão: quem clica no link do e-mail pode já estar logado neste navegador. */}
      <Route path="/redefinir-senha" element={<RedefinirSenhaScreen />} />
      <Route
        path="/empresa"
        element={
          <RotaProtegida>
            <EmpresaScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/conta"
        element={
          <RotaProtegida>
            <MinhaContaScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/registrar"
        element={
          <RotaPublica>
            <RegisterScreen />
          </RotaPublica>
        }
      />
      <Route
        path="/"
        element={
          <RotaProtegida tela="dashboard" fallbackPublico={<LandingPage />}>
            <DashboardScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/pdv"
        element={
          <RotaProtegida tela="pdv">
            <PDVScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/estoque"
        element={
          <RotaProtegida tela="estoque">
            <EstoqueScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/financeiro"
        element={
          <RotaProtegida tela="financeiro">
            <FinanceiroScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/financeiro/contas"
        element={
          <RotaProtegida tela="financeiro">
            <ContasScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/financeiro/lancamentos"
        element={
          <RotaProtegida tela="financeiro">
            <LancamentosScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/clientes"
        element={
          <RotaProtegida tela="clientes">
            <ClientesScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/vendedores"
        element={
          <RotaProtegida tela="vendedores">
            <VendedoresScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/relatorios"
        element={
          <RotaProtegida tela="relatorios">
            <RelatoriosScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/lojas"
        element={
          <RotaProtegida>
            <LojasScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/usuarios"
        element={
          <RotaProtegida>
            <UsuariosScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/plano"
        element={
          <RotaProtegida permiteExpirado>
            <MeuPlanoScreen />
          </RotaProtegida>
        }
      />
      <Route
        path="/auditoria"
        element={
          <RotaProtegida>
            <AuditoriaScreen />
          </RotaProtegida>
        }
      />

      <Route path="/admin" element={<AdminScreen />} />

      <Route path="/termos" element={<TermosScreen />} />
      <Route path="/privacidade" element={<PrivacidadeScreen />} />

      <Route path="*" element={<NotFoundScreen />} />
    </Routes>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <ConfirmProvider>
          <TenantProvider>
            <BrowserRouter>
              <Suspense fallback={<TelaCarregando />}>
                <Roteador />
              </Suspense>
            </BrowserRouter>
          </TenantProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
