import { Navigate, Outlet } from 'react-router';
import { APP_ROUTES, PUBLIC_ROUTES } from './routes.js';
import { AppShell } from './AppShell.jsx';
import { NotFoundPage, PlaceholderPage } from './PlaceholderPage.jsx';
import { DesignGalleryPage } from '@/features/design/DesignGalleryPage.jsx';
import { SettingsPage } from '@/features/settings/SettingsPage.jsx';

/** Page components that have replaced placeholders, keyed by route id. */
const PAGES = {
  'docs-design': DesignGalleryPage,
  settings: SettingsPage,
  'settings-section': SettingsPage,
};

function element(route) {
  const Page = PAGES[route.id];
  return Page ? <Page /> : <PlaceholderPage route={route} />;
}

function PublicLayout() {
  return (
    <main id="main" tabIndex={-1} style={{ height: '100%' }}>
      <Outlet />
    </main>
  );
}

/** Route objects for `createBrowserRouter` / `createMemoryRouter`. */
export const routeObjects = [
  { path: '/', element: <Navigate to="/app" replace /> },
  {
    element: <PublicLayout />,
    children: PUBLIC_ROUTES.map((r) => ({ path: r.path, element: element(r), handle: { route: r } })),
  },
  {
    element: <AppShell />,
    children: [
      ...APP_ROUTES.map((r) => ({ path: r.path, element: element(r), handle: { route: r } })),
      { path: '/app/*', element: <NotFoundPage />, handle: { route: { title: 'Not found' } } },
    ],
  },
  { path: '*', element: <NotFoundPage /> },
];
