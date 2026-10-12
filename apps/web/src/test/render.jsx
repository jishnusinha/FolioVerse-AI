import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { routeObjects } from '@/app/router.jsx';
import { createQueryClient } from '@/shared/queryClient.js';

/** Renders the full route tree at `path` with a fresh query cache. */
export function renderApp(path) {
  const router = createMemoryRouter(routeObjects, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}
