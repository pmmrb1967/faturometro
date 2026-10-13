import '@fontsource-variable/bricolage-grotesque';
import '@fontsource/atkinson-hyperlegible/latin-400.css';
import '@fontsource/atkinson-hyperlegible/latin-700.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';
import { listenForInstall } from './app/install';
import { registerPwa } from './app/pwa';
import { router } from './app/router';
import { SessionProvider } from './features/auth/session';
import './index.css';

listenForInstall();
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
