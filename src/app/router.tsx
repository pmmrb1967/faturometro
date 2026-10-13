import { createBrowserRouter } from 'react-router';
import { Landing } from '../landing/Landing';
import { AppShell, NotFound, SectionPlaceholder } from './AppShell';
import { SECTIONS } from './sections';

export const router = createBrowserRouter([
  { path: '/', element: <Landing /> },
  {
    path: '/app',
    element: <AppShell />,
    children: SECTIONS.map((section) =>
      section.path === '/app'
        ? { index: true, element: <SectionPlaceholder section={section.id} /> }
        : { path: section.path, element: <SectionPlaceholder section={section.id} /> },
    ),
  },
  { path: '*', element: <NotFound /> },
]);
