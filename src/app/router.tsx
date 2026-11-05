import { Suspense, type ReactNode } from 'react';
import { createBrowserRouter, Navigate } from 'react-router';
import { RequireSession } from '../features/auth/RequireSession';
import { t } from '../i18n/pt-PT';
import { Landing } from '../landing/Landing';
import { PrivacyPage } from '../landing/PrivacyPage';
import { AppShell, NotFound, SectionPlaceholder } from './AppShell';
import { lazyPage } from './lazy-page';
import { SECTIONS, type SectionId } from './sections';

// The landing and privacy pages load at once; everything else in its own files.
const LoginPage = lazyPage(() => import('../features/auth/LoginPage').then((m) => m.LoginPage));
const RecoverPage = lazyPage(() =>
  import('../features/auth/RecoverPage').then((m) => m.RecoverPage),
);
const RegisterPage = lazyPage(() =>
  import('../features/auth/RegisterPage').then((m) => m.RegisterPage),
);
const ConnectPage = lazyPage(() =>
  import('../features/sync/ConnectPage').then((m) => m.ConnectPage),
);
const HomePage = lazyPage(() => import('../features/alerts/HomePage').then((m) => m.HomePage));
const ComparePage = lazyPage(() =>
  import('../features/compare/ComparePage').then((m) => m.ComparePage),
);
const SettingsPage = lazyPage(() =>
  import('../features/settings/SettingsPage').then((m) => m.SettingsPage),
);
const ContractPage = lazyPage(() =>
  import('../features/contracts/ContractPage').then((m) => m.ContractPage),
);
const ContractsPage = lazyPage(() =>
  import('../features/contracts/ContractsPage').then((m) => m.ContractsPage),
);
const InvoicesPage = lazyPage(() =>
  import('../features/ingest/InvoicesPage').then((m) => m.InvoicesPage),
);
const MonthPage = lazyPage(() => import('../features/month/MonthPage').then((m) => m.MonthPage));
const SocialTariffPage = lazyPage(() =>
  import('../features/social-tariff/SocialTariffPage').then((m) => m.SocialTariffPage),
);

/** Pages outside the app (sign in, create account): the shell is not there to wait in. */
function standalone(page: ReactNode) {
  return <Suspense fallback={<p className="hint content">{t.loadingPage}</p>}>{page}</Suspense>;
}

function sectionElement(id: SectionId) {
  if (id === 'home') return <HomePage />;
  if (id === 'compare') return <ComparePage />;
  if (id === 'settings') return <SettingsPage />;
  if (id === 'invoices') return <InvoicesPage />;
  if (id === 'contracts') return <ContractsPage />;
  if (id === 'month') return <MonthPage />;
  return <SectionPlaceholder section={id} />;
}

export const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/privacidade', element: <PrivacyPage /> },
  { path: '/criar-conta', element: standalone(<RegisterPage />) },
  { path: '/entrar', element: standalone(<LoginPage />) },
  { path: '/recuperar', element: standalone(<RecoverPage />) },
  { path: '/entrar-sincronizado', element: standalone(<ConnectPage />) },
  {
    path: '/app',
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    children: [
      ...SECTIONS.map((section) =>
        section.path === '/app'
          ? { index: true, element: sectionElement(section.id) }
          : { path: section.path, element: sectionElement(section.id) },
      ),
      // "Gastos" was a section of its own at first: old links open its tab.
      { path: '/app/gastos', element: <Navigate to="/app/mes?separador=gastos" replace /> },
      { path: '/app/contratos/:id', element: <ContractPage /> },
      { path: '/app/tarifa-social', element: <SocialTariffPage /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
