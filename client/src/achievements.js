// Fetch wrappers for /api/achievements/* (see server/achievements.js). Same
// pattern as auth.js/spotifyPlaylists.js: cookie session, { error } on failure.

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    return { error: data.error || 'unknown_error' };
  }
  return data;
}

export const fetchMyAchievements = () => request('/api/achievements/me');

export const fetchAchievementPlayers = (key) => request(`/api/achievements/${encodeURIComponent(key)}/players`);
