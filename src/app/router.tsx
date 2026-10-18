import { createBrowserRouter } from 'react-router';
import { PrivacyPage } from '../landing/PrivacyPage';
import { LoginPage } from '../features/auth/LoginPage';
import { RecoverPage } from '../features/auth/RecoverPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { RequireSession } from '../features/auth/RequireSession';
import { HomePage } from '../features/alerts/HomePage';
import { ComparePage } from '../features/compare/ComparePage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { ConnectPage } from '../features/sync/ConnectPage';
import { ContractPage } from '../features/contracts/ContractPage';
import { ContractsPage } from '../features/contracts/ContractsPage';
import { InvoicesPage } from '../features/ingest/InvoicesPage';
import { SocialTariffPage } from '../features/social-tariff/SocialTariffPage';
import { Landing } from '../landing/Landing';
import { AppShell, NotFound, SectionPlaceholder } from './AppShell';
import { SECTIONS, type SectionId } from './sections';

function sectionElement(id: SectionId) {
  if (id === 'home') return <HomePage />;
  if (id === 'compare') return <ComparePage />;
  if (id === 'settings') return <SettingsPage />;
  if (id === 'invoices') return <InvoicesPage />;
  if (id === 'contracts') return <ContractsPage />;
  return <SectionPlaceholder section={id} />;
}

export const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/privacidade', element: <PrivacyPage /> },
  { path: '/criar-conta', element: <RegisterPage /> },
  { path: '/entrar', element: <LoginPage /> },
  { path: '/recuperar', element: <RecoverPage /> },
  { path: '/entrar-sincronizado', element: <ConnectPage /> },
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
      { path: '/app/contratos/:id', element: <ContractPage /> },
      { path: '/app/tarifa-social', element: <SocialTariffPage /> },
    ],
  },
  { path: '*', element: <NotFound /> },
]);
