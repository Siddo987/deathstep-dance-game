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

export const register = (email, username, password, displayName, ref) => request('register', { email, username, password, displayName, ref });

// identifier is either the account's email or its username - email is
// optional at registration (see Auth.jsx), so login can no longer assume
// it's always what was typed.
export const login = (identifier, password) => request('login', { identifier, password });

export const loginWithGoogle = (credential, ref) => request('google', { credential, ref });

// Always resolves to { success: true } regardless of whether identifier
// matched anything - the server deliberately never reveals that (see
// server/auth.js's /forgot-password) to avoid leaking which emails/usernames
// are registered.
export const forgotPassword = (identifier) => request('forgot-password', { identifier });

export const resetPassword = (token, newPassword) => request('reset-password', { token, newPassword });

export const logout = () => request('logout', {});

export const updateSettings = (payload) => request('me', payload, 'PUT');

// Irreversible - the server deletes the account row (cascading to everything
// personal that hangs off it) and clears the login cookie in the same
// response, so the caller only has to send the user somewhere public
// afterwards. `password` is required for accounts that have one (see
// currentUser.hasPassword / server/auth.js's DELETE /me) and ignored for
// Google-only signups.
export const deleteAccount = (password) => request('me', { password }, 'DELETE');

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
