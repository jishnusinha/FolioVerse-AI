import { stateOf } from '@/shared/states.js';
import { splitCitations } from './runState.js';

/**
 * Answer text with `[S#]` markers rendered as citation chips. Paragraphs are split on blank lines.
 * @param {{ text: string, citations: Record<string, { state: string, anchor?: { state?: string } }>, onCite?: (marker: string) => void }} props
 */
export function CitedText({ text, citations, onCite }) {
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((para, i) => (
      <p key={i}>
        {splitCitations(para).map((seg, j) =>
          seg.type === 'text' ? (
            <span key={j}>{seg.text}</span>
          ) : (
            <CiteChip key={j} marker={seg.marker} citation={citations[seg.marker]} onClick={onCite ? () => onCite(seg.marker) : undefined} />
          ),
        )}
      </p>
    ));
}

/** @param {{ marker: string, citation?: { state: string, anchor?: { state?: string } }, onClick?: () => void }} props */
export function CiteChip({ marker, citation, onClick }) {
  const state = citation?.state ?? 'UNRESOLVED';
  const s = stateOf('cite', state);
  const anchor = citation?.anchor?.state ? stateOf('anchor', citation.anchor.state) : null;
  const label = `Citation ${marker}: ${s?.label ?? state}${anchor ? `, ${anchor.label}` : ''}`;
  return (
    <button type="button" className="cite" data-tone={s?.tone ?? 'neutral'} aria-label={label} title={label} onClick={onClick} disabled={!onClick}>
      {marker}
      <span aria-hidden="true">{s?.glyph}</span>
    </button>
  );
}
