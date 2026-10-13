import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { Markdown, parseBlocks } from './Markdown.jsx';

const pages = [{ slug: 'rag-pipeline', path: 'docs/guide/rag-pipeline.md', title: 'RAG pipeline', section: 'AI/ML' }];

function renderMd(body, extra = {}) {
  const ctx = { fromFile: 'docs/guide/a.md', pages, pageHref: (p) => `/app/docs/${p.slug}`, images: {}, ...extra };
  return render(
    <MemoryRouter>
      <Markdown body={body} ctx={ctx} />
    </MemoryRouter>,
  );
}

describe('parseBlocks', () => {
  it('splits headings, paragraphs, lists with continuation lines, tables, code and images', () => {
    const blocks = parseBlocks(
      [
        '## Cost & ledger',
        'First line',
        'second line.',
        '',
        '- one',
        '  continued',
        '- two',
        '',
        '| A | B |',
        '| --- | --- |',
        '| `x \\| y` | 2 |',
        '',
        '```bash',
        'pnpm dev',
        '',
        '## not a heading',
        '```',
        '![Shot](../screenshots/home.png)',
      ].join('\n'),
    );
    expect(blocks).toEqual([
      { type: 'heading', level: 2, text: 'Cost & ledger', id: 'cost--ledger' },
      { type: 'paragraph', text: 'First line second line.' },
      { type: 'list', ordered: false, items: ['one continued', 'two'] },
      { type: 'table', head: ['A', 'B'], rows: [['`x | y`', '2']] },
      { type: 'code', lang: 'bash', text: 'pnpm dev\n\n## not a heading' },
      { type: 'image', alt: 'Shot', src: '../screenshots/home.png' },
    ]);
  });
});

describe('Markdown', () => {
  it('renders inline code, emphasis and resolved links', () => {
    renderMd(
      'See [RAG](rag-pipeline.md#chunks), the [log](../planning/DECISION_LOG.md), [web](https://example.com), ' +
        '[gallery](/app/docs/design), [notes](../../ml-notebooks/README.md), **bold** and *quiet* `code`.',
    );
    expect(screen.getByRole('link', { name: 'RAG' })).toHaveAttribute('href', '/app/docs/rag-pipeline#chunks');
    expect(screen.getByRole('link', { name: 'log' })).toHaveAttribute('href', '/docs/project/decision-log/');
    expect(screen.getByRole('link', { name: 'web' })).toHaveAttribute('target', '_blank');
    expect(screen.getByRole('link', { name: 'gallery' })).toHaveAttribute('href', '/app/docs/design');
    expect(screen.queryByRole('link', { name: 'notes' })).toBeNull();
    expect(screen.getByText('ml-notebooks/README.md').tagName).toBe('CODE');
    expect(screen.getByText('bold').tagName).toBe('STRONG');
    expect(screen.getByText('quiet').tagName).toBe('EM');
    expect(screen.getByText('code').tagName).toBe('CODE');
  });

  it('links repository files when a repository URL is configured', () => {
    renderMd('[notes](../../ml-notebooks/README.md)', { repoUrl: 'https://git.example/r/blob/main' });
    expect(screen.getByRole('link', { name: 'notes' })).toHaveAttribute('href', 'https://git.example/r/blob/main/ml-notebooks/README.md');
  });

  it('renders tables with headers and never interprets HTML in the source', () => {
    const { container } = renderMd('| Name | Note |\n| --- | --- |\n| a | <img src=x onerror="alert(1)"> |');
    const table = screen.getByRole('table');
    expect(within(table).getByRole('columnheader', { name: 'Name' })).toBeInTheDocument();
    expect(within(table).getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  it('shows committed screenshots and says when one has not been captured', () => {
    renderMd('![Home screen](../screenshots/home.png)\n\n![Answer](../screenshots/answer.png)', {
      images: { 'docs/screenshots/home.png': '/assets/home.png' },
    });
    expect(screen.getByRole('img', { name: 'Home screen' })).toHaveAttribute('src', '/assets/home.png');
    expect(screen.getByText(/Screenshot not captured yet/)).toHaveTextContent('docs/screenshots/answer.png');
  });
});
