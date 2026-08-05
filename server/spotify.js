import { Router } from 'express';
import { requireDb } from './db.js';
import { getUserIdFromRequest } from './authToken.js';

// Same client ID as the client-side GM playback flow (client/src/spotify.js)
// - both use the PKCE authorization code flow, so no client secret is ever
// needed, server-side or client-side.
const CLIENT_ID = process.env.VITE_SPOTIFY_CLIENT_ID;

// Network calls to Spotify are far more likely to fail/time out than a local
// DB query - wrap every handler so a Spotify-side hiccup returns a clean
// error instead of an unhandled rejection taking the whole process down.
// Exported so other routers making the same kind of Spotify Web API call
// (e.g. admin.js's fallback-playlist import) get the same safety net -
// without it, a private/deleted playlist (spotifyFetch throwing on a non-OK
// response) would just hang the request forever instead of answering with
// an error, since Express 4 doesn't auto-catch rejected async handlers.
export function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error('Spotify route error:', err.message);
      if (res.headersSent) return;
      if (err.spotifyRateLimited) {
        res.status(429).json({ error: 'spotify_rate_limited', retryAfterSeconds: err.retryAfterSeconds });
      } else {
        res.status(502).json({ error: 'spotify_request_failed' });
      }
    });
  };
}

function requireAuth(req, res, next) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: 'not_authenticated' });
  req.userId = userId;
  next();
}

// Same refresh-token grant as client/src/spotify.js's refreshToken(), just
// run server-side against a stored refresh_token instead of localStorage.
async function refreshAccessToken(refreshToken) {
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: CLIENT_ID,
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  return response.json();
}

// userId -> { accessToken, expiresAt }. Access tokens last ~1h; caching
// means most calls (search, playlist reads, the 8s/30s playlist pull-sync)
// don't touch Spotify's token endpoint at all.
const accessTokenCache = new Map();
// userId -> in-flight Promise<string|null>, so concurrent callers for the
// same user share one refresh instead of each independently exchanging the
// same stored refresh_token. Spotify's refresh tokens are single-use/
// rotating: two concurrent requests both starting from the same stored
// token would race - only one is accepted, and if whichever one loses
// finishes last, it overwrites the correctly-rotated token in the DB with
// one Spotify has already invalidated, permanently breaking the connection.
// This was easy to trigger in practice once playlists could sync
// automatically (8s on-read throttle + a 30s background loop across every
// linked playlist, on top of any foreground search/playlist-browse call).
const refreshPromises = new Map();

// Looks up the account-linked refresh_token and returns a valid { accessToken,
// expiresAt }, refreshing (and persisting the rotated refresh_token) only
// when the cached one is missing or near expiry. If Spotify reports the
// refresh token itself as dead (invalid_grant - revoked, or rotated away by a
// request that won a race against an earlier call before this caching
// existed), the stored connection can never work again without the user
// reconnecting, so it's deleted here rather than left silently broken.
export async function getValidAccessToken(pool, userId) {
  const cached = accessTokenCache.get(userId);
  if (cached && Date.now() < cached.expiresAt - 60000) {
    return cached;
  }

  if (refreshPromises.has(userId)) {
    return refreshPromises.get(userId);
  }

  const promise = (async () => {
    try {
      const [rows] = await pool.query('SELECT refresh_token FROM spotify_accounts WHERE user_id = ?', [userId]);
      if (!rows[0]) return null;

      const data = await refreshAccessToken(rows[0].refresh_token);
      if (!data.access_token) {
        if (data.error === 'invalid_grant') {
          await pool.query('DELETE FROM spotify_accounts WHERE user_id = ?', [userId]);
        }
        accessTokenCache.delete(userId);
        return null;
      }

      if (data.refresh_token && data.refresh_token !== rows[0].refresh_token) {
        await pool.query('UPDATE spotify_accounts SET refresh_token = ? WHERE user_id = ?', [data.refresh_token, userId]);
      }
      const entry = { accessToken: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
      accessTokenCache.set(userId, entry);
      return entry;
    } finally {
      refreshPromises.delete(userId);
    }
  })();
  refreshPromises.set(userId, promise);
  return promise;
}

// Called on connect/disconnect so a stale cached access token from a
// previous (possibly different) Spotify account never lingers past a
// reconnect - without this, switching accounts wouldn't actually take
// effect until the old cached token's ~1h expiry.
export function invalidateAccessTokenCache(userId) {
  accessTokenCache.delete(userId);
}

// Spotify enforces an undisclosed global rate limit and answers 429 (with a
// Retry-After header, in seconds) once hit. Every caller here - the 30s
// background sync loop across every linked playlist, and every foreground
// request - funnels through this one function, so a single shared cooldown
// stops ALL of them the moment Spotify says to back off, instead of each
// caller independently retrying on its own schedule and re-triggering the
// same block before it ever has a chance to lapse (which is what was
// happening: constant 429s, some calls only succeeding once a request
// happened to land in a gap between blocks).
let rateLimitedUntil = 0;

// Lets a caller skip a whole batch of work up front (see playlists.js's
// background sync loop) instead of attempting - and immediately failing -
// every item in that batch individually while a block is active. Purely an
// optimization (spotifyFetch's own check at the top of every call is what
// actually enforces the block); this just avoids the wasted DB
// query/per-item loop/log noise in the meantime.
export function isSpotifyRateLimited() {
  return Date.now() < rateLimitedUntil;
}

// Marks an error as "we're rate-limited" (vs. a genuinely broken token/
// connection) so callers can tell the two apart instead of collapsing both
// into the same generic failure - see e.g. the /connect route below, which
// used to report every /me-fetch failure as "invalid_spotify_token" even
// when the real reason was this rate-limit skip, misleading the user into
// thinking their Spotify link itself was broken when it just needed to wait.
function rateLimitError(path) {
  const retryAfterSeconds = Math.ceil((rateLimitedUntil - Date.now()) / 1000);
  const err = new Error(`Spotify API ${path} skipped: rate-limited for another ${retryAfterSeconds}s`);
  err.spotifyRateLimited = true;
  err.retryAfterSeconds = retryAfterSeconds;
  return err;
}

export async function spotifyFetch(accessToken, path, options = {}) {
  if (Date.now() < rateLimitedUntil) {
    throw rateLimitError(path);
  }
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (response.status === 429) {
    const retryAfterSeconds = Number(response.headers.get('retry-after')) || 30;
    rateLimitedUntil = Date.now() + retryAfterSeconds * 1000;
    console.error(`Spotify rate limit hit on ${path} - pausing all Spotify calls for ${retryAfterSeconds}s`);
    throw rateLimitError(path);
  }
  if (!response.ok) throw new Error(`Spotify API ${path} failed: ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}

const router = Router();
router.use(requireDb);

// Body: { refreshToken } - the client already ran the PKCE code exchange
// (client/src/spotify.js's getTokenForAccountLink) and hands us the
// resulting refresh_token. We independently refresh it and fetch the
// profile to both verify it works and get a display name to show in Settings.
router.post('/connect', requireAuth, asyncRoute(async (req, res) => {
  const refreshToken = req.body?.refreshToken;
  if (!refreshToken) return res.status(400).json({ error: 'missing_refresh_token' });

  const tokenData = await refreshAccessToken(refreshToken);
  if (!tokenData.access_token) {
    console.error('/connect: refreshAccessToken failed:', JSON.stringify(tokenData));
    return res.status(400).json({ error: 'invalid_spotify_token' });
  }

  let profile;
  try {
    profile = await spotifyFetch(tokenData.access_token, '/me');
  } catch (err) {
    // Distinguish "we're rate-limited right now" from an actually broken
    // token/connection - collapsing both into invalid_spotify_token would
    // tell the user their Spotify link itself is bad when really they just
    // need to wait, which sends them off trying to reconnect for nothing.
    if (err.spotifyRateLimited) {
      return res.status(429).json({ error: 'spotify_rate_limited', retryAfterSeconds: err.retryAfterSeconds });
    }
    console.error('/connect: /me fetch failed:', err.message);
    return res.status(400).json({ error: 'invalid_spotify_token' });
  }

  const finalRefreshToken = tokenData.refresh_token || refreshToken;

  // A Spotify account may only ever be linked to one Deathstep account -
  // reject instead of silently reassigning it out from under whoever
  // connected it first (the DB's unique index on spotify_user_id, see
  // server/db.js, is the last-resort backstop for this same rule).
  const [existing] = await req.db.query(
    'SELECT user_id FROM spotify_accounts WHERE spotify_user_id = ? AND user_id != ?',
    [profile.id, req.userId]
  );
  if (existing[0]) return res.status(409).json({ error: 'spotify_already_linked' });

  await req.db.query(
    `INSERT INTO spotify_accounts (user_id, spotify_user_id, display_name, refresh_token)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE spotify_user_id = VALUES(spotify_user_id), display_name = VALUES(display_name), refresh_token = VALUES(refresh_token)`,
    [req.userId, profile.id, profile.display_name || profile.id, finalRefreshToken]
  );
  invalidateAccessTokenCache(req.userId);

  res.json({ connected: true, displayName: profile.display_name || profile.id });
}));

router.post('/disconnect', requireAuth, asyncRoute(async (req, res) => {
  await req.db.query('DELETE FROM spotify_accounts WHERE user_id = ?', [req.userId]);
  invalidateAccessTokenCache(req.userId);
  res.json({ success: true });
}));

router.get('/status', requireAuth, asyncRoute(async (req, res) => {
  const [rows] = await req.db.query('SELECT display_name FROM spotify_accounts WHERE user_id = ?', [req.userId]);
  if (!rows[0]) return res.json({ connected: false, displayName: null });

  // A row existing here only means a connection was made at some point - it
  // says nothing about whether the refresh token still works (e.g. the user
  // revoked access on Spotify's side, or hasn't opened the app in long enough
  // that Spotify silently invalidated it). Actually exercise it via
  // getValidAccessToken (which deletes the row on a confirmed invalid_grant)
  // so the banner reflects reality on page load, instead of only catching up
  // the next time the user tries an action that touches Spotify.
  const token = await getValidAccessToken(req.db, req.userId);
  res.json({ connected: !!token, displayName: token ? rows[0].display_name : null });
}));

// Shared by GET /playlists below (a Deathstep account's own connection) and
// server/index.js's public room-scoped playlists route (which resolves a
// token from whichever player has lent their Spotify connection to the room
// instead) - listing a user's own playlists needs no Deathstep-account
// identity beyond the Spotify token itself.
export async function fetchPlaylistsWithToken(accessToken) {
  const playlists = [];
  let path = '/me/playlists?limit=50';
  while (path && playlists.length < 200) {
    const data = await spotifyFetch(accessToken, path);
    // Spotify's API can return null entries here (e.g. a formerly-
    // collaborative playlist the user lost access to) - skip them instead of
    // throwing inside .map, which would otherwise turn one bad entry into a
    // 502 for the whole list (see the matching .filter(Boolean) in
    // client/src/spotify.js's fetchMySpotifyPlaylists).
    playlists.push(...(data.items || []).filter(Boolean).map(p => ({
      id: p.id,
      name: p.name,
      // Spotify renamed the playlist's track-count field from "tracks" to
      // "items" in their Feb 2026 Web API changes; "tracks" is deprecated but
      // still sent for now, so fall back to it too.
      trackCount: p.items?.total ?? p.tracks?.total ?? 0,
      imageUrl: p.images?.[0]?.url || null,
    })));
    path = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return playlists;
}

router.get('/playlists', requireAuth, asyncRoute(async (req, res) => {
  const token = await getValidAccessToken(req.db, req.userId);
  if (!token) return res.status(409).json({ error: 'spotify_not_connected' });
  res.json({ playlists: await fetchPlaylistsWithToken(token.accessToken) });
}));

// Shared by GET /playlists/:id/tracks below and server/index.js's public
// room-scoped playlist-tracks route - fetches every track of a single
// playlist, with cover art, so a picked-from-a-playlist track/thumbnail
// looks the same as one picked from search (see searchTracksWithToken below).
export async function fetchPlaylistTracksWithToken(accessToken, playlistId) {
  const tracks = [];
  let path = `/playlists/${playlistId}/items?limit=100&fields=next,items(item(uri,name,artists(name),album(images)),track(uri,name,artists(name),album(images)))`;
  while (path && tracks.length < 500) {
    const data = await spotifyFetch(accessToken, path);
    for (const entry of data.items || []) {
      // "track" was renamed to "item" per entry (Feb 2026 Web API changes),
      // but Spotify still sends the deprecated "track" field alongside it for
      // now - accept either.
      const track = entry.item || entry.track;
      if (!track || !track.uri) continue; // skip local/unavailable tracks
      tracks.push({
        uri: track.uri,
        name: track.name,
        artist: (track.artists || []).map(a => a.name).join(', '),
        imageUrl: track.album?.images?.[2]?.url || track.album?.images?.[0]?.url || null,
      });
    }
    path = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return tracks;
}

// Cheap 1-call check used by server/playlists.js's pullTracksFromSpotify to
// avoid a full, possibly multi-page re-fetch of every track on a playlist
// (fetchPlaylistTracksWithToken above) when nothing has actually changed
// since the last sync - Spotify bumps snapshot_id on every playlist edit
// (add/remove/reorder), so comparing it against what was stored last time
// tells the two apart for the cost of one lightweight request instead of up
// to 5 (500 tracks / 100 per page).
export async function getPlaylistSnapshotId(accessToken, playlistId) {
  const data = await spotifyFetch(accessToken, `/playlists/${playlistId}?fields=snapshot_id`);
  return data?.snapshot_id || null;
}

router.get('/playlists/:id/tracks', requireAuth, asyncRoute(async (req, res) => {
  const token = await getValidAccessToken(req.db, req.userId);
  if (!token) return res.status(409).json({ error: 'spotify_not_connected' });
  res.json({ tracks: await fetchPlaylistTracksWithToken(token.accessToken, req.params.id) });
}));

// Shared by GET /search below (a Deathstep account's own connection) and
// server/index.js's public room-scoped search route (which resolves a token
// from whichever GM/co-GM/delegate in the room has one connected instead) -
// track search itself is public catalog data, needs no per-caller identity.
// imageUrl uses the smallest available cover art (index 2, typically 64x64 -
// Spotify sorts images largest-first) since this only ever renders as a small
// list-row thumbnail, same choice GMDashboard.jsx's own direct-to-Spotify
// search already made for its `track.album.images[2]` lookups.
export async function searchTracksWithToken(accessToken, query) {
  const data = await spotifyFetch(accessToken, `/search?q=${encodeURIComponent(query)}&type=track&limit=10`);
  return (data.tracks?.items || []).map(t => ({
    uri: t.uri,
    name: t.name,
    artist: t.artists.map(a => a.name).join(', '),
    imageUrl: t.album?.images?.[2]?.url || t.album?.images?.[0]?.url || null,
  }));
}

router.get('/search', requireAuth, asyncRoute(async (req, res) => {
  const token = await getValidAccessToken(req.db, req.userId);
  if (!token) return res.status(409).json({ error: 'spotify_not_connected' });

  const q = (req.query.q || '').trim();
  if (!q) return res.json({ tracks: [] });

  const tracks = await searchTracksWithToken(token.accessToken, q);
  res.json({ tracks });
}));

// Mints a short-lived access token for the browser to use directly (e.g. the
// GM dashboard's Web Playback SDK, which needs a raw token in the browser to
// open a playback device) from this account's server-side connection -
// lets a Deathstep account's Spotify link (made once, from the Playlists
// page) also drive playback without a separate, disconnected local login.
router.get('/token', requireAuth, asyncRoute(async (req, res) => {
  const token = await getValidAccessToken(req.db, req.userId);
  if (!token) return res.status(409).json({ error: 'spotify_not_connected' });
  res.json({ accessToken: token.accessToken, expiresIn: Math.floor((token.expiresAt - Date.now()) / 1000) });
}));

export default router;
