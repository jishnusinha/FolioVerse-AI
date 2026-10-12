/**
 * State vocabularies (values must match packages/contracts/schemas/states.schema.json).
 * Each entry: [tone, glyph, label, description]. Tone maps to badge colours via data-tone.
 */

/** @typedef {'ok'|'warn'|'bad'|'info'|'ai'|'neutral'} Tone */
/** @typedef {[Tone, string, string, string]} StateDef */

/** @type {Record<string, Record<string, StateDef>>} */
export const STATES = {
  ingest: {
    UPLOADING: ['info', '◐', 'Uploading', 'Bytes transferring to storage'],
    UPLOADED: ['info', '◐', 'Uploaded', 'Awaiting safety scan'],
    SCANNING: ['info', '◐', 'Scanning', 'Type and malware checks'],
    PREVIEW_READY: ['ai', '◑', 'Preview ready', 'Readable now; AI indexing continues'],
    PARSING: ['info', '◐', 'Parsing', 'Extracting pages and structure'],
    INDEXING: ['info', '◐', 'Indexing', 'Chunking, embedding, indexing'],
    READY: ['ok', '✓', 'Ready', 'Searchable and citable'],
    PARTIAL: ['warn', '!', 'Partial', 'Some pages could not be processed'],
    FAILED: ['bad', '×', 'Failed', 'Processing stopped; retry available'],
    QUARANTINED: ['bad', '⊘', 'Quarantined', 'Blocked by safety policy'],
  },
  run: {
    QUEUED: ['neutral', '○', 'Queued', 'Waiting for a worker'],
    RUNNING: ['info', '◐', 'Running', 'Workflow executing'],
    STREAMING: ['ai', '◆', 'Streaming', 'Answer arriving token by token'],
    AWAITING_INPUT: ['warn', '‖', 'Awaiting your input', 'Paused for human approval'],
    SUCCEEDED: ['ok', '✓', 'Succeeded', 'Completed'],
    PARTIAL: ['warn', '!', 'Partial', 'Completed with gaps'],
    FAILED: ['bad', '×', 'Failed', 'Stopped with an error'],
    CANCELLED: ['neutral', '–', 'Cancelled', 'Stopped by user'],
    INTERRUPTED: ['warn', '↯', 'Interrupted', 'Worker stopped; resumable from checkpoint'],
    BUDGET_REJECTED: ['bad', '$', 'Budget limit', 'Rejected before any model call'],
  },
  outcome: {
    ANSWERED: ['ok', '✓', 'Answered', 'Grounded answer with citations'],
    ABSTAINED: ['neutral', '∅', 'Not enough evidence', 'No answer generated'],
    PARTIAL: ['warn', '!', 'Partially answered', 'Some claims unsupported'],
  },
  cite: {
    VALID: ['ok', '✓', 'Verified quote', 'Quote found at this location in this version'],
    WEAK: ['warn', '~', 'Weak support', 'Quote exists but matches the claim weakly'],
    UNRESOLVED: ['bad', '?', 'Unresolved', 'Quote not found in the stored version'],
    PERMISSION_REVOKED: ['neutral', '⊘', 'Access revoked', 'You can no longer view this source'],
    SOURCE_PURGED: ['neutral', '⌫', 'Source deleted', 'Source permanently removed'],
  },
  anchor: {
    EXACT: ['ok', '≡', 'Exact location', 'The quote is at the recorded location'],
    SHIFTED: ['info', '↕', 'Shifted location', 'The quote moved within the document'],
    FUZZY: ['warn', '≈', 'Fuzzy match', 'Only an approximate match was found'],
    ORPHANED: ['bad', '∅', 'Location lost', 'The quote can no longer be located'],
  },
  sugg: {
    PENDING: ['ai', '◆', 'Pending review', 'Waiting for your decision'],
    ACCEPTED: ['ok', '✓', 'Accepted', 'Applied to the text'],
    REJECTED: ['neutral', '×', 'Rejected', 'Dismissed'],
    STALE: ['warn', '!', 'Stale — text changed', 'The text changed after the suggestion'],
    SUPERSEDED: ['neutral', '↻', 'Superseded', 'Replaced by a newer suggestion'],
  },
  cost: {
    PREFLIGHT_ESTIMATE: ['neutral', '≤', 'Preflight estimate', 'Upper bound reserved before running'],
    LIVE_ESTIMATE: ['ai', '≈', 'Live estimate', 'Updating while tokens stream'],
    FINALIZED: ['ok', '✓', 'Finalized', 'Calculated from provider-reported usage'],
    FINAL_ESTIMATED: ['warn', '≈', 'Final (estimated)', 'Provider usage unavailable; estimated'],
    RECONCILED: ['ok', '⇄', 'Reconciled', 'Matches provider billing report'],
    VARIANCE: ['bad', 'Δ', 'Variance', 'Differs from provider report'],
  },
  dna: {
    CANON: ['ok', '■', 'Canon', 'Established story fact'],
    PROPOSED: ['ai', '◇', 'Proposed', 'Awaiting the author’s decision'],
    RETIRED: ['neutral', '□', 'Retired', 'No longer part of canon'],
  },
  origin: {
    AUTHOR: ['neutral', '✎', 'Author', 'Written by the author'],
    AI_EXTRACTED: ['ai', '◆', 'AI-extracted', 'Proposed by an AI extraction run'],
  },
};

/** Contract enum name for each vocabulary (states.schema.json `$defs`). */
export const CONTRACT_ENUMS = {
  ingest: 'IngestionState',
  run: 'RunStatus',
  outcome: 'RunOutcome',
  cite: 'CitationState',
  anchor: 'AnchorState',
  sugg: 'SuggestionState',
  cost: 'CostTier',
  dna: 'DnaStatus',
  origin: 'DnaOrigin',
};

/**
 * @param {keyof typeof STATES} family
 * @param {string} value
 * @returns {{ tone: Tone, glyph: string, label: string, description: string } | null}
 */
export function stateOf(family, value) {
  const def = STATES[family]?.[value];
  if (!def) return null;
  const [tone, glyph, label, description] = def;
  return { tone, glyph, label, description };
}

/** Ingestion pipeline stages shown by StageTrack. */
export const STAGES = ['Upload', 'Scan', 'Preview', 'Parse', 'Index', 'Ready'];
const STAGE_POS = {
  UPLOADING: 0,
  UPLOADED: 1,
  SCANNING: 1,
  PREVIEW_READY: 3,
  PARSING: 3,
  INDEXING: 4,
  READY: 6,
  PARTIAL: 5,
  FAILED: 3,
  QUARANTINED: 1,
};

/**
 * Per-stage segment classes for an ingestion state: '', 'done', 'now', 'warn' or 'bad'.
 * @param {string} state
 */
export function stageSegments(state) {
  const p = STAGE_POS[state] ?? 0;
  return STAGES.map((_, i) => {
    if (state === 'PARTIAL' && i === 5) return 'warn';
    if ((state === 'FAILED' || state === 'QUARANTINED') && i === p) return 'bad';
    if (i < p) return 'done';
    if (i === p) return 'now';
    return '';
  });
}

export const BUSY_INGEST = new Set(['UPLOADING', 'UPLOADED', 'SCANNING', 'PREVIEW_READY', 'PARSING', 'INDEXING']);
