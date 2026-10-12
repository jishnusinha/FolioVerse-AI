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
/** Endpoints where a 401 means "bad credentials", not "access token expired". */
const NO_REFRESH = /^\/auth\/(login|register|refresh|logout|csrf|forgot-password|reset-password|verify-email)\b/;
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
  if (res.status === 401 && opts.retry !== false && !NO_REFRESH.test(path)) {
    if (await refresh()) return api(path, { ...opts, retry: false });
  }
  if (res.status === 204) return undefined;
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  if (!res.ok) throw new ApiError(res.status, typeof data === 'string' ? { detail: data } : data);
  return data;
}

/** Sets the CSRF cookie if this browser does not have one yet. */
export async function ensureCsrf() {
  if (!readCookie('fv_csrf')) await api('/auth/csrf');
}

/**
 * PUT a file with upload progress. Same-origin targets (proxy mode) get cookies and the CSRF header;
 * presigned storage URLs get neither.
 * @param {{ url: string, method?: string, headers?: Record<string,string> }} target
 * @param {Blob} file
 * @param {{ onProgress?: (pct: number) => void, signal?: AbortSignal }} [opts]
 * @returns {Promise<void>}
 */
export function uploadWithProgress(target, file, opts = {}) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const sameOrigin = target.url.startsWith('/');
    xhr.open(target.method || 'PUT', target.url);
    xhr.withCredentials = sameOrigin;
    for (const [k, v] of Object.entries(target.headers ?? {})) xhr.setRequestHeader(k, v);
    if (sameOrigin) xhr.setRequestHeader('x-csrf-token', readCookie('fv_csrf') ?? '');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        opts.onProgress?.(100);
        resolve();
      } else {
        let problem;
        try {
          problem = JSON.parse(xhr.responseText);
        } catch {
          problem = { detail: xhr.statusText || 'Upload failed' };
        }
        reject(new ApiError(xhr.status, problem));
      }
    };
    xhr.onerror = () => reject(new ApiError(0, { detail: 'Network error during upload' }));
    xhr.onabort = () => reject(new ApiError(0, { detail: 'Upload cancelled', code: 'ABORTED' }));
    opts.signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(file);
  });
}
