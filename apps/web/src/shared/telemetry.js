/**
 * Browser tracing hooks. Everything here is a no-op until initTelemetry() loads the
 * OpenTelemetry web SDK, which only happens in builds with VITE_OTEL_ENABLED=true.
 */

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Route template plus fv.* attributes for an /api path. Ids become `:id` so span names stay
 * low-cardinality, and query strings (which can hold search text) are dropped.
 * @param {string} path
 */
export function describeApiPath(path) {
  const clean = path.split('?')[0];
  /** @type {Record<string, string>} */
  const attrs = {};
  const ws = clean.match(/\/workspaces\/([0-9a-f-]{36})/i);
  if (ws) attrs['fv.workspace_id'] = ws[1];
  const run = clean.match(/\/runs\/([0-9a-f-]{36})/i);
  if (run) attrs['fv.run_id'] = run[1];
  return { route: clean.replace(UUID, ':id'), attrs };
}

/** @type {null | ((path: string, fn: (t: { headers: Record<string,string>, tick: () => void }) => Promise<number>) => Promise<number>)} */
let sseHook = null;

/**
 * Wraps one SSE connection in a span. `headers` carries the traceparent to send; `tick` counts events.
 * @param {string} path
 * @param {(t: { headers: Record<string,string>, tick: () => void }) => Promise<number>} fn
 */
export function traceSse(path, fn) {
  return sseHook ? sseHook(path, fn) : fn({ headers: {}, tick: () => {} });
}

export async function initTelemetry() {
  if (import.meta.env.VITE_OTEL_ENABLED !== 'true') return;
  const { startWebTracing } = await import('./otel.js');
  sseHook = startWebTracing();
}
