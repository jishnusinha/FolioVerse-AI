/** Same-origin JSON client. Auth is cookie-based; mutating requests carry the double-submit CSRF header. */

export class ApiError extends Error {
  /** @param {number} status @param {any} problem */
  constructor(status, problem) {
    super(problem?.detail || problem?.title || `Request failed (${status})`);
    this.status = status;
    this.problem = problem;
    this.code = problem?.code;
  }
}

export function readCookie(name) {
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`));
  return m ? decodeURIComponent(m[1]) : undefined;
}

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);
let refreshing = null;

async function refresh() {
  refreshing ??= fetch('/api/auth/refresh', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'x-csrf-token': readCookie('fv_csrf') ?? '' },
  }).finally(() => {
    refreshing = null;
  });
  const res = await refreshing;
  return res.ok;
}

/**
 * @param {string} path  path below /api, e.g. `/auth/me`
 * @param {{ method?: string, body?: any, headers?: Record<string,string>, signal?: AbortSignal, retry?: boolean }} [opts]
 */
export async function api(path, opts = {}) {
  const method = (opts.method || 'GET').toUpperCase();
  const headers = { accept: 'application/json', ...opts.headers };
  let body;
  if (opts.body instanceof FormData || opts.body instanceof Blob) body = opts.body;
  else if (opts.body !== undefined) {
    headers['content-type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  if (!SAFE.has(method)) headers['x-csrf-token'] = readCookie('fv_csrf') ?? '';

  const res = await fetch(`/api${path}`, { method, headers, body, credentials: 'same-origin', signal: opts.signal });
  if (res.status === 401 && opts.retry !== false && !path.startsWith('/auth/')) {
    if (await refresh()) return api(path, { ...opts, retry: false });
  }
  if (res.status === 204) return undefined;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, typeof data === 'string' ? { detail: data } : data);
  return data;
}
