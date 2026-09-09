/**
 * API client with auto-CSRF injection and session handling.
 */

let csrfToken = null;

export function setCSRF(token) { csrfToken = token; }
export function getCSRF() { return csrfToken; }

async function apiFetch(url, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (csrfToken && ['POST','PUT','PATCH','DELETE'].includes((options.method ?? 'GET').toUpperCase())) {
    headers['X-CSRF-Token'] = csrfToken;
  }

  const res = await fetch(url, { credentials: 'include', ...options, headers });

  if (res.status === 401) {
    window.dispatchEvent(new Event('iqpanel:logout'));
    throw new Error('Unauthenticated');
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error ?? 'Request failed'), { status: res.status, data });
  return data;
}

export const api = {
  get:    (url, opts)          => apiFetch(url, { method: 'GET', ...opts }),
  post:   (url, body, opts)    => apiFetch(url, { method: 'POST',   body: JSON.stringify(body), ...opts }),
  put:    (url, body, opts)    => apiFetch(url, { method: 'PUT',    body: JSON.stringify(body), ...opts }),
  patch:  (url, body, opts)    => apiFetch(url, { method: 'PATCH',  body: JSON.stringify(body), ...opts }),
  delete: (url, body, opts)    => apiFetch(url, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined, ...opts }),
};

/**
 * Subscribe to a Server-Sent Events endpoint.
 * Returns a cleanup function.
 */
export function subscribeSSE(url, handlers = {}) {
  const es = new EventSource(url, { withCredentials: true });
  for (const [event, fn] of Object.entries(handlers)) {
    es.addEventListener(event, (e) => fn(JSON.parse(e.data)));
  }
  es.onerror = (e) => handlers.error?.(e);
  return () => es.close();
}
