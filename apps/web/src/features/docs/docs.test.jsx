import { describe, expect, it } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import { renderApp } from '@/test/render.jsx';

describe('in-app documentation', () => {
  it('lists every section with status badges taken from the status file', async () => {
    renderApp('/app/docs');
    expect(await screen.findByRole('heading', { level: 1, name: 'Documentation' })).toBeInTheDocument();
    for (const section of ['Users', 'Developers', 'AI/ML', 'DevOps', 'Reference']) {
      expect(screen.getByRole('heading', { level: 2, name: section })).toBeInTheDocument();
    }
    const main = screen.getByRole('article');
    const card = within(main).getByRole('link', { name: 'GCP deployment' }).closest('li');
    expect(within(card).getByText('Blocked: GCP project / WIF / Artifact Registry')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'API reference' })).toHaveAttribute('href', '/docs/reference/api/');
  });

  it('renders a guide page with badges, DEMO and blocked notes, outline and site link', async () => {
    renderApp('/app/docs/user-guide');
    expect(await screen.findByRole('heading', { level: 1, name: 'User guide' })).toBeInTheDocument();
    const badges = screen.getByLabelText('Status');
    expect(within(badges).getByText('DEMO')).toBeInTheDocument();
    expect(within(badges).getByText('Blocked: OpenAI API key')).toBeInTheDocument();
    expect(within(badges).getByText(/^(Implemented|Planned)$/)).toHaveAttribute('title', expect.stringMatching(/^Gate 2 /));
    expect(screen.getByText('DEMO data.')).toBeInTheDocument();
    expect(screen.getByText('Needs external setup.')).toBeInTheDocument();
    const toc = screen.getByRole('complementary', { name: 'On this page' });
    expect(within(toc).getByRole('link', { name: 'Grounded answers' })).toHaveAttribute('href', '#grounded-answers');
    expect(screen.getByRole('heading', { level: 2, name: 'Grounded answers' })).toHaveAttribute('id', 'grounded-answers');
    expect(screen.getByRole('link', { name: 'documentation site' })).toHaveAttribute('href', '/docs/start/user-guide/');
  });

  it('navigates between pages from the sidebar and links inside a page', async () => {
    const router = renderApp('/app/docs/walkthrough');
    await screen.findByRole('heading', { level: 1, name: 'Developer walkthrough' });
    const nav = screen.getByRole('navigation', { name: 'Documentation pages' });
    expect(within(nav).getByRole('link', { name: 'Developer walkthrough' })).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getAllByRole('link', { name: 'RAG pipeline' }).find((a) => !nav.contains(a)));
    expect(await screen.findByRole('heading', { level: 1, name: 'RAG pipeline' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/app/docs/rag-pipeline');
  });

  it('says when a page does not exist', async () => {
    renderApp('/app/docs/no-such-page');
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all pages' })).toHaveAttribute('href', '/app/docs');
  });
});
