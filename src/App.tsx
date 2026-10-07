import type { ReactNode } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { TenantProvider, useTenant } from '@/contexts/TenantContext';
import { ToastProvider } from '@/contexts/ToastContext';
import { ConfirmProvider } from '@/contexts/ConfirmContext';
import { ThemeProvider } from '@/contexts/ThemeContext';
import { LoadingState } from '@/components/Common/LoadingState';
import { DashboardScreen } from '@/components/Dashboard/DashboardScreen';
import { PDVScreen } from '@/components/PDV/PDVScreen';
import { EstoqueScreen } from '@/components/Estoque/EstoqueScreen';
import { ClientesScreen } from '@/components/Clientes/ClientesScreen';
import { VendedoresScreen } from '@/components/Vendedores/VendedoresScreen';
import { RelatoriosScreen } from '@/components/Relatorios/RelatoriosScreen';
import { FinanceiroScreen } from '@/components/Financeiro/FinanceiroScreen';
import { LojasScreen } from '@/components/Lojas/LojasScreen';
import { LancamentosScreen } from '@/components/Financeiro/LancamentosScreen';
import { UsuariosScreen } from '@/components/Usuarios/UsuariosScreen';
import { MeuPlanoScreen } from '@/components/Conta/MeuPlanoScreen';
import { AuditoriaScreen } from '@/components/Conta/AuditoriaScreen';
import { LoginScreen } from '@/components/Auth/LoginScreen';
import { RegisterScreen } from '@/components/Auth/RegisterScreen';
import { EsqueciSenhaScreen } from '@/components/Auth/EsqueciSenhaScreen';
import { RedefinirSenhaScreen } from '@/components/Auth/RedefinirSenhaScreen';
import { MinhaContaScreen } from '@/components/Conta/MinhaContaScreen';
import { AdminScreen } from '@/components/Admin/AdminScreen';
import { LandingPage } from '@/components/Marketing/LandingPage';
import { NotFoundScreen } from '@/components/Common/NotFoundScreen';
import { TermosScreen } from '@/components/Legal/TermosScreen';
import { PrivacidadeScreen } from '@/components/Legal/PrivacidadeScreen';
import { podeVerTela } from '@/utils/permissoes';
import { planoPermiteTela } from '@/utils/planos';
import type { TelaComPermissao } from '@/types';

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
              <Roteador />
            </BrowserRouter>
          </TenantProvider>
        </ConfirmProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
