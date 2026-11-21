import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { listenForInstall } from './app/install';
import { listenForOpenedFiles } from './app/opened-files';
import { registerPwa } from './app/pwa';
import { router } from './app/router';
import { loadWebAnalytics } from './app/web-analytics';
import { SessionProvider } from './features/auth/session';
import { startOneDriveReturn } from './features/sync/onedrive-return';
import './index.css';
import './components/buttons.css';

listenForInstall();
listenForOpenedFiles();
registerPwa();
// Back from the Microsoft sign-in page: finish it before the pages ask (src/cloud/onedrive-auth.ts).
startOneDriveReturn();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
  <StrictMode>
    <SessionProvider>
      <RouterProvider router={router} />
    </SessionProvider>
  </StrictMode>,
);

loadWebAnalytics(router);
