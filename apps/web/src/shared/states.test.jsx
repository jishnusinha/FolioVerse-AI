import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import schema from '@folioverse/contracts/schemas/states.schema.json';
import { CONTRACT_ENUMS, STATES, stageSegments, stateOf } from './states.js';
import { StageTrack, StatusBadge } from './StatusBadge.jsx';

const TONES = new Set(['ok', 'warn', 'bad', 'info', 'ai', 'neutral']);

describe('state vocabularies', () => {
  it.each(Object.entries(CONTRACT_ENUMS))('%s matches contract enum %s', (family, enumName) => {
    expect(Object.keys(STATES[family]).sort()).toEqual([...schema.$defs[enumName].enum].sort());
  });

  for (const [family, values] of Object.entries(STATES)) {
    it.each(Object.keys(values))(`${family}.%s renders a toned badge with a label`, (value) => {
      const s = stateOf(family, value);
      expect(TONES.has(s.tone)).toBe(true);
      expect(s.label.length).toBeGreaterThan(0);
      render(<StatusBadge family={family} value={value} />);
      const badge = screen.getByText(s.label).closest('.badge');
      expect(badge).toHaveAttribute('data-tone', s.tone);
      expect(badge.getAttribute('title')).toContain(value);
    });
  }

  it('falls back to a neutral badge for unknown values', () => {
    render(<StatusBadge family="run" value="SOMETHING_NEW" />);
    expect(screen.getByText('SOMETHING_NEW')).toHaveAttribute('data-tone', 'neutral');
  });
});

describe('stage track', () => {
  it('marks completed, current and failed stages', () => {
    expect(stageSegments('READY')).toEqual(['done', 'done', 'done', 'done', 'done', 'done']);
    expect(stageSegments('INDEXING')).toEqual(['done', 'done', 'done', 'done', 'now', '']);
    expect(stageSegments('PARTIAL').at(-1)).toBe('warn');
    expect(stageSegments('QUARANTINED')[1]).toBe('bad');
    expect(stageSegments('FAILED')[3]).toBe('bad');
  });

  it('exposes the stage as an accessible image', () => {
    render(<StageTrack state="SCANNING" labels />);
    expect(screen.getByRole('img', { name: 'Pipeline stage: Scanning' })).toBeInTheDocument();
  });
});
