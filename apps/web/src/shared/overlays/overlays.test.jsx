import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { EvidenceDrawer } from './EvidenceDrawer.jsx';
import { FolioLens, LENS_ACTIONS } from './FolioLens.jsx';
import { ModelSelector } from './ModelSelector.jsx';
import { RunReceipt } from './RunReceipt.jsx';
import { formatUsd } from '../format.js';

const citation = (over = {}) => ({
  marker: 'S1',
  state: 'VALID',
  anchorState: 'EXACT',
  title: 'Doc.pdf',
  versionNumber: 1,
  currentVersionNumber: 1,
  locator: 'p. 2',
  quote: 'quoted words',
  ...over,
});

describe('EvidenceDrawer', () => {
  it('shows the quote and states for a valid citation', () => {
    render(<EvidenceDrawer open onOpenChange={() => {}} citation={citation()} />);
    expect(screen.getByRole('dialog', { name: 'Evidence S1' })).toBeInTheDocument();
    expect(screen.getByText('quoted words')).toBeInTheDocument();
    expect(screen.getByText('Verified quote')).toBeInTheDocument();
    expect(screen.getByText('Exact location')).toBeInTheDocument();
  });

  it('notes version drift', () => {
    render(<EvidenceDrawer open onOpenChange={() => {}} citation={citation({ versionNumber: 2, currentVersionNumber: 3 })} />);
    expect(screen.getByText(/Cited from v2/)).toBeInTheDocument();
  });

  it.each([
    ['PERMISSION_REVOKED', /no longer have access/],
    ['SOURCE_PURGED', /permanently deleted/],
  ])('hides the quote when %s', (state, msg) => {
    render(<EvidenceDrawer open onOpenChange={() => {}} citation={citation({ state })} />);
    expect(screen.queryByText('quoted words')).toBeNull();
    expect(screen.getByText(msg)).toBeInTheDocument();
  });
});

describe('FolioLens', () => {
  const anchor = { left: 100, top: 100, bottom: 120, width: 50 };

  it('lists context actions, runs one and closes on Escape', () => {
    const onAction = vi.fn();
    const onClose = vi.fn();
    render(<FolioLens open kind="W" text="selected" anchor={anchor} onAction={onAction} onClose={onClose} autoFocus />);
    const items = screen.getAllByRole('menuitem');
    expect(items).toHaveLength(LENS_ACTIONS.W.length);
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.click(items[1]);
    expect(onAction).toHaveBeenCalledWith('tighten');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it.each([
    [{ phase: 'abstain' }, 'Not enough evidence'],
    [{ phase: 'error', message: 'Provider down' }, 'Provider down'],
    [{ phase: 'streaming', text: 'partial answer' }, 'partial answer'],
  ])('renders result state %o', (result, text) => {
    render(<FolioLens open kind="R" text="x" anchor={anchor} result={result} onAction={() => {}} onClose={() => {}} />);
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('closes on outside pointer down', () => {
    const onClose = vi.fn();
    render(<FolioLens open kind="K" text="x" anchor={anchor} onAction={() => {}} onClose={onClose} />);
    fireEvent.pointerDown(document.body);
    expect(onClose).toHaveBeenCalled();
  });
});

describe('RunReceipt', () => {
  const receipt = {
    run: { id: 'run_1', graph: 'grounded_qa', tier: 'T1', status: 'SUCCEEDED', outcome: 'ANSWERED', isDemo: true, durationMs: 1500 },
    modelPlan: { primary: { provider: 'mock', model: 'mock-grounded' } },
    modelCalls: [
      { provider: 'mock', model: 'a', attempt: 1, status: 'FAILED' },
      { provider: 'mock', model: 'mock-grounded', attempt: 2, status: 'SUCCEEDED' },
    ],
    tokens: { input: 1000, cachedInput: 0, output: 50, reasoning: 0 },
    cost: { total: '0.00014550', estimate: null, tier: 'FINALIZED', isDemo: true },
    citations: { total: 1, byState: { VALID: 1 } },
  };

  it('shows a collapsed summary and expands to details', () => {
    render(
      <MemoryRouter>
        <RunReceipt receipt={receipt} />
      </MemoryRouter>,
    );
    const toggle = screen.getByRole('button', { name: /Run receipt/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).toHaveTextContent('DEMO $0.0001455');
    fireEvent.click(toggle);
    expect(screen.getByText('mock · mock-grounded')).toBeInTheDocument();
    expect(screen.getByText(/after 1 fallback attempt/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Developer Studio/ })).toHaveAttribute('href', '/app/studio/runs/run_1');
    expect(screen.getByText(/Model reasoning is never displayed/)).toBeInTheDocument();
  });
});

describe('ModelSelector', () => {
  it('offers auto plus registry models and flags missing prices', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <ModelSelector options={[{ id: 'm1', label: 'm1', provider: 'local', priced: false }]} value="auto" onChange={onChange} />,
    );
    const select = screen.getByLabelText('Model');
    fireEvent.change(select, { target: { value: 'm1' } });
    expect(onChange).toHaveBeenCalledWith('m1');
    rerender(<ModelSelector options={[{ id: 'm1', label: 'm1', provider: 'local', priced: false }]} value="m1" onChange={onChange} />);
    expect(screen.getByText(/No price entered/)).toBeInTheDocument();
  });

  it('explains an empty registry', () => {
    render(<ModelSelector options={[]} value="auto" onChange={() => {}} />);
    expect(screen.getByText(/No models configured/)).toBeInTheDocument();
  });
});

describe('formatUsd', () => {
  it('formats decimal strings without float drift', () => {
    expect(formatUsd('0.00014550')).toBe('$0.0001455');
    expect(formatUsd('12.5')).toBe('$12.5000');
    expect(formatUsd('1234.00000000')).toBe('$1,234.0000');
    expect(formatUsd(null)).toBe('—');
  });
});
