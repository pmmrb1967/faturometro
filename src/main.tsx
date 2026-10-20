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
import './index.css';

listenForInstall();
listenForOpenedFiles();
registerPwa();

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
