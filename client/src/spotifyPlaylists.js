// Fetch wrappers for /api/spotify/* (the account-level Spotify connection)
// and /api/playlists/* (the app's own, DB-stored playlists). Same pattern as
// client/src/auth.js: cookie session, { error } on failure.

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

// --- Spotify account connection ---

export const fetchSpotifyStatus = () => request('/api/spotify/status');

export const disconnectSpotify = () => request('/api/spotify/disconnect', { method: 'POST', body: '{}' });

export const fetchSpotifyPlaylists = () => request('/api/spotify/playlists');

export const searchSpotifyTracks = (query) => request(`/api/spotify/search?q=${encodeURIComponent(query)}`);

// --- Own (in-app) playlists ---

export const fetchMyPlaylists = () => request('/api/playlists');

export const fetchPlaylist = (id) => request(`/api/playlists/${id}`);

export const createPlaylist = (name) => request('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });

export const deletePlaylist = (id) => request(`/api/playlists/${id}`, { method: 'DELETE' });

export const addTrackToPlaylist = (id, track) => request(`/api/playlists/${id}/tracks`, { method: 'POST', body: JSON.stringify(track) });

export const removeTrackFromPlaylist = (id, trackId) => request(`/api/playlists/${id}/tracks/${trackId}`, { method: 'DELETE' });

export const confirmPendingTrack = (id, trackId) => request(`/api/playlists/${id}/tracks/${trackId}/confirm`, { method: 'POST', body: '{}' });

export const importSpotifyPlaylist = (spotifyPlaylistId, name) =>
  request('/api/playlists/import', { method: 'POST', body: JSON.stringify({ spotifyPlaylistId, name }) });
