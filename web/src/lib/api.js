/**
 * API client with auto-CSRF injection, session handling, and POST SSE.
 */

let csrfToken = null;

export function setCSRF(token) { csrfToken = token; }
export function getCSRF() { return csrfToken; }

function authHeaders(extra = {}) {
  const headers = { 'Content-Type': 'application/json', ...extra };
  if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
  return headers;
}

function httpError(data, status) {
  return Object.assign(new Error(data?.error ?? data?.message ?? 'Request failed'), {
    status,
    data,
    code: data?.code,
  });
}

async function apiFetch(url, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase();
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (csrfToken && ['POST','PUT','PATCH','DELETE'].includes(method)) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const res = await fetch(url, { credentials: 'include', ...options, headers });

  if (res.status === 401) {
    window.dispatchEvent(new Event('iqpanel:logout'));
    throw new Error('Unauthenticated');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw httpError(data, res.status);
  return data;
}

export const api = {
  get:    (url, opts)          => apiFetch(url, { method: 'GET', ...opts }),
  post:   (url, body, opts)    => apiFetch(url, { method: 'POST',   body: JSON.stringify(body), ...opts }),
  put:    (url, body, opts)    => apiFetch(url, { method: 'PUT',    body: JSON.stringify(body), ...opts }),
  patch:  (url, body, opts)    => apiFetch(url, { method: 'PATCH',  body: JSON.stringify(body), ...opts }),
  delete: (url, body, opts)    => apiFetch(url, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined, ...opts }),
};

export function sseMessage(d) {
  if (d == null) return 'Unknown error';
  if (typeof d === 'string') return d;
  if (typeof d.message === 'string' && d.message) return d.message;
  if (typeof d.error === 'string' && d.error) return d.error;
  if (typeof d.line === 'string') return d.line;
  return 'Unknown error';
}

function dispatchSseBlock(block, handlers) {
  let event = 'message';
  const dataLines = [];
  for (const raw of block.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (dataLines.length === 0) return;
  const rawData = dataLines.join('\n');
  let parsed;
  try { parsed = JSON.parse(rawData); }
  catch { parsed = { message: rawData }; }
  handlers[event]?.(parsed);
}

/**
 * POST a JSON body and consume a text/event-stream response.
 * Resolves when the stream ends. Rejects on HTTP/JSON errors (including reauth).
 */
export async function postSSE(url, body, handlers = {}) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: authHeaders({ Accept: 'text/event-stream' }),
    body: JSON.stringify(body ?? {}),
  });

  if (res.status === 401) {
    window.dispatchEvent(new Event('iqpanel:logout'));
    throw new Error('Unauthenticated');
  }

  const ct = res.headers.get('content-type') ?? '';
  if (!ct.includes('text/event-stream')) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw httpError(data, res.status);
    handlers.done?.(data);
    return data;
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    let data = {};
    try { data = JSON.parse(text); } catch { data = { error: text || 'Request failed' }; }
    throw httpError(data, res.status);
  }

  const reader = res.body?.getReader();
  if (!reader) {
    handlers.done?.({});
    return;
  }

  const decoder = new TextDecoder();
  let buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const block of parts) dispatchSseBlock(block, handlers);
    }
    if (buf.trim()) dispatchSseBlock(buf, handlers);
  } catch (e) {
    handlers.error?.({ message: e.message ?? 'Stream error' });
    throw e;
  }
}

/**
 * Subscribe to a GET Server-Sent Events endpoint.
 * Returns a cleanup function.
 */
export function subscribeSSE(url, handlers = {}) {
  const es = new EventSource(url, { withCredentials: true });
  for (const [event, fn] of Object.entries(handlers)) {
    es.addEventListener(event, (e) => {
      try { fn(JSON.parse(e.data)); }
      catch { fn({ message: e.data }); }
    });
  }
  es.onerror = () => handlers.error?.({ message: 'Connection lost' });
  return () => es.close();
}
