import { STAGES, stageSegments, stateOf } from './states.js';
import { cn } from './cn.js';

/**
 * Badge for a state value from one of the shared vocabularies.
 * @param {{ family: string, value: string, className?: string }} props
 */
export function StatusBadge({ family, value, className }) {
  const s = stateOf(family, value);
  if (!s) {
    return (
      <span className={cn('badge', className)} data-tone="neutral" title={value}>
        {value}
      </span>
    );
  }
  return (
    <span className={cn('badge', className)} data-tone={s.tone} title={`${s.description} · ${value}`}>
      <span aria-hidden="true">{s.glyph}</span>
      {s.label}
    </span>
  );
}

/** Generic toned badge for ad-hoc labels. */
export function Badge({ tone = 'neutral', glyph, children, title, className }) {
  return (
    <span className={cn('badge', className)} data-tone={tone} title={title}>
      {glyph && <span aria-hidden="true">{glyph}</span>}
      {children}
    </span>
  );
}

/** Marks fictional or simulated data. */
export function DemoBadge({ simulated = false }) {
  return simulated ? (
    <Badge tone="ai" glyph="◆" title="Simulated locally; no model or service was called">
      SIMULATED
    </Badge>
  ) : (
    <Badge tone="warn" glyph="◇" title="Fictional demo data or mock provider output">
      DEMO
    </Badge>
  );
}

/**
 * Six-segment ingestion pipeline track.
 * @param {{ state: string, labels?: boolean }} props
 */
export function StageTrack({ state, labels = false }) {
  const segs = stageSegments(state);
  const label = stateOf('ingest', state)?.label ?? state;
  return (
    <>
      <div className="stages" role="img" aria-label={`Pipeline stage: ${label}`}>
        {segs.map((c, i) => (
          <i key={STAGES[i]} className={c || undefined} data-stage={STAGES[i]} />
        ))}
      </div>
      {labels && (
        <div className="stage-l" aria-hidden="true">
          {STAGES.map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
      )}
    </>
  );
}
