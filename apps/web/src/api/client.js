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

/**
 * Fetches a binary resource (e.g. a book file) below /api as an ArrayBuffer.
 * @param {string} path @param {{ signal?: AbortSignal }} [opts]
 */
export async function apiBytes(path, opts = {}) {
  const open = () => fetch(`/api${path}`, { credentials: 'same-origin', signal: opts.signal });
  let res = await open();
  if (res.status === 401 && (await refresh())) res = await open();
  if (!res.ok) throw new ApiError(res.status, { detail: `File could not be loaded (${res.status})` });
  return res.arrayBuffer();
}

/**
 * Downloads a file below /api with the session cookie (a plain link would skip the token refresh) and saves it.
 * @param {string} path @param {string} filename
 */
export async function downloadFile(path, filename) {
  const open = () => fetch(`/api${path}`, { credentials: 'same-origin' });
  let res = await open();
  if (res.status === 401 && (await refresh())) res = await open();
  if (!res.ok) throw new ApiError(res.status, { detail: `Download failed (${res.status})` });
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Splits a text/event-stream buffer into complete events. Returns the parsed events and the unparsed tail.
 * @param {string} buf
 * @returns {{ events: { id?: string, event?: string, data: string }[], rest: string }}
 */
export function parseSse(buf) {
  const events = [];
  const blocks = buf.replace(/\r\n/g, '\n').split('\n\n');
  const rest = blocks.pop() ?? '';
  for (const block of blocks) {
    const ev = { data: '' };
    const data = [];
    for (const line of block.split('\n')) {
      if (!line || line.startsWith(':')) continue;
      const i = line.indexOf(':');
      const field = i < 0 ? line : line.slice(0, i);
      const value = i < 0 ? '' : line.slice(i + 1).replace(/^ /, '');
      if (field === 'data') data.push(value);
      else if (field === 'id') ev.id = value;
      else if (field === 'event') ev.event = value;
    }
    if (data.length) {
      ev.data = data.join('\n');
      events.push(ev);
    }
  }
  return { events, rest };
}

/**
 * Reads one Server-Sent Events response with fetch (cookies, CSRF-free GET, refresh on 401).
 * Resolves with the HTTP status when the server closes the stream; callers reconnect with the last seen id.
 * @param {string} path  path below /api
 * @param {{ lastEventId?: string, signal?: AbortSignal, onEvent: (ev: { id?: string, event?: string, data: string }) => void }} opts
 * @returns {Promise<number>}
 */
export async function readEventStream(path, opts) {
  const open = () =>
    fetch(`/api${path}`, {
      headers: { accept: 'text/event-stream', ...(opts.lastEventId ? { 'last-event-id': opts.lastEventId } : {}) },
      credentials: 'same-origin',
      signal: opts.signal,
    });
  let res = await open();
  if (res.status === 401 && (await refresh())) res = await open();
  if (!res.ok) {
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : { detail: await res.text() };
    throw new ApiError(res.status, data);
  }
  if (res.status === 204) return 204;
  if (!res.body) {
    const { events } = parseSse(`${await res.text()}\n\n`);
    events.forEach(opts.onEvent);
    return res.status;
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const { events, rest } = parseSse(buf);
    buf = rest;
    events.forEach(opts.onEvent);
  }
  const { events } = parseSse(`${buf}\n\n`);
  events.forEach(opts.onEvent);
  return res.status;
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
