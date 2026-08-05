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

// Short-lived playback access token minted from this account's server-side
// connection - see client/src/spotify.js's getValidAccountLinkedToken.
export const fetchSpotifyAccessToken = () => request('/api/spotify/token');

export const searchSpotifyTracks = (query) => request(`/api/spotify/search?q=${encodeURIComponent(query)}`);

// Public (no login needed) search that runs through whichever GM/co-GM in
// the room has a working Spotify connection - see server/index.js. Lets
// players suggest real tracks without connecting their own Spotify account.
export const searchTracksInRoom = (roomId, query) => request(`/api/rooms/${roomId}/spotify-search?q=${encodeURIComponent(query)}`);

// Public (no login needed, same room-code trust boundary as searchTracksInRoom)
// playback token minted from whichever player has currently lent their
// account-linked Spotify connection to this room - see gameStore.js's
// spotifyDelegate and GMDashboard.jsx's getPlaybackToken.
export const fetchRoomSpotifyToken = (roomId) => request(`/api/rooms/${roomId}/spotify-token`);

// Public (no login needed, same room-code trust boundary) - the room's
// current delegate's own Spotify playlists/tracks, so GMDashboard.jsx can
// offer them in the "add to queue" picker even though they live under a
// different (or no) Deathstep account than the GM's own.
export const fetchRoomSpotifyPlaylists = (roomId) => request(`/api/rooms/${roomId}/spotify-playlists`);
export const fetchRoomSpotifyPlaylistTracks = (roomId, playlistId) => request(`/api/rooms/${roomId}/spotify-playlists/${encodeURIComponent(playlistId)}/tracks`);

// Public (no login needed, same room-code trust boundary) - the room's
// current delegate's own Deathstep-app playlists (server/playlists.js's
// DB-stored `playlists` table), not Spotify's live data - the one set of
// playlists fetchRoomSpotifyPlaylists can never show, since an app-only
// playlist (never linked to a real Spotify playlist) doesn't exist on
// Spotify's side at all.
export const fetchRoomDeathstepPlaylists = (roomId) => request(`/api/rooms/${roomId}/deathstep-playlists`);
export const fetchRoomDeathstepPlaylistTracks = (roomId, playlistId) => request(`/api/rooms/${roomId}/deathstep-playlists/${encodeURIComponent(playlistId)}/tracks`);

// Public (no login needed) - a random pick from the dev-curated fallback
// list (server/db.js's fallback_songs table), offered to a GM who bypasses
// the "song ready" lock with no track selected at all - see
// GMDashboard.jsx's handleBypassSongReady. { track: null } if the list is
// empty or the DB is unavailable.
export const fetchRandomFallbackSong = () => request('/api/fallback-songs/random');

// --- Own (in-app) playlists ---

export const fetchMyPlaylists = () => request('/api/playlists');

export const fetchPlaylist = (id) => request(`/api/playlists/${id}`);

export const createPlaylist = (name) => request('/api/playlists', { method: 'POST', body: JSON.stringify({ name }) });

export const deletePlaylist = (id) => request(`/api/playlists/${id}`, { method: 'DELETE' });

export const addTrackToPlaylist = (id, track) => request(`/api/playlists/${id}/tracks`, { method: 'POST', body: JSON.stringify(track) });

export const removeTrackFromPlaylist = (id, trackId) => request(`/api/playlists/${id}/tracks/${trackId}`, { method: 'DELETE' });

export const confirmPendingTrack = (id, trackId) => request(`/api/playlists/${id}/tracks/${trackId}/confirm`, { method: 'POST', body: '{}' });

export const undoDeleteTrack = (id, trackId) => request(`/api/playlists/${id}/tracks/${trackId}/undo-delete`, { method: 'POST', body: '{}' });

export const importSpotifyPlaylist = (spotifyPlaylistId, name) =>
  request('/api/playlists/import', { method: 'POST', body: JSON.stringify({ spotifyPlaylistId, name }) });

export const linkPlaylistToSpotify = (id) => request(`/api/playlists/${id}/link-to-spotify`, { method: 'POST', body: '{}' });

// No Spotify connection needed for either of these - see server/playlists.js's
// import-by-link / tracks/by-link routes (resolved via Spotify's public,
// unauthenticated oEmbed metadata).
export const importPlaylistByLink = (url) => request('/api/playlists/import-by-link', { method: 'POST', body: JSON.stringify({ url }) });

export const addTrackByLink = (playlistId, url) => request(`/api/playlists/${playlistId}/tracks/by-link`, { method: 'POST', body: JSON.stringify({ url }) });
