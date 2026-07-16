// Thin wrappers around the /api/auth/* endpoints. Every call sends cookies
// (the login session lives in an httpOnly cookie, never in localStorage) and
// returns { user } / { error } as sent by the server - callers translate
// `error` codes via i18n ('auth.error.<code>').
async function request(path, body, method = 'POST') {
  const response = await fetch(`/api/auth/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: data.error || 'unknown_error' };
  }
  return data;
}

export const register = (email, password, displayName) => request('register', { email, password, displayName });

export const login = (email, password) => request('login', { email, password });

export const loginWithGoogle = (credential) => request('google', { credential });

export const logout = () => request('logout', {});

export const updateSettings = (payload) => request('me', payload, 'PUT');

export async function fetchMe() {
  try {
    const response = await fetch('/api/auth/me', { credentials: 'include' });
    if (!response.ok) return null;
    const data = await response.json();
    return data.user || null;
  } catch (err) {
    return null;
  }
}

export async function fetchMyStats() {
  try {
    const response = await fetch('/api/stats/me', { credentials: 'include' });
    if (!response.ok) return null;
    const data = await response.json();
    return data.stats || null;
  } catch (err) {
    return null;
  }
}

// Public endpoint - no cookies needed, anyone can view the leaderboard.
// Returns { players, hosts } - two independent rankings (see server/stats.js).
export async function fetchLeaderboard() {
  try {
    const response = await fetch('/api/stats/leaderboard');
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    return null;
  }
}
