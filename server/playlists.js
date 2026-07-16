import { Router } from 'express';
import { requireDb, getPool } from './db.js';
import { getUserIdFromRequest } from './authToken.js';
import { getValidAccessToken, spotifyFetch } from './spotify.js';

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error('Playlists route error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'playlist_request_failed' });
    });
  };
}

function requireAuth(req, res, next) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: 'not_authenticated' });
  req.userId = userId;
  next();
}

// Returns the playlist row only if it belongs to userId - callers respond
// 404 either way (unknown ID or someone else's playlist) rather than leaking
// which IDs exist.
async function getOwnedPlaylist(pool, playlistId, userId) {
  const [rows] = await pool.query('SELECT * FROM playlists WHERE id = ? AND user_id = ?', [playlistId, userId]);
  return rows[0] || null;
}

async function nextTrackPosition(pool, playlistId) {
  const [rows] = await pool.query('SELECT COALESCE(MAX(position), -1) as maxPos FROM playlist_tracks WHERE playlist_id = ?', [playlistId]);
  return rows[0].maxPos + 1;
}

// Push a locally-staged addition to the real Spotify playlist. Failures
// (token expired, Spotify unreachable, playlist deleted on Spotify's side,
// ...) just report back false - the local row is left untouched either way.
async function pushTrackAddToSpotify(pool, userId, spotifyPlaylistId, uri) {
  const accessToken = await getValidAccessToken(pool, userId);
  if (!accessToken) return false;
  try {
    await spotifyFetch(accessToken, `/playlists/${spotifyPlaylistId}/tracks`, { method: 'POST', body: { uris: [uri] } });
    return true;
  } catch (err) {
    console.error('Failed to push track add to Spotify playlist:', err.message);
    return false;
  }
}

// Push a locally-staged removal to the real Spotify playlist.
async function pushTrackRemoveToSpotify(pool, userId, spotifyPlaylistId, uri) {
  const accessToken = await getValidAccessToken(pool, userId);
  if (!accessToken) return false;
  try {
    await spotifyFetch(accessToken, `/playlists/${spotifyPlaylistId}/tracks`, { method: 'DELETE', body: { tracks: [{ uri }] } });
    return true;
  } catch (err) {
    console.error('Failed to push track removal to Spotify playlist:', err.message);
    return false;
  }
}

// Throttles how often a given playlist's Spotify pull-sync actually hits the
// Spotify API, independent of how often the client polls the read routes or
// the background loop below fires - in-memory is fine, this only needs to
// survive a single process's uptime.
const lastPullSyncedAt = new Map();
const PULL_SYNC_THROTTLE_MS = 8000;

// Reconciles local state against what's actually on Spotify right now.
// Nothing here ever pushes a write to Spotify - it only reads the real
// playlist and uses it to flag/resolve rows so every discrepancy is always
// visible, but nothing destructive ever happens without a separate explicit
// confirm (see the /confirm route and the status-aware DELETE route below):
//  - 'pending_add' -> 'synced' once the same track shows up on Spotify (the
//    user must have added it there themselves - that's already a fact, not
//    something to confirm).
//  - 'pending_delete' -> row purged once the track is also gone from Spotify
//    (same reasoning: already a fact on both sides at that point).
//  - 'synced' -> 'removed_on_spotify' if the track is no longer on Spotify -
//    flagged, NOT purged, until the user explicitly acknowledges it.
//  - 'removed_on_spotify' -> back to 'synced' if the track reappears on
//    Spotify (someone re-added it there).
//  - anything present on Spotify with no local row at all (added directly on
//    Spotify, never staged here) is inserted as 'synced' immediately - it's
//    already real on both "sides" the moment it's read, nothing to confirm.
async function pullTracksFromSpotify(pool, userId, playlist) {
  if (!playlist.spotify_playlist_id) return;

  const last = lastPullSyncedAt.get(playlist.id) || 0;
  if (Date.now() - last < PULL_SYNC_THROTTLE_MS) return;
  lastPullSyncedAt.set(playlist.id, Date.now());

  const accessToken = await getValidAccessToken(pool, userId);
  if (!accessToken) return;

  const [localRows] = await pool.query('SELECT id, track_uri, sync_status FROM playlist_tracks WHERE playlist_id = ?', [playlist.id]);
  const localUris = new Set(localRows.map(r => r.track_uri));

  const remoteTracks = [];
  try {
    let path = `/playlists/${playlist.spotify_playlist_id}/tracks?limit=100&fields=next,items(track(uri,name,artists(name)))`;
    while (path && remoteTracks.length < 500) {
      const data = await spotifyFetch(accessToken, path);
      for (const item of data.items || []) {
        if (!item.track || !item.track.uri) continue;
        remoteTracks.push({ uri: item.track.uri, name: item.track.name, artist: (item.track.artists || []).map(a => a.name).join(', ') });
      }
      path = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
    }
  } catch (err) {
    console.error('Spotify pull-sync failed:', err.message);
    return;
  }
  const remoteUris = new Set(remoteTracks.map(t => t.uri));

  const toPromote = localRows.filter(r => r.sync_status === 'pending_add' && remoteUris.has(r.track_uri)).map(r => r.id);
  const toPurge = localRows.filter(r => r.sync_status === 'pending_delete' && !remoteUris.has(r.track_uri)).map(r => r.id);
  const toFlagRemoved = localRows.filter(r => r.sync_status === 'synced' && !remoteUris.has(r.track_uri)).map(r => r.id);
  const toUnflagRemoved = localRows.filter(r => r.sync_status === 'removed_on_spotify' && remoteUris.has(r.track_uri)).map(r => r.id);

  if (toPromote.length > 0 || toUnflagRemoved.length > 0) {
    await pool.query('UPDATE playlist_tracks SET sync_status = "synced" WHERE id IN (?)', [[...toPromote, ...toUnflagRemoved]]);
  }
  if (toPurge.length > 0) {
    await pool.query('DELETE FROM playlist_tracks WHERE id IN (?)', [toPurge]);
  }
  if (toFlagRemoved.length > 0) {
    await pool.query('UPDATE playlist_tracks SET sync_status = "removed_on_spotify" WHERE id IN (?)', [toFlagRemoved]);
  }

  const newTracks = remoteTracks.filter(t => !localUris.has(t.uri));
  if (newTracks.length > 0) {
    let position = await nextTrackPosition(pool, playlist.id);
    const values = newTracks.map(t => [playlist.id, t.uri, t.name, t.artist, position++, 'synced']);
    await pool.query('INSERT INTO playlist_tracks (playlist_id, track_uri, track_name, artist_name, position, sync_status) VALUES ?', [values]);
  }
}

// "dauerhaft synchronisiert" - keeps every linked playlist reconciled even
// when nobody has it open, instead of relying solely on someone visiting the
// Playlists page (which still triggers its own throttled sync on read, on
// top of this). Shares the same throttle map above, so this and any
// concurrent on-demand read never double up on the same playlist.
const BACKGROUND_SYNC_INTERVAL_MS = 30000;
async function backgroundSyncAllLinkedPlaylists() {
  const pool = await getPool();
  if (!pool) return; // DB not configured/unreachable this cycle - just skip, try again next interval
  try {
    const [rows] = await pool.query('SELECT id, user_id, spotify_playlist_id FROM playlists WHERE spotify_playlist_id IS NOT NULL');
    for (const row of rows) {
      await pullTracksFromSpotify(pool, row.user_id, { id: row.id, spotify_playlist_id: row.spotify_playlist_id })
        .catch(err => console.error(`Background sync failed for playlist ${row.id}:`, err.message));
    }
  } catch (err) {
    console.error('Background playlist sync loop failed:', err.message);
  }
}
setInterval(backgroundSyncAllLinkedPlaylists, BACKGROUND_SYNC_INTERVAL_MS);

const router = Router();
router.use(requireDb);
router.use(requireAuth);

router.get('/', asyncRoute(async (req, res) => {
  const [rows] = await req.db.query(
    `SELECT p.id, p.name, p.spotify_playlist_id, COUNT(pt.id) as trackCount
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
     WHERE p.user_id = ?
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [req.userId]
  );
  res.json({ playlists: rows.map(r => ({ id: r.id, name: r.name, trackCount: Number(r.trackCount), spotifyPlaylistId: r.spotify_playlist_id })) });
}));

router.post('/', asyncRoute(async (req, res) => {
  const name = (req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'missing_name' });

  const [result] = await req.db.query('INSERT INTO playlists (user_id, name) VALUES (?, ?)', [req.userId, name]);
  res.json({ playlist: { id: result.insertId, name, trackCount: 0 } });
}));

router.get('/:id', asyncRoute(async (req, res) => {
  const playlist = await getOwnedPlaylist(req.db, req.params.id, req.userId);
  if (!playlist) return res.status(404).json({ error: 'playlist_not_found' });

  await pullTracksFromSpotify(req.db, req.userId, playlist);

  const [tracks] = await req.db.query(
    'SELECT id, track_uri, track_name, artist_name, sync_status FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC',
    [playlist.id]
  );
  res.json({
    playlist: {
      id: playlist.id,
      name: playlist.name,
      spotifyPlaylistId: playlist.spotify_playlist_id,
      tracks: tracks.map(t => ({ id: t.id, uri: t.track_uri, name: t.track_name, artist: t.artist_name, syncStatus: t.sync_status })),
    },
  });
}));

router.delete('/:id', asyncRoute(async (req, res) => {
  const playlist = await getOwnedPlaylist(req.db, req.params.id, req.userId);
  if (!playlist) return res.status(404).json({ error: 'playlist_not_found' });

  await req.db.query('DELETE FROM playlists WHERE id = ?', [playlist.id]);
  res.json({ success: true });
}));

router.post('/:id/tracks', asyncRoute(async (req, res) => {
  const playlist = await getOwnedPlaylist(req.db, req.params.id, req.userId);
  if (!playlist) return res.status(404).json({ error: 'playlist_not_found' });

  const { uri, name, artist } = req.body || {};
  if (!uri || !name) return res.status(400).json({ error: 'missing_track_fields' });

  // On a linked playlist, a new track is staged rather than pushed right
  // away - it only actually reaches Spotify once the user adds it there
  // themselves (picked up by the next pull-sync) or explicitly confirms it
  // via the /confirm route below. App-only playlists have no such staging.
  const syncStatus = playlist.spotify_playlist_id ? 'pending_add' : 'synced';

  const position = await nextTrackPosition(req.db, playlist.id);
  const [result] = await req.db.query(
    'INSERT INTO playlist_tracks (playlist_id, track_uri, track_name, artist_name, position, sync_status) VALUES (?, ?, ?, ?, ?, ?)',
    [playlist.id, uri, name, artist || '', position, syncStatus]
  );

  res.json({ track: { id: result.insertId, uri, name, artist: artist || '', syncStatus } });
}));

// Manually pushes a staged change to the real Spotify playlist right now,
// instead of waiting for the pull-sync to notice the user resolved it on
// Spotify themselves: a 'pending_add' track gets added on Spotify, a
// 'pending_delete' track gets removed from Spotify. Either way the local row
// ends up matching Spotify - 'synced' for an add, purged entirely for a
// delete (there's nothing left to track once it's gone from both sides).
router.post('/:id/tracks/:trackId/confirm', asyncRoute(async (req, res) => {
  const playlist = await getOwnedPlaylist(req.db, req.params.id, req.userId);
  if (!playlist) return res.status(404).json({ error: 'playlist_not_found' });
  if (!playlist.spotify_playlist_id) return res.status(400).json({ error: 'not_a_linked_playlist' });

  const [rows] = await req.db.query('SELECT * FROM playlist_tracks WHERE id = ? AND playlist_id = ?', [req.params.trackId, playlist.id]);
  const track = rows[0];
  if (!track) return res.status(404).json({ error: 'track_not_found' });

  if (track.sync_status === 'pending_add') {
    const pushed = await pushTrackAddToSpotify(req.db, req.userId, playlist.spotify_playlist_id, track.track_uri);
    if (!pushed) return res.status(502).json({ error: 'spotify_push_failed' });
    await req.db.query('UPDATE playlist_tracks SET sync_status = "synced" WHERE id = ?', [track.id]);
    return res.json({ success: true, syncStatus: 'synced' });
  }

  if (track.sync_status === 'pending_delete') {
    const pushed = await pushTrackRemoveToSpotify(req.db, req.userId, playlist.spotify_playlist_id, track.track_uri);
    if (!pushed) return res.status(502).json({ error: 'spotify_push_failed' });
    await req.db.query('DELETE FROM playlist_tracks WHERE id = ?', [track.id]);
    return res.json({ success: true, removed: true });
  }

  return res.status(409).json({ error: 'track_not_pending' });
}));

// Status-aware: what "removing" a track means depends entirely on where it
// currently stands relative to Spotify.
router.delete('/:id/tracks/:trackId', asyncRoute(async (req, res) => {
  const playlist = await getOwnedPlaylist(req.db, req.params.id, req.userId);
  if (!playlist) return res.status(404).json({ error: 'playlist_not_found' });

  if (playlist.spotify_playlist_id) {
    const [rows] = await req.db.query('SELECT sync_status FROM playlist_tracks WHERE id = ? AND playlist_id = ?', [req.params.trackId, playlist.id]);
    const track = rows[0];
    if (!track) return res.status(404).json({ error: 'track_not_found' });

    if (track.sync_status === 'pending_add' || track.sync_status === 'removed_on_spotify') {
      // pending_add: never actually reached Spotify, nothing to reconcile.
      // removed_on_spotify: already gone from Spotify, this just acknowledges
      // it locally too. Either way there's nothing left to push or wait on.
      await req.db.query('DELETE FROM playlist_tracks WHERE id = ?', [req.params.trackId]);
    } else if (track.sync_status === 'synced') {
      // Stays visible as "deleted" until it also disappears from Spotify (or
      // the user pushes the removal now via /confirm) - the app never calls
      // Spotify's remove-track endpoint without one of those two happening.
      await req.db.query('UPDATE playlist_tracks SET sync_status = "pending_delete" WHERE id = ?', [req.params.trackId]);
    }
    // else already pending_delete - idempotent no-op, it's already staged.
  } else {
    await req.db.query('DELETE FROM playlist_tracks WHERE id = ? AND playlist_id = ?', [req.params.trackId, playlist.id]);
  }

  res.json({ success: true });
}));

// Imports a Spotify playlist as a new, live-linked app playlist in one step
// (rather than create-then-import) so a rejected duplicate import never
// leaves an orphaned empty playlist behind. Linked playlists stay reconciled
// going forward via pullTracksFromSpotify (see above) and the background loop.
router.post('/import', asyncRoute(async (req, res) => {
  const spotifyPlaylistId = req.body?.spotifyPlaylistId;
  const name = (req.body?.name || '').trim();
  if (!spotifyPlaylistId) return res.status(400).json({ error: 'missing_spotify_playlist_id' });
  if (!name) return res.status(400).json({ error: 'missing_name' });

  const [existing] = await req.db.query(
    'SELECT id FROM playlists WHERE user_id = ? AND spotify_playlist_id = ?',
    [req.userId, spotifyPlaylistId]
  );
  if (existing[0]) return res.status(409).json({ error: 'already_imported' });

  const accessToken = await getValidAccessToken(req.db, req.userId);
  if (!accessToken) return res.status(409).json({ error: 'spotify_not_connected' });

  const tracks = [];
  let path = `/playlists/${spotifyPlaylistId}/tracks?limit=100&fields=next,items(track(uri,name,artists(name)))`;
  while (path && tracks.length < 500) {
    const data = await spotifyFetch(accessToken, path);
    for (const item of data.items || []) {
      if (!item.track || !item.track.uri) continue; // skip local/unavailable tracks
      tracks.push({
        uri: item.track.uri,
        name: item.track.name,
        artist: (item.track.artists || []).map(a => a.name).join(', '),
      });
    }
    path = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }

  const [result] = await req.db.query(
    'INSERT INTO playlists (user_id, name, spotify_playlist_id) VALUES (?, ?, ?)',
    [req.userId, name, spotifyPlaylistId]
  );
  const playlistId = result.insertId;

  if (tracks.length > 0) {
    const values = tracks.map((t, i) => [playlistId, t.uri, t.name, t.artist, i]);
    await req.db.query('INSERT INTO playlist_tracks (playlist_id, track_uri, track_name, artist_name, position) VALUES ?', [values]);
  }
  lastPullSyncedAt.set(playlistId, Date.now()); // fresh import already has everything, skip an immediate redundant pull-sync

  res.json({ playlist: { id: playlistId, name, trackCount: tracks.length, spotifyPlaylistId } });
}));

export default router;
