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
function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error('Spotify route error:', err.message);
      if (!res.headersSent) res.status(502).json({ error: 'spotify_request_failed' });
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

// Looks up the account-linked refresh_token and exchanges it for a fresh
// access_token on every call (no caching - this is click-driven, not
// per-keystroke, so the extra round trip is cheap). Spotify occasionally
// rotates the refresh_token itself; if it does, the new one is persisted.
export async function getValidAccessToken(pool, userId) {
  const [rows] = await pool.query('SELECT refresh_token FROM spotify_accounts WHERE user_id = ?', [userId]);
  if (!rows[0]) return null;

  const data = await refreshAccessToken(rows[0].refresh_token);
  if (!data.access_token) return null;

  if (data.refresh_token && data.refresh_token !== rows[0].refresh_token) {
    await pool.query('UPDATE spotify_accounts SET refresh_token = ? WHERE user_id = ?', [data.refresh_token, userId]);
  }
  return data.access_token;
}

export async function spotifyFetch(accessToken, path, options = {}) {
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    method: options.method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
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
  if (!tokenData.access_token) return res.status(400).json({ error: 'invalid_spotify_token' });

  let profile;
  try {
    profile = await spotifyFetch(tokenData.access_token, '/me');
  } catch (err) {
    return res.status(400).json({ error: 'invalid_spotify_token' });
  }

  const finalRefreshToken = tokenData.refresh_token || refreshToken;

  await req.db.query(
    `INSERT INTO spotify_accounts (user_id, spotify_user_id, display_name, refresh_token)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE spotify_user_id = VALUES(spotify_user_id), display_name = VALUES(display_name), refresh_token = VALUES(refresh_token)`,
    [req.userId, profile.id, profile.display_name || profile.id, finalRefreshToken]
  );

  res.json({ connected: true, displayName: profile.display_name || profile.id });
}));

router.post('/disconnect', requireAuth, asyncRoute(async (req, res) => {
  await req.db.query('DELETE FROM spotify_accounts WHERE user_id = ?', [req.userId]);
  res.json({ success: true });
}));

router.get('/status', requireAuth, asyncRoute(async (req, res) => {
  const [rows] = await req.db.query('SELECT display_name FROM spotify_accounts WHERE user_id = ?', [req.userId]);
  res.json({ connected: !!rows[0], displayName: rows[0]?.display_name || null });
}));

router.get('/playlists', requireAuth, asyncRoute(async (req, res) => {
  const accessToken = await getValidAccessToken(req.db, req.userId);
  if (!accessToken) return res.status(409).json({ error: 'spotify_not_connected' });

  const playlists = [];
  let path = '/me/playlists?limit=50';
  while (path && playlists.length < 200) {
    const data = await spotifyFetch(accessToken, path);
    playlists.push(...(data.items || []).map(p => ({
      id: p.id,
      name: p.name,
      trackCount: p.tracks?.total ?? 0,
      imageUrl: p.images?.[0]?.url || null,
    })));
    path = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }
  res.json({ playlists });
}));

router.get('/search', requireAuth, asyncRoute(async (req, res) => {
  const accessToken = await getValidAccessToken(req.db, req.userId);
  if (!accessToken) return res.status(409).json({ error: 'spotify_not_connected' });

  const q = (req.query.q || '').trim();
  if (!q) return res.json({ tracks: [] });

  const data = await spotifyFetch(accessToken, `/search?q=${encodeURIComponent(q)}&type=track&limit=10`);
  res.json({
    tracks: (data.tracks?.items || []).map(t => ({
      uri: t.uri,
      name: t.name,
      artist: t.artists.map(a => a.name).join(', '),
    })),
  });
}));

export default router;
