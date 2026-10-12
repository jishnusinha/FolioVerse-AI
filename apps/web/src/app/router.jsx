import { Navigate, Outlet } from 'react-router';
import { APP_ROUTES, PUBLIC_ROUTES } from './routes.js';
import { AppShell } from './AppShell.jsx';
import { NotFoundPage, PlaceholderPage } from './PlaceholderPage.jsx';

/** Page components that have replaced placeholders, keyed by route id. */
const PAGES = {};

function element(route) {
  const Page = PAGES[route.id];
  return Page ? <Page /> : <PlaceholderPage route={route} />;
}

function PublicLayout() {
  return (
    <main id="main" className="grid min-h-full place-items-center bg-fv-bg text-fv-text">
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
