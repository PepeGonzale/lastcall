export class ApiError extends Error {
  constructor(message, payload, status) {
    super(message);
    this.name = 'ApiError';
    this.payload = payload;
    this.status = status;
  }
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: options.body ? { 'content-type': 'application/json' } : undefined,
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
  } catch (error) {
    throw new ApiError('The API is not reachable. Is the server running on port 3333?', null, 0);
  }

  const text = await response.text();
  const payload = text ? safeJson(text) : null;

  if (!response.ok) {
    throw new ApiError(payload?.error ?? `Request failed (${response.status})`, payload, response.status);
  }
  return payload;
}

function safeJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export const api = {
  lots: () => request('/api/lots'),
  health: () => request('/api/health'),
  lot: (lotId) => request(`/api/lots/${encodeURIComponent(lotId)}`),
  timeline: (lotId) => request(`/api/lots/${encodeURIComponent(lotId)}/timeline`),
  bid: (lotId, payload) =>
    request(`/api/lots/${encodeURIComponent(lotId)}/bids`, { method: 'POST', body: payload }),
  chaos: {
    state: () => request('/api/chaos/state'),
    redeliver: (lotId) => request(`/api/chaos/redeliver/${encodeURIComponent(lotId)}`, { method: 'POST' }),
    reorder: (lotId) => request(`/api/chaos/reorder/${encodeURIComponent(lotId)}`, { method: 'POST' }),
    poison: (lotId) => request(`/api/chaos/poison/${encodeURIComponent(lotId)}`, { method: 'POST' }),
    lag: (ms) => request('/api/chaos/lag', { method: 'POST', body: { ms } }),
    pause: () => request('/api/chaos/pause', { method: 'POST' }),
    resume: () => request('/api/chaos/resume', { method: 'POST' }),
    rebuild: () => request('/api/chaos/rebuild', { method: 'POST' }),
    tick: () => request('/api/chaos/tick', { method: 'POST' }),
    closeSweep: () => request('/api/chaos/close-sweep', { method: 'POST' }),
  },
  reset: () => request('/api/demo/reset', { method: 'POST' }),
};
