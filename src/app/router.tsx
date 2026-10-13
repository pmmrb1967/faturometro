import { createBrowserRouter } from 'react-router';
import { LoginPage } from '../features/auth/LoginPage';
import { RecoverPage } from '../features/auth/RecoverPage';
import { RegisterPage } from '../features/auth/RegisterPage';
import { RequireSession } from '../features/auth/RequireSession';
import { ContractsPage } from '../features/contracts/ContractsPage';
import { InvoicesPage } from '../features/ingest/InvoicesPage';
import { Landing } from '../landing/Landing';
import { AppShell, NotFound, SectionPlaceholder } from './AppShell';
import { SECTIONS, type SectionId } from './sections';

function sectionElement(id: SectionId) {
  if (id === 'invoices') return <InvoicesPage />;
  if (id === 'contracts') return <ContractsPage />;
  return <SectionPlaceholder section={id} />;
}

export const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  { path: '/criar-conta', element: <RegisterPage /> },
  { path: '/entrar', element: <LoginPage /> },
  { path: '/recuperar', element: <RecoverPage /> },
  {
    path: '/app',
    element: (
      <RequireSession>
        <AppShell />
      </RequireSession>
    ),
    children: SECTIONS.map((section) =>
      section.path === '/app'
        ? { index: true, element: <SectionPlaceholder section={section.id} /> }
        : {
            path: section.path,
            element: sectionElement(section.id),
          },
    ),
  },
  { path: '*', element: <NotFound /> },
]);
