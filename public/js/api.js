async function request(method, path, body) {
  const res = await fetch(`/api${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  if (res.status === 401) { location.href = '/login'; throw new Error('Sign in required'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// 15s cache for GETs (warmed by hover prefetch); any write clears it.
const cache = new Map();
function cachedGet(p, { fresh = false } = {}) {
  const hit = cache.get(p);
  if (!fresh && hit && Date.now() - hit.t < 15000) return hit.p;
  const pr = request('GET', p);
  cache.set(p, { t: Date.now(), p: pr });
  pr.catch(() => cache.delete(p));
  return pr;
}
const write = (m) => (p, b) => { cache.clear(); return request(m, p, b); };

export const api = {
  get: cachedGet,
  post: (p, b = {}) => write('POST')(p, b),
  put: (p, b = {}) => write('PUT')(p, b),
  patch: (p, b = {}) => write('PATCH')(p, b),
  del: (p, b) => write('DELETE')(p, b),
  // A write that changes nothing another view shows (marking a story viewed): it keeps the GET cache warm.
  mark: (p, b = {}) => request('POST', p, b),
  clear: () => cache.clear()
};
