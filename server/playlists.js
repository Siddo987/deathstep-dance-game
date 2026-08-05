import { Router } from 'express';
import { requireDb, getPool } from './db.js';
import { getUserIdFromRequest } from './authToken.js';
import { getValidAccessToken, spotifyFetch, isSpotifyRateLimited, getPlaylistSnapshotId } from './spotify.js';

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error('Playlists route error:', err.message);
      if (res.headersSent) return;
      if (err.spotifyRateLimited) {
        res.status(429).json({ error: 'spotify_rate_limited', retryAfterSeconds: err.retryAfterSeconds });
      } else {
        res.status(500).json({ error: 'playlist_request_failed' });
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
// ...) just report back null - the local row is left untouched either way.
// Returns the resulting snapshot_id on success (Spotify includes it in every
// add/remove-items response for free) so the caller can seed
// pullTracksFromSpotify's snapshot check with it - without this, the very
// next sync after a manual confirm would see a stale local snapshot_id and
// pay for a full re-fetch just to learn what this call already told us.
async function pushTrackAddToSpotify(pool, userId, spotifyPlaylistId, uri) {
  const token = await getValidAccessToken(pool, userId);
  if (!token) return null;
  try {
    // Spotify renamed this endpoint from /tracks to /items in their Feb 2026
    // Web API changes (/tracks is deprecated) - same request body shape.
    const result = await spotifyFetch(token.accessToken, `/playlists/${spotifyPlaylistId}/items`, { method: 'POST', body: { uris: [uri] } });
    return result?.snapshot_id || true;
  } catch (err) {
    console.error('Failed to push track add to Spotify playlist:', err.message);
    return null;
  }
}

// Push a locally-staged removal to the real Spotify playlist. Same
// snapshot_id return contract as pushTrackAddToSpotify above.
async function pushTrackRemoveToSpotify(pool, userId, spotifyPlaylistId, uri) {
  const token = await getValidAccessToken(pool, userId);
  if (!token) return null;
  try {
    // The request body key was renamed from "tracks" to "items" along with the endpoint.
    const result = await spotifyFetch(token.accessToken, `/playlists/${spotifyPlaylistId}/items`, { method: 'DELETE', body: { items: [{ uri }] } });
    return result?.snapshot_id || true;
  } catch (err) {
    console.error('Failed to push track removal to Spotify playlist:', err.message);
    return null;
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

  const token = await getValidAccessToken(pool, userId);
  if (!token) return;

  // One cheap call up front: if Spotify's snapshot_id for this playlist
  // hasn't moved since we last synced it, nothing on it has changed and the
  // full (possibly multi-page) track re-fetch below can be skipped entirely.
  // This is what makes the 8s on-read throttle and the 3-minute background
  // loop across every linked playlist affordable - most cycles find nothing
  // changed, so they cost 1 call instead of up to 5.
  let snapshotId = null;
  try {
    snapshotId = await getPlaylistSnapshotId(token.accessToken, playlist.spotify_playlist_id);
  } catch (err) {
    console.error('Spotify snapshot check failed:', err.message);
    return;
  }
  if (snapshotId && snapshotId === playlist.spotify_snapshot_id) return; // unchanged since last sync

  const [localRows] = await pool.query('SELECT id, track_uri, sync_status FROM playlist_tracks WHERE playlist_id = ?', [playlist.id]);
  const localUris = new Set(localRows.map(r => r.track_uri));

  const remoteTracks = [];
  try {
    // "track" was renamed to "item" per entry too (Feb 2026), but Spotify
    // still sends the deprecated "track" field alongside it for now - request
    // and accept either so this keeps working through the transition.
    let path = `/playlists/${playlist.spotify_playlist_id}/items?limit=100&fields=next,items(item(uri,name,artists(name)),track(uri,name,artists(name)))`;
    while (path && remoteTracks.length < 500) {
      const data = await spotifyFetch(token.accessToken, path);
      for (const entry of data.items || []) {
        const track = entry.item || entry.track;
        if (!track || !track.uri) continue;
        remoteTracks.push({ uri: track.uri, name: track.name, artist: (track.artists || []).map(a => a.name).join(', ') });
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

  if (snapshotId) {
    await pool.query('UPDATE playlists SET spotify_snapshot_id = ? WHERE id = ?', [snapshotId, playlist.id]);
  }
}

// "dauerhaft synchronisiert" - keeps every linked playlist reconciled even
// when nobody has it open, instead of relying solely on someone visiting the
// Playlists page (which still triggers its own throttled sync on read, on
// top of this). Shares the same throttle map above, so this and any
// concurrent on-demand read never double up on the same playlist.
// 3 minutes (was 30s): this is a passive "eventually consistent" backstop,
// not a gameplay-critical feature - a few minutes' staleness is imperceptible,
// but polling every linked playlist across the whole server every 30s does
// add up over hours of uptime and was a real contributor to tripping
// Spotify's own (undisclosed, sometimes hours-long) rate limit, which - since
// spotifyFetch's cooldown is shared process-wide - then blocks every OTHER
// server-mediated Spotify feature too (room-scoped search, delegate playlist
// browsing, ...) for however long Spotify decided to enforce it.
const BACKGROUND_SYNC_INTERVAL_MS = 3 * 60 * 1000;
async function backgroundSyncAllLinkedPlaylists() {
  if (isSpotifyRateLimited()) return; // already blocked - don't burn a DB query attempting every playlist just to fail each one
  const pool = await getPool();
  if (!pool) return; // DB not configured/unreachable this cycle - just skip, try again next interval
  try {
    const [rows] = await pool.query('SELECT id, user_id, spotify_playlist_id, spotify_snapshot_id FROM playlists WHERE spotify_playlist_id IS NOT NULL');
    for (const row of rows) {
      await pullTracksFromSpotify(pool, row.user_id, { id: row.id, spotify_playlist_id: row.spotify_playlist_id, spotify_snapshot_id: row.spotify_snapshot_id })
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

  // A track may only appear once per playlist. If it's already there but
  // staged for deletion, re-adding it just cancels that deletion (same
  // effect as the explicit undo-delete route below) instead of erroring -
  // that's the more useful interpretation of "add this track again".
  // Anything else already present is a real duplicate and gets rejected.
  const [existingRows] = await req.db.query(
    'SELECT id, sync_status FROM playlist_tracks WHERE playlist_id = ? AND track_uri = ?',
    [playlist.id, uri]
  );
  const existing = existingRows[0];
  if (existing) {
    if (existing.sync_status !== 'pending_delete') {
      return res.status(409).json({ error: 'track_already_in_playlist' });
    }
    await req.db.query('UPDATE playlist_tracks SET sync_status = "synced" WHERE id = ?', [existing.id]);
    // reactivated (not a new row) - the caller should update the existing
    // track in place rather than append a duplicate/bump the track count.
    return res.json({ track: { id: existing.id, uri, name, artist: artist || '', syncStatus: 'synced' }, reactivated: true });
  }

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

// Cancels a staged deletion before it's pushed to Spotify - the only
// resolution path 'pending_delete' was previously missing (it could only be
// confirmed, never undone).
router.post('/:id/tracks/:trackId/undo-delete', asyncRoute(async (req, res) => {
  const playlist = await getOwnedPlaylist(req.db, req.params.id, req.userId);
  if (!playlist) return res.status(404).json({ error: 'playlist_not_found' });

  const [rows] = await req.db.query('SELECT sync_status FROM playlist_tracks WHERE id = ? AND playlist_id = ?', [req.params.trackId, playlist.id]);
  const track = rows[0];
  if (!track) return res.status(404).json({ error: 'track_not_found' });
  if (track.sync_status !== 'pending_delete') return res.status(409).json({ error: 'track_not_pending' });

  await req.db.query('UPDATE playlist_tracks SET sync_status = "synced" WHERE id = ?', [req.params.trackId]);
  res.json({ success: true, syncStatus: 'synced' });
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
    const snapshotId = await pushTrackAddToSpotify(req.db, req.userId, playlist.spotify_playlist_id, track.track_uri);
    if (!snapshotId) return res.status(502).json({ error: 'spotify_push_failed' });
    await req.db.query('UPDATE playlist_tracks SET sync_status = "synced" WHERE id = ?', [track.id]);
    if (typeof snapshotId === 'string') await req.db.query('UPDATE playlists SET spotify_snapshot_id = ? WHERE id = ?', [snapshotId, playlist.id]);
    return res.json({ success: true, syncStatus: 'synced' });
  }

  if (track.sync_status === 'pending_delete') {
    const snapshotId = await pushTrackRemoveToSpotify(req.db, req.userId, playlist.spotify_playlist_id, track.track_uri);
    if (!snapshotId) return res.status(502).json({ error: 'spotify_push_failed' });
    await req.db.query('DELETE FROM playlist_tracks WHERE id = ?', [track.id]);
    if (typeof snapshotId === 'string') await req.db.query('UPDATE playlists SET spotify_snapshot_id = ? WHERE id = ?', [snapshotId, playlist.id]);
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

// Turns an app-only playlist (never imported, no spotify_playlist_id) into a
// live-linked one: creates a brand-new playlist on the user's real Spotify
// account, bulk-pushes every track already in it, then links it exactly like
// an imported playlist - from this point on it's reconciled the same way, by
// pullTracksFromSpotify and the background sync loop.
router.post('/:id/link-to-spotify', asyncRoute(async (req, res) => {
  const playlist = await getOwnedPlaylist(req.db, req.params.id, req.userId);
  if (!playlist) return res.status(404).json({ error: 'playlist_not_found' });
  if (playlist.spotify_playlist_id) return res.status(409).json({ error: 'already_linked' });

  const token = await getValidAccessToken(req.db, req.userId);
  if (!token) return res.status(409).json({ error: 'spotify_not_connected' });

  const [accountRows] = await req.db.query('SELECT spotify_user_id FROM spotify_accounts WHERE user_id = ?', [req.userId]);
  const spotifyUserId = accountRows[0]?.spotify_user_id;
  if (!spotifyUserId) return res.status(409).json({ error: 'spotify_not_connected' });

  const [tracks] = await req.db.query('SELECT track_uri FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC', [playlist.id]);

  let created;
  let snapshotId = null;
  try {
    created = await spotifyFetch(token.accessToken, `/users/${spotifyUserId}/playlists`, {
      method: 'POST',
      body: { name: playlist.name, public: false },
    });
    snapshotId = created.snapshot_id || null;
    // Spotify caps a single add-items call at 100 URIs. Each add-items
    // response already carries the resulting snapshot_id, so the last batch
    // leaves us with the playlist's final state for free - no extra call
    // needed to seed pullTracksFromSpotify's snapshot check below.
    for (let i = 0; i < tracks.length; i += 100) {
      const batch = tracks.slice(i, i + 100).map(t => t.track_uri);
      const addResult = await spotifyFetch(token.accessToken, `/playlists/${created.id}/items`, { method: 'POST', body: { uris: batch } });
      snapshotId = addResult?.snapshot_id || snapshotId;
    }
  } catch (err) {
    console.error('Failed to create/populate Spotify playlist:', err.message);
    return res.status(502).json({ error: 'spotify_push_failed' });
  }

  await req.db.query('UPDATE playlists SET spotify_playlist_id = ?, spotify_snapshot_id = ? WHERE id = ?', [created.id, snapshotId, playlist.id]);
  await req.db.query('UPDATE playlist_tracks SET sync_status = "synced" WHERE playlist_id = ?', [playlist.id]);
  lastPullSyncedAt.set(playlist.id, Date.now()); // just pushed everything ourselves, skip an immediate redundant pull-sync

  res.json({ playlist: { id: playlist.id, name: playlist.name, spotifyPlaylistId: created.id, trackCount: tracks.length } });
}));

// Shared by the /import route below and autoImportDeathstepPlaylists - fetches
// every track on the given Spotify playlist and inserts it as a new,
// already-linked app playlist in one step (rather than create-then-import) so
// a rejected duplicate import never leaves an orphaned empty playlist behind.
// Linked playlists stay reconciled going forward via pullTracksFromSpotify
// (see above) and the background loop. Caller must already have checked for
// an existing (userId, spotifyPlaylistId) row.
async function importPlaylistForUser(pool, userId, accessToken, spotifyPlaylistId, name) {
  const tracks = [];
  let path = `/playlists/${spotifyPlaylistId}/items?limit=100&fields=next,items(item(uri,name,artists(name)),track(uri,name,artists(name)))`;
  while (path && tracks.length < 500) {
    const data = await spotifyFetch(accessToken, path);
    for (const entry of data.items || []) {
      const track = entry.item || entry.track;
      if (!track || !track.uri) continue; // skip local/unavailable tracks
      tracks.push({
        uri: track.uri,
        name: track.name,
        artist: (track.artists || []).map(a => a.name).join(', '),
      });
    }
    path = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }

  const [result] = await pool.query(
    'INSERT INTO playlists (user_id, name, spotify_playlist_id) VALUES (?, ?, ?)',
    [userId, name, spotifyPlaylistId]
  );
  const playlistId = result.insertId;

  if (tracks.length > 0) {
    const values = tracks.map((t, i) => [playlistId, t.uri, t.name, t.artist, i]);
    await pool.query('INSERT INTO playlist_tracks (playlist_id, track_uri, track_name, artist_name, position) VALUES ?', [values]);
  }
  lastPullSyncedAt.set(playlistId, Date.now()); // fresh import already has everything, skip an immediate redundant pull-sync

  return { id: playlistId, name, trackCount: tracks.length, spotifyPlaylistId };
}

// Imports a Spotify playlist as a new, live-linked app playlist in one step.
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

  const token = await getValidAccessToken(req.db, req.userId);
  if (!token) return res.status(409).json({ error: 'spotify_not_connected' });

  const playlist = await importPlaylistForUser(req.db, req.userId, token.accessToken, spotifyPlaylistId, name);
  res.json({ playlist });
}));

// Called right after a player's Spotify connection is accepted as this
// room's playback delegate (server/index.js's resolveSpotifyShareRequest) -
// auto-imports any of that Spotify account's own playlists whose name
// contains "deathstep" (case-insensitive), so the couple of playlists someone
// actually curated for game night show up under their own Playlists page
// immediately, without a manual import first. Best-effort: silently does
// nothing if the connection isn't (or is no longer) valid, and skips anything
// already imported (same rule as the manual /import route above) - never
// throws, since a failure here shouldn't take down the share-accept flow
// that calls it.
export async function autoImportDeathstepPlaylists(pool, userId) {
  const token = await getValidAccessToken(pool, userId);
  if (!token) return;

  const [existingRows] = await pool.query('SELECT spotify_playlist_id FROM playlists WHERE user_id = ? AND spotify_playlist_id IS NOT NULL', [userId]);
  const alreadyImported = new Set(existingRows.map(r => r.spotify_playlist_id));

  const candidates = [];
  let path = '/me/playlists?limit=50';
  while (path && candidates.length < 200) {
    const data = await spotifyFetch(token.accessToken, path);
    candidates.push(...(data.items || []).filter(Boolean));
    path = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }

  const toImport = candidates.filter(p => p.name?.toLowerCase().includes('deathstep') && !alreadyImported.has(p.id));
  for (const p of toImport) {
    try {
      await importPlaylistForUser(pool, userId, token.accessToken, p.id, p.name);
    } catch (err) {
      console.error(`Auto-import of Spotify playlist "${p.name}" failed:`, err.message);
    }
  }
}

// Resolves basic metadata (title only - no auth needed) for a public Spotify
// URL via Spotify's oEmbed endpoint, so a playlist/track link can be saved
// even by a user with no Spotify connection of their own at all. Returns null
// for anything that isn't a reachable/public Spotify link.
export async function fetchSpotifyOEmbed(url) {
  const response = await fetch(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

// Spotify share links sometimes include a locale segment before the resource
// type (e.g. https://open.spotify.com/intl-de/track/ID) depending on the
// user's region/language settings - optional so plain links still match too.
export const SPOTIFY_PLAYLIST_URL_RE = /open\.spotify\.com\/(?:[a-zA-Z-]+\/)?playlist\/([a-zA-Z0-9]+)/;
export const SPOTIFY_TRACK_URL_RE = /open\.spotify\.com\/(?:[a-zA-Z-]+\/)?track\/([a-zA-Z0-9]+)/;

// Saves a Spotify playlist as a bare reference (name only, no tracks) purely
// from its public share link - no Spotify connection required at all. If this
// user later connects Spotify, the background sync loop (see
// backgroundSyncAllLinkedPlaylists above) picks it up automatically and
// starts pulling in its real tracks, exactly like a normal import - nothing
// extra to do at that point.
router.post('/import-by-link', asyncRoute(async (req, res) => {
  const url = (req.body?.url || '').trim();
  const match = url.match(SPOTIFY_PLAYLIST_URL_RE);
  if (!match) return res.status(400).json({ error: 'invalid_spotify_link' });
  const spotifyPlaylistId = match[1];

  const [existing] = await req.db.query(
    'SELECT id FROM playlists WHERE user_id = ? AND spotify_playlist_id = ?',
    [req.userId, spotifyPlaylistId]
  );
  if (existing[0]) return res.status(409).json({ error: 'already_imported' });

  const meta = await fetchSpotifyOEmbed(url);
  if (!meta) return res.status(400).json({ error: 'invalid_spotify_link' });

  const [result] = await req.db.query(
    'INSERT INTO playlists (user_id, name, spotify_playlist_id) VALUES (?, ?, ?)',
    [req.userId, meta.title || 'Spotify Playlist', spotifyPlaylistId]
  );
  res.json({ playlist: { id: result.insertId, name: meta.title || 'Spotify Playlist', trackCount: 0, spotifyPlaylistId } });
}));

// Adds a single track to one of this user's own (non-Spotify-connected)
// playlists purely from its public share link - same oEmbed metadata source
// as import-by-link above, so no Spotify connection is required. oEmbed only
// ever returns a track's title, never its artist separately, so artist is
// left blank here.
router.post('/:id/tracks/by-link', asyncRoute(async (req, res) => {
  const playlist = await getOwnedPlaylist(req.db, req.params.id, req.userId);
  if (!playlist) return res.status(404).json({ error: 'playlist_not_found' });

  const url = (req.body?.url || '').trim();
  const match = url.match(SPOTIFY_TRACK_URL_RE);
  if (!match) return res.status(400).json({ error: 'invalid_spotify_link' });
  const uri = `spotify:track:${match[1]}`;

  // track_name/artist_name are selected (not just id/sync_status) because the
  // reactivate response below hands them straight back to the client - they
  // were missing here before, which silently sent back name: undefined /
  // artist: undefined (dropped entirely by JSON.stringify), showing a blank
  // track until the next full reload re-fetched the real row from the DB.
  const [existingRows] = await req.db.query('SELECT id, sync_status, track_name, artist_name FROM playlist_tracks WHERE playlist_id = ? AND track_uri = ?', [playlist.id, uri]);
  const existing = existingRows[0];
  if (existing) {
    if (existing.sync_status !== 'pending_delete') return res.status(409).json({ error: 'track_already_in_playlist' });
    await req.db.query('UPDATE playlist_tracks SET sync_status = "synced" WHERE id = ?', [existing.id]);
    return res.json({ track: { id: existing.id, uri, name: existing.track_name, artist: existing.artist_name, syncStatus: 'synced' }, reactivated: true });
  }

  const meta = await fetchSpotifyOEmbed(url);
  if (!meta) return res.status(400).json({ error: 'invalid_spotify_link' });

  const syncStatus = playlist.spotify_playlist_id ? 'pending_add' : 'synced';
  const position = await nextTrackPosition(req.db, playlist.id);
  const [result] = await req.db.query(
    'INSERT INTO playlist_tracks (playlist_id, track_uri, track_name, artist_name, position, sync_status) VALUES (?, ?, ?, ?, ?, ?)',
    [playlist.id, uri, meta.title || uri, '', position, syncStatus]
  );
  res.json({ track: { id: result.insertId, uri, name: meta.title || uri, artist: '', syncStatus } });
}));

export default router;
