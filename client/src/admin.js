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
    return { error: data.error || 'unknown_error' };
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
