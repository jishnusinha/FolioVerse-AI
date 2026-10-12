import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { renderApp } from '@/test/render.jsx';
import { FAKE_CSRF, createFakeApi, installFakeFetch } from '@/test/fakeApi.js';
import { useWorkspaceStore } from '@/features/auth/session.js';
import { folderScope, folderTree, relativeTime } from './files.js';

vi.mock('@/api/client.js', async (importOriginal) => ({
  ...(await importOriginal()),
  // XHR is not routed through the fake fetch; replay the PUT through it and report progress.
  uploadWithProgress: async (target, _file, { onProgress }) => {
    onProgress?.(40);
    const res = await fetch(target.url, { method: 'PUT', headers: { 'x-csrf-token': FAKE_CSRF } });
    if (!res.ok) throw new Error('upload failed');
    onProgress?.(100);
  },
}));

function projectUrl(fake, name = 'Project Atlas') {
  return `/app/knowledge/projects/${fake.db.projects.find((p) => p.name === name).id}`;
}

async function openProject(opts) {
  const fake = installFakeFetch(createFakeApi(opts));
  const router = renderApp(projectUrl(fake));
  await screen.findByRole('heading', { level: 1, name: 'Project Atlas' });
  await screen.findByRole('button', { name: /Market Outlook 2026\.pdf/ });
  return { fake, router };
}

const table = () => screen.getByRole('table', { name: /Documents in/ });

describe('knowledge projects', () => {
  it('lists research projects and creates a new one', async () => {
    const fake = installFakeFetch();
    const router = renderApp('/app/knowledge');
    const list = await screen.findByRole('list', { name: 'Research projects' });
    expect(within(list).getByText('Project Atlas')).toBeInTheDocument();
    expect(within(list).getByText(/4 documents/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'New project' }));
    fireEvent.change(await screen.findByLabelText('Project name'), { target: { value: 'Climate Policy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create project' }));
    await screen.findByRole('heading', { level: 1, name: 'Climate Policy' });
    expect(router.state.location.pathname).toBe(projectUrl(fake, 'Climate Policy'));
  });

  it('filters documents by folder (including subfolders), type and name', async () => {
    await openProject();
    expect(within(table()).getAllByRole('row')).toHaveLength(5);
    fireEvent.click(screen.getByRole('button', { name: /Market research/ }));
    expect(screen.getByRole('button', { name: /^2026/ })).toBeInTheDocument();
    expect(within(table()).getAllByRole('row')).toHaveLength(4);
    fireEvent.click(screen.getByRole('button', { name: /^2026/ }));
    expect(within(table()).getAllByRole('row')).toHaveLength(3);
    fireEvent.click(screen.getByRole('button', { name: /All documents/ }));
    fireEvent.click(within(screen.getByRole('group', { name: 'File type' })).getByRole('button', { name: 'MD' }));
    expect(within(table()).getAllByRole('row')).toHaveLength(2);
    fireEvent.click(within(screen.getByRole('group', { name: 'File type' })).getByRole('button', { name: 'All' }));
    fireEvent.change(screen.getByLabelText('Filter documents by name'), { target: { value: 'survey' } });
    expect(within(table()).getAllByRole('row')).toHaveLength(2);
    expect(screen.getByText('1 of 4')).toBeInTheDocument();
  });

  it('shows details for the selected document and the ingestion tray', async () => {
    await openProject();
    fireEvent.click(screen.getByRole('button', { name: /Market Outlook 2026\.pdf/ }));
    const side = screen.getByRole('complementary', { name: 'Document details' });
    expect(await within(side).findByRole('heading', { name: 'Market Outlook 2026.pdf' })).toBeInTheDocument();
    expect(within(side).getByTitle(/· READY$/)).toHaveTextContent('Ready');
    expect(within(side).getByRole('link', { name: /Download/ })).toHaveAttribute('href', expect.stringMatching(/\/versions\/.+\/file$/));
    const tray = screen.getByRole('list', { name: 'Ingestion pipeline' });
    expect(within(tray).getByText('Analyst Briefing.docx')).toBeInTheDocument();
    expect(within(tray).getByText(/Parser timed out/)).toBeInTheDocument();
  });

  it('retries a failed document', async () => {
    const { fake } = await openProject();
    fireEvent.click(within(screen.getByRole('list', { name: 'Ingestion pipeline' })).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(fake.db.sources.find((s) => s.title === 'Survey Export.pdf').ingestionState).toBe('PARSING'));
  });

  it('uploads files with per-file states, including rejected and quarantined files', async () => {
    const { fake } = await openProject();
    fireEvent.click(screen.getByRole('button', { name: 'Upload' }));
    const dialog = await screen.findByRole('dialog', { name: 'Upload documents' });
    const files = [
      new File(['# Notes'], 'Field Notes.md', { type: 'text/markdown' }),
      new File(['MZ'], 'quarantine-me.pdf', { type: 'application/pdf' }),
      new File(['x'], 'tool.exe', { type: 'application/octet-stream' }),
    ];
    fireEvent.change(within(dialog).getByLabelText('Choose files'), { target: { files } });
    const items = within(dialog).getByRole('list', { name: 'Files to upload' });
    expect(within(items).getByText('Not allowed')).toBeInTheDocument();
    expect(within(items).getAllByText('Queued')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload 2 files' }));

    await within(items).findByText('Preview ready');
    await within(items).findByText('Quarantined');
    expect(within(items).getByText(/Blocked by the safety scan/)).toBeInTheDocument();
    expect(fake.db.sources.map((s) => s.title)).toEqual(expect.arrayContaining(['Field Notes.md', 'quarantine-me.pdf']));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
    expect(await within(table()).findByRole('button', { name: /Field Notes\.md/ })).toBeInTheDocument();
  });

  it('uploads a new version of an existing document', async () => {
    const { fake } = await openProject();
    fireEvent.click(screen.getByRole('button', { name: /Competitor Notes\.md/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Upload new version' }));
    const dialog = await screen.findByRole('dialog', { name: /new version of Competitor Notes\.md/ });
    fireEvent.change(within(dialog).getByLabelText('Choose a file'), { target: { files: [new File(['v2'], 'Competitor Notes.md')] } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Upload' }));
    await within(dialog).findByText('Preview ready');
    const source = fake.db.sources.find((s) => s.title === 'Competitor Notes.md');
    expect(fake.db.versions.filter((v) => v.sourceId === source.id)).toHaveLength(2);
  });

  it('creates folders and moves documents in batch', async () => {
    const { fake } = await openProject();
    fireEvent.click(screen.getByRole('button', { name: 'New folder' }));
    fireEvent.change(await screen.findByLabelText('Folder name'), { target: { value: 'Archive' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create folder' }));
    await screen.findByRole('button', { name: /^Archive/ });

    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Market Outlook 2026.pdf' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Competitor Notes.md' }));
    const bar = screen.getByRole('region', { name: 'Batch actions' });
    expect(bar).toHaveTextContent('2 selected');
    fireEvent.click(within(bar).getByRole('button', { name: 'Move' }));
    const dialog = await screen.findByRole('dialog', { name: 'Move 2 documents' });
    const archive = fake.db.folders.find((f) => f.name === 'Archive');
    fireEvent.change(within(dialog).getByLabelText('Destination'), { target: { value: archive.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Move' }));
    await waitFor(() => expect(fake.db.sources.filter((s) => s.folderId === archive.id)).toHaveLength(2));
  });

  it('moves documents to trash and restores them', async () => {
    const { fake, router } = await openProject();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select Survey Export.pdf' }));
    fireEvent.click(within(screen.getByRole('region', { name: 'Batch actions' })).getByRole('button', { name: 'Move to trash' }));
    await waitFor(() => expect(within(table()).queryByText('Survey Export.pdf')).toBeNull());

    fireEvent.click(screen.getByRole('link', { name: 'Trash' }));
    await screen.findByRole('heading', { level: 1, name: 'Trash' });
    expect(router.state.location.pathname).toBe('/app/knowledge/trash');
    const docs = await screen.findByRole('table', { name: 'Deleted documents' });
    expect(within(docs).getByText('Survey Export.pdf')).toBeInTheDocument();
    fireEvent.click(within(docs).getByRole('button', { name: 'Restore' }));
    await waitFor(() => expect(fake.db.sources.find((s) => s.title === 'Survey Export.pdf').deletedAt).toBeNull());
  });

  it('hides editing controls from viewers', async () => {
    const fake = installFakeFetch(createFakeApi({ role: 'VIEWER' }));
    const team = fake.db.workspaces.find((w) => w.kind === 'TEAM');
    useWorkspaceStore.setState({ workspaceId: team.id });
    renderApp(projectUrl(fake, 'Shared Knowledge'));
    await screen.findByRole('heading', { level: 1, name: 'Shared Knowledge' });
    expect(screen.queryByRole('button', { name: 'Upload' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New folder' })).toBeNull();
    expect(screen.getByText(/No documents yet/)).toBeInTheDocument();
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it('switches workspaces from the switcher', async () => {
    const fake = installFakeFetch(createFakeApi({ role: 'EDITOR' }));
    renderApp('/app/knowledge');
    const trigger = await screen.findByRole('button', { name: /Workspace: Aster Research/ });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Aster Team/ }));
    expect(await screen.findByRole('button', { name: /Workspace: Aster Team/ })).toBeInTheDocument();
    expect(await screen.findByText('Shared Knowledge')).toBeInTheDocument();
    expect(useWorkspaceStore.getState().workspaceId).toBe(fake.db.workspaces[1].id);
    useWorkspaceStore.setState({ workspaceId: null });
  });

  it('shows a not-found page for projects outside the workspace', async () => {
    installFakeFetch();
    renderApp('/app/knowledge/projects/00000000-0000-4000-8000-ffffffffffff');
    expect(await screen.findByRole('heading', { level: 1, name: 'Project not found' })).toBeInTheDocument();
  });
});

describe('file helpers', () => {
  const folders = [
    { id: 'a', parentId: null, name: 'B folder', path: '/a' },
    { id: 'b', parentId: 'a', name: 'child', path: '/a/b' },
    { id: 'c', parentId: null, name: 'A folder', path: '/c' },
  ];

  it('builds a sorted tree and resolves descendant scope', () => {
    const tree = folderTree(folders);
    expect(tree.map((n) => n.name)).toEqual(['A folder', 'B folder']);
    expect(tree[1].children.map((n) => n.id)).toEqual(['b']);
    expect([...folderScope(folders, 'a')].sort()).toEqual(['a', 'b']);
    expect(folderScope(folders, 'missing').size).toBe(0);
  });

  it('formats relative times', () => {
    const now = Date.parse('2026-10-11T12:00:00Z');
    expect(relativeTime('2026-10-11T11:59:50Z', now)).toBe('Just now');
    expect(relativeTime('2026-10-11T11:55:00Z', now)).toBe('5 minutes ago');
    expect(relativeTime('2026-10-01T12:00:00Z', now)).toBe('1 Oct 2026');
  });
});
