// Fetch wrappers for the hidden /api/admin/* endpoints (see server/admin.js),
// used by the admin menu item in GMDashboard.jsx. Same pattern as
// spotifyPlaylists.js: cookie session, { error } on failure. Every route
// 404s for anyone not listed in admin_users, same as a route that doesn't
// exist - this menu item is only rendered for a super-admin account anyway.

async function request(url, options = {}) {
  const response = await fetch(url, {
    credentials: 'include',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    ...options,
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // Spread data first so e.g. a 429's retryAfterSeconds survives alongside
    // error - some callers (fallback-playlist import) need more than just
    // the error code to show a specific enough message.
    return { ...data, error: data.error || 'unknown_error' };
  }
  return data;
}

export const fetchAdminOverrides = (roomId) => request(`/api/admin/rooms/${roomId}/overrides`);

export const addPairOverride = (roomId, playerIdA, playerIdB) =>
  request(`/api/admin/rooms/${roomId}/pair-override`, { method: 'POST', body: JSON.stringify({ playerIdA, playerIdB }) });

export const removePairOverride = (roomId, index) =>
  request(`/api/admin/rooms/${roomId}/pair-override/${index}`, { method: 'DELETE' });

export const addKillerOverride = (roomId, playerId) =>
  request(`/api/admin/rooms/${roomId}/killer-override`, { method: 'POST', body: JSON.stringify({ playerId }) });

export const removeKillerOverride = (roomId, playerId) =>
  request(`/api/admin/rooms/${roomId}/killer-override/${playerId}`, { method: 'DELETE' });

// --- Dev Dashboard (also gated on admin_users - see server/admin.js) ---

export const fetchFeedbackList = () => request('/api/admin/feedback');

export const fetchUnreadFeedbackCount = () => request('/api/admin/feedback/unread-count');

export const markFeedbackRead = (id) => request(`/api/admin/feedback/${id}/read`, { method: 'POST', body: '{}' });

export const deleteFeedbackEntry = (id) => request(`/api/admin/feedback/${id}`, { method: 'DELETE' });

export const fetchDevSettings = () => request('/api/admin/dev-settings');

export const updateDevSettings = (killerRatioDivisor) =>
  request('/api/admin/dev-settings', { method: 'PUT', body: JSON.stringify({ killerRatioDivisor }) });

// Public (no admin_users gate) - every GM's dashboard needs the current
// divisor to compute its own killer-count suggestion, not just developers.
export const fetchKillerRatio = () => request('/api/dev-settings/killer-ratio');

// Dev-curated fallback songs (see server/db.js's fallback_songs table) -
// offered to any GM who bypasses the "song ready" lock with no track
// selected at all (client/src/spotifyPlaylists.js's fetchRandomFallbackSong,
// public/no admin_users gate, used from GMDashboard.jsx).
export const fetchFallbackSongs = () => request('/api/admin/fallback-songs');

export const addFallbackSong = (url) =>
  request('/api/admin/fallback-songs', { method: 'POST', body: JSON.stringify({ url }) });

// Needs the calling dev's own account-linked Spotify connection (Settings/
// Playlists) to actually read the playlist's tracks - unlike addFallbackSong
// above, which only needs public oEmbed metadata for a single track link.
export const importFallbackPlaylist = (url) =>
  request('/api/admin/fallback-songs/import-playlist', { method: 'POST', body: JSON.stringify({ url }) });

export const deleteFallbackSong = (id) => request(`/api/admin/fallback-songs/${id}`, { method: 'DELETE' });

// Browsable history of every concluded/aborted game (see server/admin.js's
// /games routes and server/stats.js's recordGameHistory, the one place that
// writes any of it). List is paginated (offset-based, see server/admin.js);
// detail is fetched separately per game, only once a dev actually opens one.
export const fetchGamesList = (limit, offset) => request(`/api/admin/games?limit=${limit}&offset=${offset}`);

export const fetchGameDetail = (id) => request(`/api/admin/games/${id}`);

// News posts (see server/db.js's news_posts) - written and optionally
// emailed to every registered account from the Dev Dashboard. The list
// response also embeds each post's per-recipient send log (news_recipients:
// email/success/sentAt) for later review.
export const fetchNewsList = () => request('/api/admin/news');

export const sendNewsPost = (title, body, sendEmail) =>
  request('/api/admin/news', { method: 'POST', body: JSON.stringify({ title, body, sendEmail }) });

export const deleteNewsPost = (id) => request(`/api/admin/news/${id}`, { method: 'DELETE' });

// Roadmap items (see server/db.js's roadmap_items) - the dev-panel editor.
// The public /roadmap page reads the same data back through an
// unauthenticated route (fetchPublicRoadmap below), not this one.
export const fetchRoadmapItems = () => request('/api/admin/roadmap-items');

export const addRoadmapItem = (title, description, status) =>
  request('/api/admin/roadmap-items', { method: 'POST', body: JSON.stringify({ title, description, status }) });

export const updateRoadmapItem = (id, title, description, status) =>
  request(`/api/admin/roadmap-items/${id}`, { method: 'PUT', body: JSON.stringify({ title, description, status }) });

export const deleteRoadmapItem = (id) => request(`/api/admin/roadmap-items/${id}`, { method: 'DELETE' });

export const moveRoadmapItem = (id, direction) =>
  request(`/api/admin/roadmap-items/${id}/move`, { method: 'POST', body: JSON.stringify({ direction }) });

// Public (no admin_users gate) - the /roadmap page anyone can view.
export const fetchPublicRoadmap = () => request('/api/roadmap');
