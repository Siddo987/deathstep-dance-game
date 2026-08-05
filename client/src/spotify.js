import { fetchSpotifyAccessToken } from './spotifyPlaylists.js';

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
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
  const hashed = await sha256(codeVerifier);
  const codeChallenge = base64encode(hashed);

  const authUrl = new URL("https://accounts.spotify.com/authorize")
  const redirectUri = getRedirectUri();
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
  const redirectUriNow = getRedirectUri();
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

// token is always passed in explicitly by the caller (resolved through
// GMDashboard's getPlaybackToken()) rather than looked up in here via
// getBestAvailableToken() - that function only ever knows about the GM's own
// account-linked/local connection, never a player's delegated one
// (room.spotifyDelegate), so calling it directly from here used to make
// every search/play/pause fail (and misreport as "session expired") the
// moment a GM was relying purely on a delegate instead of their own
// connection - see getPlaybackToken's doc comment for the priority order.
export const searchTracks = async (query, token) => {
  if (!token) throw new Error('SPOTIFY_NOT_CONNECTED');

  const response = await fetch(`https://api.spotify.com/v1/search?q=${encodeURIComponent(query)}&type=track&limit=5`, {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });

  const data = await response.json();
  return data.tracks ? data.tracks.items : [];
}

export const playTrack = async (trackUri, token, deviceId = null, positionMs = 0) => {
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

export const pausePlayback = async (token) => {
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
