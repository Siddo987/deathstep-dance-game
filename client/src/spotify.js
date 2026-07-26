import { fetchSpotifyAccessToken } from './spotifyPlaylists.js';

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
// playlist-read-* lets this local, browser-only connection (no Deathstep
// account needed) browse the connected Spotify account's own playlists
// directly - see fetchMySpotifyPlaylists/fetchSpotifyPlaylistTracks below,
// which actually prefer the Deathstep-account-linked connection when one is
// available (getBestAvailableToken) and only fall back to this local one -
// as a lighter alternative to the DB-backed, account-linked playlists
// feature (server/playlists.js), which still requires a Deathstep account
// since it persists/syncs tracks server-side.
const SCOPES = 'streaming user-read-email user-read-private user-modify-playback-state user-read-playback-state playlist-read-private playlist-read-collaborative';
// Used only by the account-link flow (Settings/Playlists) - adds write
// access to the user's playlists on top of the scopes above, since imported
// playlists live-sync both ways (adding a track in the app pushes it to the
// real Spotify playlist too).
const LINK_SCOPES = `${SCOPES} playlist-modify-private playlist-modify-public`;
const LINK_MODE_KEY = 'deathstep_spotify_link_mode';

export const getRedirectUri = () => {
  return window.location.origin;
};

function generateRandomString(length) {
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return values.reduce((acc, x) => acc + possible[x % possible.length], "");
}

async function sha256(plain) {
  const encoder = new TextEncoder()
  const data = encoder.encode(plain)
  return window.crypto.subtle.digest('SHA-256', data)
}

function base64encode(input) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

// Guards both login functions below against a double-invocation race: each
// stores its code_verifier in localStorage synchronously, then awaits
// sha256() before finally navigating away. If either function ran again
// before that navigation happened (e.g. a double-click - neither Connect
// button disables itself while this runs), the second call would overwrite
// the first's stored code_verifier before its redirect actually fired,
// leaving a code_verifier in localStorage that no longer matches the
// code_challenge Spotify actually received - Spotify then rejects the
// eventual token exchange with "invalid_grant: Invalid authorization code".
// Not reset on completion: by the time either function returns, the page is
// already navigating away to Spotify, so there's nothing left to guard.
let loginRedirectInFlight = false;

export const loginWithSpotify = async () => {
  if (loginRedirectInFlight) return;
  loginRedirectInFlight = true;
  const codeVerifier = generateRandomString(64);
  window.localStorage.setItem('spotify_code_verifier', codeVerifier);
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64encode(hashed);

  const authUrl = new URL("https://accounts.spotify.com/authorize")
  const params =  {
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    redirect_uri: getRedirectUri(),
  }

  authUrl.search = new URLSearchParams(params).toString();
  window.location.href = authUrl.toString();
}

// Same PKCE flow as loginWithSpotify(), but with extra playlist-read scopes
// and a localStorage flag so App.jsx's ?code= callback knows this redirect
// is for linking the Deathstep account (server-side, cross-device) rather
// than the GM's local, browser-only playback session.
export const loginWithSpotifyForAccountLink = async () => {
  if (loginRedirectInFlight) return;
  loginRedirectInFlight = true;
  localStorage.setItem(LINK_MODE_KEY, 'true');
  const codeVerifier = generateRandomString(64);
  window.localStorage.setItem('spotify_code_verifier', codeVerifier);
  window.localStorage.setItem('spotify_code_verifier_canary', codeVerifier); // DEBUG: never touched anywhere else, so a mismatch at read-time proves something overwrote the real key in between
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64encode(hashed);

  const authUrl = new URL("https://accounts.spotify.com/authorize")
  const redirectUri = getRedirectUri();
  window.localStorage.setItem('spotify_redirect_uri_debug', redirectUri); // DEBUG
  console.log('DEBUG authorize request:', { client_id: CLIENT_ID, redirect_uri: redirectUri });
  const params = {
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: LINK_SCOPES,
    code_challenge_method: 'S256',
    code_challenge: codeChallenge,
    redirect_uri: redirectUri,
  }

  authUrl.search = new URLSearchParams(params).toString();
  window.location.href = authUrl.toString();
}

export const isSpotifyLinkMode = () => localStorage.getItem(LINK_MODE_KEY) === 'true';
export const clearSpotifyLinkMode = () => localStorage.removeItem(LINK_MODE_KEY);

// For the account-link flow: exchanges the code the same way as getToken(),
// but hands the refresh_token to the server to persist against the logged-in
// Deathstep account instead of keeping it in this browser's localStorage.
export const getTokenForAccountLink = async (code) => {
  const codeVerifier = localStorage.getItem('spotify_code_verifier');
  const canary = localStorage.getItem('spotify_code_verifier_canary');
  const redirectUriAtAuthorize = localStorage.getItem('spotify_redirect_uri_debug');
  const redirectUriNow = getRedirectUri();
  console.log('DEBUG code_verifier check:', { live: codeVerifier?.slice(0, 12), canary: canary?.slice(0, 12), match: codeVerifier === canary });
  console.log('DEBUG redirect_uri check:', { atAuthorize: redirectUriAtAuthorize, now: redirectUriNow, match: redirectUriAtAuthorize === redirectUriNow });
  console.log('DEBUG token exchange request:', { client_id: CLIENT_ID, code: code?.slice(0, 12), codeLen: code?.length, redirect_uri: redirectUriNow });
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: redirectUriNow,
      code_verifier: codeVerifier,
    }),
  });
  const data = await response.json();
  if (!data.refresh_token) return { connected: false };

  const connectResponse = await fetch('/api/spotify/connect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ refreshToken: data.refresh_token }),
  });
  const connectData = await connectResponse.json().catch(() => ({}));
  if (!connectResponse.ok) return { connected: false, error: connectData.error };
  return connectData; // { connected: true, displayName }
}

export const getToken = async (code) => {
  const codeVerifier = localStorage.getItem('spotify_code_verifier');
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'authorization_code',
      code: code,
      redirect_uri: getRedirectUri(),
      code_verifier: codeVerifier,
    }),
  });

  const data = await response.json();
  if (data.access_token) {
    localStorage.setItem('spotify_access_token', data.access_token);
    localStorage.setItem('spotify_refresh_token', data.refresh_token);
    localStorage.setItem('spotify_token_expires_at', Date.now() + data.expires_in * 1000);
    return data.access_token;
  }
  return null;
}

// Fired whenever a refresh definitively fails (the stored refresh token is
// dead) so any mounted component can tell the user their Spotify session
// expired and reset its own UI - see GMDashboard.jsx/PlayerScreen.jsx.
export const SPOTIFY_SESSION_EXPIRED_EVENT = 'deathstep-spotify-session-expired';

// De-dupes concurrent refresh attempts. The Web Playback SDK asks for a
// fresh token on its own schedule (its internal getOAuthToken callback) on
// top of every other getValidToken() caller (playTrack, searchTracks, the
// mount-time check, ...) - several of these can land in the same tick,
// especially right after a reload with an already-expired token. Spotify's
// refresh tokens are single-use/rotating: two concurrent requests starting
// from the same stored token race, only one is accepted, and if the
// request that loses the race is the one whose response gets written to
// localStorage last, it overwrites the correctly-rotated token with a
// value Spotify has already invalidated - permanently breaking the
// connection until a full re-login. Sharing one in-flight promise means
// there is at most one actual refresh in progress at a time, no matter how
// many callers ask for it simultaneously.
let refreshPromise = null;

export const refreshToken = async () => {
  const currentRefreshToken = localStorage.getItem('spotify_refresh_token');
  if (!currentRefreshToken) return null;

  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const response = await fetch("https://accounts.spotify.com/api/token", {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          grant_type: 'refresh_token',
          refresh_token: currentRefreshToken
        }),
      });

      const data = await response.json().catch(() => ({}));
      if (data.access_token) {
        localStorage.setItem('spotify_access_token', data.access_token);
        if (data.refresh_token) {
          localStorage.setItem('spotify_refresh_token', data.refresh_token);
        }
        localStorage.setItem('spotify_token_expires_at', Date.now() + data.expires_in * 1000);
        return data.access_token;
      }
      // invalid_grant means the refresh token itself is dead (revoked, or
      // already rotated away by a request that won a race against this
      // one) - there is no recovering from this without the user
      // reconnecting, so clear the now-useless tokens instead of retrying
      // them forever, and tell whoever's listening why.
      if (data.error === 'invalid_grant') {
        logoutSpotify();
        window.dispatchEvent(new Event(SPOTIFY_SESSION_EXPIRED_EVENT));
      }
      return null;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export const getValidToken = async () => {
  let token = localStorage.getItem('spotify_access_token');
  const expiresAt = localStorage.getItem('spotify_token_expires_at');
  
  if (!token || !expiresAt) return null;

  if (Date.now() > Number(expiresAt) - 60000) { // Refresh 1 minute before expiry
    token = await refreshToken();
  }
  
  return token;
}

// Deathstep-account-linked playback token (server/spotify.js's /token route,
// backed by the refresh_token stored in spotify_accounts) - lets the GM
// dashboard use the same Spotify connection made once on the Playlists page
// for playback, instead of a separate, disconnected local login. Callers
// fall back to the local getToken()/getValidToken() flow above when there's
// no Deathstep account logged in at all; this never throws, it just returns
// null so that fallback kicks in (no Deathstep account, no Spotify linked to
// it, or the request failed).
let accountTokenCache = null; // { accessToken, expiresAt }
export const getValidAccountLinkedToken = async () => {
  if (accountTokenCache && Date.now() < accountTokenCache.expiresAt - 60000) {
    return accountTokenCache.accessToken;
  }
  const hadToken = !!accountTokenCache;
  const result = await fetchSpotifyAccessToken();
  if (result.error || !result.accessToken) {
    accountTokenCache = null;
    // Only announce "session expired" if this was previously connected in
    // this browser session - someone who simply never linked Spotify
    // shouldn't see an "expired" message the first time this is checked.
    if (hadToken) window.dispatchEvent(new Event(SPOTIFY_SESSION_EXPIRED_EVENT));
    return null;
  }
  accountTokenCache = { accessToken: result.accessToken, expiresAt: Date.now() + result.expiresIn * 1000 };
  return result.accessToken;
};

// Prefers the Deathstep-account-linked Spotify connection (works on any
// device the moment you're logged into Deathstep - see
// getValidAccountLinkedToken) over this browser's own local, non-account
// PKCE connection (getValidToken), so a player/GM who already linked
// Spotify once doesn't need to redo a separate per-browser connect. Falls
// through silently to the local token (or null) when there's no Deathstep
// account logged in, or it has no Spotify linked - both are expected, not
// errors.
export const getBestAvailableToken = async () => {
  const accountToken = await getValidAccountLinkedToken();
  if (accountToken) return accountToken;
  return getValidToken();
};

export const searchTracks = async (query) => {
  const token = await getBestAvailableToken();
  if (!token) throw new Error('SPOTIFY_NOT_CONNECTED');

  const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json();
  return data.tracks ? data.tracks.items : [];
}

// Read-only playlist browsing straight from Spotify's API using this local
// session's token - a lighter alternative to server/playlists.js's
// account-linked playlists (which need a Deathstep account, since they're
// persisted/synced server-side). Nothing here is imported or stored
// anywhere; it just lists what's already on the connected Spotify account
// so a track from it can be picked, same as a search result.
export const fetchMySpotifyPlaylists = async () => {
  const token = await getBestAvailableToken();
  if (!token) throw new Error('SPOTIFY_NOT_CONNECTED');

  const playlists = [];
  let url = 'https://api.spotify.com/v1/me/playlists?limit=50';
  while (url && playlists.length < 200) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('FAILED');
    const data = await response.json();
    playlists.push(...(data.items || []).filter(Boolean).map(p => ({
      id: p.id,
      name: p.name,
      // Spotify renamed the playlist's track-count field from "tracks" to
      // "items" in their Feb 2026 Web API changes; "tracks" is deprecated but
      // still sent for now, so fall back to it too.
      trackCount: p.items?.total ?? p.tracks?.total ?? 0,
    })));
    url = data.next || null;
  }
  return playlists;
}

export const fetchSpotifyPlaylistTracks = async (playlistId) => {
  const token = await getBestAvailableToken();
  if (!token) throw new Error('SPOTIFY_NOT_CONNECTED');

  const tracks = [];
  // Spotify renamed this endpoint from /tracks to /items in their Feb 2026
  // Web API changes, and each entry's "track" field to "item" ("track" is
  // deprecated but still sent for now) - request and accept both.
  let url = `https://api.spotify.com/v1/playlists/${playlistId}/items?limit=100&fields=next,items(item(uri,name,artists(name),album(images)),track(uri,name,artists(name),album(images)))`;
  while (url && tracks.length < 500) {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (!response.ok) throw new Error('FAILED');
    const data = await response.json();
    for (const entry of data.items || []) {
      const track = entry.item || entry.track;
      if (!track || !track.uri) continue; // skip local/unavailable tracks
      tracks.push({
        uri: track.uri,
        name: track.name,
        artists: track.artists || [],
        album: track.album || { images: [] },
      });
    }
    url = data.next || null;
  }
  return tracks;
}

export const playTrack = async (trackUri, deviceId = null, positionMs = 0) => {
  const token = await getBestAvailableToken();
  if (!token) throw new Error('SPOTIFY_NOT_CONNECTED');

  const url = deviceId 
    ? `https://api.spotify.com/v1/me/player/play?device_id=${deviceId}`
    : 'https://api.spotify.com/v1/me/player/play';

  const body = { uris: [trackUri] };
  if (positionMs > 0) {
    body.position_ms = positionMs;
  }

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    if (errorData?.error?.reason === 'NO_ACTIVE_DEVICE' || response.status === 404) {
      throw new Error('NO_ACTIVE_DEVICE');
    }
    throw new Error('FAILED');
  }
}

export const pausePlayback = async () => {
  const token = await getBestAvailableToken();
  if (!token) return;

  await fetch('https://api.spotify.com/v1/me/player/pause', {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
}

export const logoutSpotify = () => {
  localStorage.removeItem('spotify_access_token');
  localStorage.removeItem('spotify_refresh_token');
  localStorage.removeItem('spotify_token_expires_at');
  localStorage.removeItem('spotify_code_verifier');
}
