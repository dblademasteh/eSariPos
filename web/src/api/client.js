let authToken = null;
let onUnauthorized = null;

export const setAuthToken = (v) => {
  authToken = v;
};

export const getAuthToken = () => authToken;

export const setOnUnauthorized = (fn) => {
  onUnauthorized = fn;
};

function buildQuery(query) {
  if (!query) return '';
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== '' && value !== null && value !== undefined) params.set(key, value);
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

// Exchanges the httpOnly refresh cookie for a fresh access token and rotates it.
export async function refreshSession() {
  try {
    const res = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.token) {
      authToken = data.token;
      return data;
    }
  } catch {
    // offline - fall through
  }
  return null;
}

export async function logoutRequest() {
  try {
    await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
  } catch {}
  authToken = null;
}

export async function api(path, { method = 'GET', body, query } = {}) {
  const send = () =>
    fetch(`/api${path}${buildQuery(query)}`, {
      method,
      credentials: 'include',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

  let res = await send();

  // Access token expired: rotate the refresh cookie once, then replay.
  if (res.status === 401 && !path.startsWith('/auth/') && path !== '/auth/refresh') {
    const refreshed = await refreshSession();
    if (refreshed) res = await send();
  }

  if (res.status === 401 && onUnauthorized && !path.startsWith('/auth/')) {
    onUnauthorized();
    throw Object.assign(new Error('Session expired'), { status: 401 });
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    err.details = data.details ?? data.issues;
    throw err;
  }
  return data;
}
