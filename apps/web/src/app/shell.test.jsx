import { beforeEach, describe, expect, it } from 'vitest';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { routeObjects } from './router.jsx';
import { createQueryClient } from '@/shared/queryClient.js';
import { useThemeStore } from '@/stores/theme.js';
import { useUiStore } from '@/stores/ui.js';
import { useToasts, toast } from '@/shared/ui/toast.jsx';

function renderAt(path) {
  const router = createMemoryRouter(routeObjects, { initialEntries: [path] });
  render(
    <QueryClientProvider client={createQueryClient()}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

beforeEach(() => {
  useThemeStore.setState({ theme: 'system' });
  useUiStore.setState({ railExpanded: false, paletteOpen: false, shortcutsOpen: false, notificationsOpen: false });
  useToasts.setState({ items: [] });
});

describe('app shell', () => {
  it('renders the primary navigation with all sections and marks the current one', async () => {
    renderAt('/app/knowledge/projects/p1');
    const nav = await screen.findByRole('navigation', { name: 'Primary' });
    for (const label of ['Home', 'Folio Knowledge', 'Folio Writer', 'Library', 'Discover', 'AI Developer Studio', 'Cost Center', 'Documentation']) {
      expect(nav.querySelector(`[title="${label}"]`)).not.toBeNull();
    }
    expect(nav.querySelector('[title="Folio Knowledge"]')).toHaveAttribute('aria-current', 'page');
    expect(nav.querySelector('[title="Home"]')).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Folio Knowledge/Project');
  });

  it('opens the command palette with Ctrl+K and navigates', async () => {
    const router = renderAt('/app');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'Library' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/library'));
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('navigates with g-sequences and opens shortcut help with ?', async () => {
    const router = renderAt('/app');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    fireEvent.keyDown(document, { key: 'g' });
    fireEvent.keyDown(document, { key: 'w' });
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/writer'));
    fireEvent.keyDown(document, { key: '?' });
    expect(await screen.findByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument();
  });

  it('toggles and persists the theme', async () => {
    renderAt('/app');
    const btn = await screen.findByRole('button', { name: 'Switch to dark theme' });
    fireEvent.click(btn);
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(JSON.parse(localStorage.getItem('fv-theme')).state.theme).toBe('dark');
    expect(screen.getByRole('button', { name: 'Switch to light theme' })).toBeInTheDocument();
  });

  it('expands the rail with Ctrl+\\ and persists the preference', async () => {
    renderAt('/app');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    fireEvent.keyDown(document, { key: '\\', ctrlKey: true });
    expect(document.querySelector('.app')).toHaveClass('expanded');
    expect(JSON.parse(localStorage.getItem('fv-ui')).state.railExpanded).toBe(true);
  });

  it('forces the Studio theme only on Studio routes', async () => {
    renderAt('/app/studio/runs/r1');
    await screen.findByRole('heading', { level: 1, name: 'AI Developer Studio' });
    expect(document.getElementById('main')).toHaveClass('studio');
  });

  it('opens notifications as a dialog and restores focus on close', async () => {
    renderAt('/app');
    const bell = await screen.findByRole('button', { name: 'Notifications' });
    bell.focus();
    fireEvent.click(bell);
    const dlg = await screen.findByRole('dialog', { name: 'Notifications' });
    fireEvent.keyDown(dlg, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(bell).toHaveFocus());
  });

  it('shows and dismisses toasts', async () => {
    renderAt('/app');
    await screen.findByRole('heading', { level: 1, name: 'Home' });
    act(() => {
      toast('Saved', 'ok');
    });
    expect(await screen.findByRole('status')).toHaveTextContent('Saved');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('Saved')).toBeNull();
  });

  it('sets the theme preference from Settings › Appearance', async () => {
    renderAt('/app/settings/appearance');
    const group = await screen.findByRole('group', { name: 'Theme' });
    fireEvent.click(within(group).getByRole('button', { name: 'Dark' }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    fireEvent.click(within(group).getByRole('button', { name: 'System' }));
    expect(useThemeStore.getState().theme).toBe('system');
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(within(group).getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('redirects unknown settings sections to Appearance', async () => {
    const router = renderAt('/app/settings/nope');
    await screen.findByRole('heading', { level: 1, name: 'Appearance' });
    expect(router.state.location.pathname).toBe('/app/settings/appearance');
  });

  it('renders the design gallery', async () => {
    renderAt('/app/docs/design');
    expect(await screen.findByRole('heading', { level: 1, name: 'Component gallery' })).toBeInTheDocument();
    expect(screen.getByTestId('family-cost')).toHaveTextContent('Finalized');
  });
});
