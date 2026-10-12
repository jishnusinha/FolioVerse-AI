import { describe, expect, it } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { renderApp } from '@/test/render.jsx';
import { DEMO_USER, createFakeApi, installFakeFetch } from '@/test/fakeApi.js';
import { api } from '@/api/client.js';

/** Labels include hint text, so match on the leading label words. */
const type = (label, value) => fireEvent.change(screen.getByLabelText(new RegExp(`^${label}`)), { target: { value } });

describe('sign in', () => {
  it('signs in and returns to the page the visitor asked for', async () => {
    const fake = installFakeFetch(createFakeApi({ signedIn: false }));
    const router = renderApp('/app/costs');
    await screen.findByRole('heading', { name: 'Welcome back' });
    type('Email', DEMO_USER.email);
    type('Password', DEMO_USER.password);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await screen.findByRole('heading', { level: 1, name: 'Cost Center' });
    expect(router.state.location.pathname).toBe('/app/costs');
    expect(fake.db.log).toContain('POST /auth/login');
  });

  it('shows the API error for bad credentials', async () => {
    installFakeFetch(createFakeApi({ signedIn: false }));
    renderApp('/auth/login');
    await screen.findByRole('heading', { name: 'Welcome back' });
    type('Email', DEMO_USER.email);
    type('Password', 'wrong-password-1');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
  });

  it('ignores off-site next parameters', async () => {
    installFakeFetch(createFakeApi({ signedIn: false }));
    const router = renderApp('/auth/login?next=//evil.example');
    await screen.findByRole('heading', { name: 'Welcome back' });
    type('Email', DEMO_USER.email);
    type('Password', DEMO_USER.password);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app'));
  });

  it('signs out from the account menu', async () => {
    const fake = installFakeFetch();
    const router = renderApp('/app');
    const account = await screen.findByRole('button', { name: /^Account:/ });
    fireEvent.keyDown(account, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Sign out' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/auth/login'));
    expect(fake.db.session).toBe(false);
  });
});

describe('api client', () => {
  it('refreshes an expired access token once and retries the request', async () => {
    const fake = installFakeFetch();
    fake.db.accessExpired = true;
    const me = await api('/auth/me');
    expect(me.user.email).toBe(DEMO_USER.email);
    expect(fake.db.refreshes).toBe(1);
    expect(fake.db.log.filter((l) => l === 'GET /auth/me')).toHaveLength(2);
  });

  it('does not try to refresh after a failed login', async () => {
    const fake = installFakeFetch(createFakeApi({ signedIn: false }));
    await expect(api('/auth/login', { method: 'POST', body: { email: 'x@example.test', password: 'nope-nope-1' } })).rejects.toMatchObject({
      status: 401,
      code: 'INVALID_CREDENTIALS',
    });
    expect(fake.db.log).not.toContain('POST /auth/refresh');
  });
});

describe('registration and onboarding', () => {
  it('registers, names the workspace and opens the first research project', async () => {
    const fake = installFakeFetch(createFakeApi({ signedIn: false }));
    fake.db.user.email = 'someone-else@example.test';
    const router = renderApp('/auth/register');
    await screen.findByRole('heading', { name: 'Create your account' });
    type('Name', 'Ada Lovelace');
    type('Email', 'ada@example.test');
    type('Password', 'short');
    expect(screen.getByRole('alert')).toHaveTextContent('at least 10 characters');
    type('Password', 'long-enough-password');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    await screen.findByRole('heading', { name: 'Name your workspace' });
    expect(router.state.location.pathname).toBe('/onboarding');
    expect(screen.getByRole('status')).toHaveTextContent('ada@example.test');
    const name = screen.getByLabelText('Workspace name');
    expect(name).toHaveValue("Ada Lovelace's workspace");
    fireEvent.change(name, { target: { value: 'Analytical Engines' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));

    await screen.findByRole('heading', { name: 'Start your first project' });
    expect(fake.db.workspaces[0].name).toBe('Analytical Engines');
    const research = screen.getByRole('button', { name: /Research project/ });
    await waitFor(() => expect(research).toBeEnabled());
    fireEvent.click(research);
    await screen.findByRole('heading', { level: 1, name: 'Project Atlas' });
  });
});

describe('password reset and email verification', () => {
  it('sets a new password with a valid token', async () => {
    installFakeFetch(createFakeApi({ signedIn: false }));
    renderApp('/reset-password?token=good-token');
    await screen.findByRole('heading', { name: 'Choose a new password' });
    type('New password', 'another-password-1');
    type('Confirm new password', 'another-password-2');
    expect(screen.getByRole('alert')).toHaveTextContent('do not match');
    type('Confirm new password', 'another-password-1');
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('status')).toHaveTextContent('password was changed');
  });

  it('explains an expired reset link', async () => {
    installFakeFetch(createFakeApi({ signedIn: false }));
    renderApp('/reset-password?token=used');
    await screen.findByRole('heading', { name: 'Choose a new password' });
    type('New password', 'another-password-1');
    type('Confirm new password', 'another-password-1');
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('invalid, expired or already used');
  });

  it('verifies an email address from the link', async () => {
    const fake = installFakeFetch(createFakeApi({ emailVerified: false }));
    renderApp('/verify-email?token=good-token');
    expect(await screen.findByText('Your email address is verified.')).toBeInTheDocument();
    expect(fake.db.user.emailVerified).toBe(true);
  });

  it('accepts a workspace invitation and switches to it', async () => {
    const fake = installFakeFetch();
    const router = renderApp('/accept-invite?token=good-token');
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/knowledge'));
    expect(fake.db.memberships.map((m) => m.role)).toEqual(['OWNER', 'EDITOR']);
    expect(await screen.findByRole('button', { name: /Workspace: Invited Team/ })).toBeInTheDocument();
  });
});
