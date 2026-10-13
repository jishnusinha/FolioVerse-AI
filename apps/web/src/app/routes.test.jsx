import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { ALL_ROUTES, APP_ROUTES, SECTIONS, hrefFor } from './routes.js';
import { routeObjects } from './router.jsx';
import { createQueryClient } from '@/shared/queryClient.js';
import { createFakeApi, installFakeFetch } from '@/test/fakeApi.js';

function renderAt(path) {
  const router = createMemoryRouter(routeObjects, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const sample = (path) => path.replace(/:(\w+)/g, (_, k) => `sample-${k}`);

/** Routes whose real page has its own heading instead of the placeholder title. */
const EXPECTED_H1 = {
  settings: 'Appearance',
  'settings-section': 'Appearance',
  login: 'Welcome back',
  register: 'Create your account',
  forgot: 'Reset your password',
  reset: 'Choose a new password',
  verify: 'Verify your email',
  onboarding: 'Name your workspace',
  project: 'Project not found',
  document: 'Document not found',
  artifact: 'Artifact not found',
  'studio-run': 'AI Developer Studio',
  costs: 'Your AI usage',
  manuscript: 'Manuscript not found',
  dna: 'Manuscript not found',
  continuity: 'Manuscript not found',
  'manuscript-print': 'Manuscript not found',
  reader: 'Book not found',
  discover: 'Find your next story',
  'docs-page': 'Page not found',
};
const SIGNED_OUT = new Set(['login', 'register', 'forgot', 'reset', 'verify']);
const SUPER_ADMIN = new Set(['admin-costs', 'admin-pricing', 'admin-models']);

describe('route registry', () => {
  it('has unique ids and paths', () => {
    expect(new Set(ALL_ROUTES.map((r) => r.id)).size).toBe(ALL_ROUTES.length);
    expect(new Set(ALL_ROUTES.map((r) => r.path)).size).toBe(ALL_ROUTES.length);
  });

  it('every navigation section points at a registered route', () => {
    for (const s of SECTIONS) expect(APP_ROUTES.some((r) => r.path === s.to)).toBe(true);
  });

  it('builds hrefs and rejects missing params', () => {
    expect(hrefFor('document', { projectId: 'p 1', sourceId: 's1' })).toBe(
      '/app/knowledge/projects/p%201/documents/s1',
    );
    expect(() => hrefFor('document', { projectId: 'p1' })).toThrow(/sourceId/);
  });
});

describe('router smoke', () => {
  it.each(ALL_ROUTES.map((r) => [r.path, r]))('renders %s', async (_path, route) => {
    if (SIGNED_OUT.has(route.id)) installFakeFetch(createFakeApi({ signedIn: false }));
    if (SUPER_ADMIN.has(route.id)) installFakeFetch(createFakeApi({ superAdmin: true }));
    renderAt(sample(route.path));
    const name = EXPECTED_H1[route.id] ?? route.title;
    expect(await screen.findByRole('heading', { level: 1, name })).toBeInTheDocument();
  });

  it('redirects / to /app', async () => {
    const router = renderAt('/');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    expect(router.state.location.pathname).toBe('/app');
  });

  it('sends signed-out visitors to sign-in and remembers where they were going', async () => {
    installFakeFetch(createFakeApi({ signedIn: false }));
    const router = renderAt('/app/costs?range=30');
    await screen.findByRole('heading', { level: 1, name: 'Welcome back' });
    expect(router.state.location.pathname).toBe('/auth/login');
    expect(router.state.location.search).toBe(`?next=${encodeURIComponent('/app/costs?range=30')}`);
  });

  it('shows not found inside the shell for unknown app paths', async () => {
    renderAt('/app/does-not-exist');
    expect(await screen.findByRole('heading', { name: 'Not found' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
  });
});
