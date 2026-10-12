/** Run event folding shared by chat streaming and Studio. Events are EventEnvelopes from `/runs/:id/events`. */

export const TERMINAL_RUN = new Set(['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED', 'INTERRUPTED', 'BUDGET_REJECTED']);
const FINAL_EVENTS = new Set(['run.finished', 'run.failed']);

/** @param {{ status?: string }} [seed] */
export function initialRunState(seed = {}) {
  return {
    status: seed.status ?? 'QUEUED',
    text: '',
    answer: null,
    outcome: null,
    error: null,
    citations: /** @type {Record<string, any>} */ ({}),
    nodes: /** @type {Record<string, { node: string, step: number, status: string, durationMs?: number }>} */ ({}),
    retrieval: null,
    usage: /** @type {any[]} */ ([]),
    events: /** @type {any[]} */ ([]),
    lastEventId: /** @type {string | undefined} */ (undefined),
    done: TERMINAL_RUN.has(seed.status ?? ''),
  };
}

/** True when this envelope ends the run's stream. */
export function isFinalEvent(env) {
  return FINAL_EVENTS.has(env.type) || (env.type === 'run.state' && TERMINAL_RUN.has(env.data?.status));
}

/**
 * Orders stream ids: Redis ids (`<ms>-<seq>`) and persisted replay ids (`p-<seq>`). Returns <0, 0, >0.
 * @param {string} a @param {string} b
 */
export function compareEventIds(a, b) {
  const parse = (id) => (id.startsWith('p-') ? [0, Number(id.slice(2)) || 0] : id.split('-').map(Number));
  const [a1, a2] = parse(a);
  const [b1, b2] = parse(b);
  return a1 - b1 || a2 - b2;
}

/**
 * Folds one envelope into the run state. Ids at or before the last seen id are ignored, so a
 * reconnect that overlaps never duplicates tokens.
 * @param {ReturnType<typeof initialRunState>} s
 * @param {{ id?: string, type: string, data?: any, seq?: number, ts?: string }} env
 */
export function reduceRunEvent(s, env) {
  if (env.id && s.lastEventId && compareEventIds(env.id, s.lastEventId) <= 0) return s;
  const d = env.data ?? {};
  const next = { ...s, lastEventId: env.id ?? s.lastEventId };
  if (env.type !== 'token.delta') next.events = [...s.events, env];
  switch (env.type) {
    case 'run.state':
      next.status = d.status ?? s.status;
      if (TERMINAL_RUN.has(next.status)) next.done = true;
      break;
    case 'token.delta':
      next.text = s.text + (d.text ?? '');
      break;
    case 'node.started':
      next.nodes = { ...s.nodes, [d.node]: { node: d.node, step: d.step, status: 'RUNNING' } };
      break;
    case 'node.finished':
      next.nodes = { ...s.nodes, [d.node]: { node: d.node, step: d.step, status: d.status ?? 'SUCCEEDED', durationMs: d.durationMs } };
      break;
    case 'retrieval.completed':
      next.retrieval = d;
      break;
    case 'citation.validated':
      next.citations = { ...s.citations, [d.marker]: d };
      break;
    case 'usage.recorded':
      next.usage = [...s.usage, d];
      break;
    case 'run.finished':
      next.status = d.status ?? 'SUCCEEDED';
      next.outcome = d.outcome ?? null;
      next.answer = d.answer ?? s.text;
      if (d.error) next.error = d.error;
      next.done = true;
      break;
    case 'run.failed':
      next.status = d.errorClass === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
      next.error = d;
      next.done = true;
      break;
    default:
      break;
  }
  return next;
}

/** Visible answer text: the final answer once known, else what has streamed so far. */
export function visibleText(s) {
  return s.answer ?? s.text;
}

const MARKER = /\[(S\d+)\]/g;

/**
 * Splits answer text into plain segments and citation markers.
 * @param {string} text
 * @returns {({ type: 'text', text: string } | { type: 'cite', marker: string })[]}
 */
export function splitCitations(text) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(MARKER)) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    out.push({ type: 'cite', marker: m[1] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}
