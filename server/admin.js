import { Router } from 'express';
import { requireDb } from './db.js';
import { getUserIdFromRequest } from './authToken.js';
import gameStore from './gameStore.js';
import { fetchSpotifyOEmbed, SPOTIFY_TRACK_URL_RE, SPOTIFY_PLAYLIST_URL_RE } from './playlists.js';
import { getValidAccessToken, fetchPlaylistTracksWithToken, asyncRoute } from './spotify.js';
import { sendMail } from './mailer.js';

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Deliberately answers 404 (not 401/403) to anyone who isn't listed in
// admin_users (see server/db.js) - this endpoint is only ever called from a
// menu item that's itself hidden unless the logged-in account is listed
// there, so a 401/403 would just confirm to a curious visitor that
// /api/admin/* exists at all.
async function requireSuperAdmin(req, res, next) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(404).end();
  const [rows] = await req.db.query('SELECT 1 FROM admin_users WHERE user_id = ?', [userId]);
  if (rows.length === 0) return res.status(404).end();
  next();
}

const router = Router();
router.use(requireDb);
router.use(requireSuperAdmin);

// room.pairOverrides/killerOverridePlayerIds live only on the in-memory room
// object (gameStore.js) - re-set live from GMDashboard's admin menu item
// before every round, never persisted to the DB. sanitizeRoomForGM/ForPlayer
// strip both fields out (they must never reach the room's own GM broadcast),
// so this is the only way to read or change them - the rest of the room's
// state (players/couples/status) is already available to the caller via the
// normal room prop/socket updates, no need to duplicate it here.
router.get('/rooms/:roomId/overrides', (req, res) => {
  const room = gameStore.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  res.json({ pairOverrides: room.pairOverrides, killerOverridePlayerIds: room.killerOverridePlayerIds });
});

router.post('/rooms/:roomId/pair-override', (req, res) => {
  const { playerIdA, playerIdB } = req.body || {};
  const result = gameStore.addPairOverride(req.params.roomId, playerIdA, playerIdB);
  if (!result) return res.status(404).json({ error: 'room_not_found' });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ success: true, pairOverrides: result.pairOverrides });
});

router.delete('/rooms/:roomId/pair-override/:index', (req, res) => {
  const result = gameStore.removePairOverride(req.params.roomId, Number(req.params.index));
  if (!result) return res.status(404).json({ error: 'room_not_found' });
  res.json({ success: true, pairOverrides: result.pairOverrides });
});

router.post('/rooms/:roomId/killer-override', (req, res) => {
  const { playerId } = req.body || {};
  const result = gameStore.addKillerOverride(req.params.roomId, playerId);
  if (!result) return res.status(404).json({ error: 'room_not_found' });
  if (result.error) return res.status(400).json({ error: result.error });
  res.json({ success: true, killerOverridePlayerIds: result.killerOverridePlayerIds });
});

router.delete('/rooms/:roomId/killer-override/:playerId', (req, res) => {
  const result = gameStore.removeKillerOverride(req.params.roomId, req.params.playerId);
  if (!result) return res.status(404).json({ error: 'room_not_found' });
  res.json({ success: true, killerOverridePlayerIds: result.killerOverridePlayerIds });
});

// Dev Dashboard - feedback submitted via the public /api/feedback form (see
// server/feedback.js) reviewed here instead of only ever sitting in a flat
// file. Newest first, capped at 200 rows so an old, never-cleaned-up backlog
// can't make this page slow to load.
router.get('/feedback', async (req, res) => {
  const [rows] = await req.db.query(
    `SELECT f.id, f.user_id, f.name, f.message, f.is_read, f.created_at, u.display_name AS user_display_name
     FROM feedback f LEFT JOIN users u ON u.id = f.user_id
     ORDER BY f.created_at DESC LIMIT 200`
  );
  res.json({ feedback: rows });
});

// Polled from Home.jsx (only for a currentUser.isSuperAdmin account) to show
// a notification badge on the hidden Dev Dashboard entry point.
router.get('/feedback/unread-count', async (req, res) => {
  const [rows] = await req.db.query('SELECT COUNT(*) AS count FROM feedback WHERE is_read = 0');
  res.json({ count: rows[0].count });
});

router.post('/feedback/:id/read', async (req, res) => {
  await req.db.query('UPDATE feedback SET is_read = 1 WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

router.delete('/feedback/:id', async (req, res) => {
  await req.db.query('DELETE FROM feedback WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// The killer-count suggestion's tunable divisor (see server/db.js's
// dev_settings table and GMDashboard.jsx) - read here for the Dev Dashboard's
// editor; every GM's own dashboard instead reads the public, unauthenticated
// /api/dev-settings/killer-ratio route in server/index.js, since it needs
// the current value too but isn't a developer account.
router.get('/dev-settings', async (req, res) => {
  const [rows] = await req.db.query('SELECT killer_ratio_divisor FROM dev_settings WHERE id = 1');
  res.json({ killerRatioDivisor: rows[0]?.killer_ratio_divisor ?? 8 });
});

router.put('/dev-settings', async (req, res) => {
  const divisor = Math.round(Number(req.body?.killerRatioDivisor));
  if (!Number.isFinite(divisor) || divisor < 1) return res.status(400).json({ error: 'invalid_divisor' });
  await req.db.query('UPDATE dev_settings SET killer_ratio_divisor = ? WHERE id = 1', [divisor]);
  res.json({ success: true, killerRatioDivisor: divisor });
});

// Dev-curated fallback songs (see server/db.js's fallback_songs table and the
// public GET /api/fallback-songs/random in server/index.js, offered to a GM
// who bypasses the "song ready" lock with no track selected at all). Added
// purely from a pasted Spotify track link (same oEmbed metadata source as
// server/playlists.js's tracks/by-link route) so a dev never needs their own
// Spotify connection just to curate this list.
router.get('/fallback-songs', async (req, res) => {
  const [rows] = await req.db.query('SELECT id, track_uri, track_name, artist_name FROM fallback_songs ORDER BY added_at DESC');
  res.json({ songs: rows.map(r => ({ id: r.id, uri: r.track_uri, name: r.track_name, artist: r.artist_name })) });
});

router.post('/fallback-songs', async (req, res) => {
  const url = (req.body?.url || '').trim();
  const match = url.match(SPOTIFY_TRACK_URL_RE);
  if (!match) return res.status(400).json({ error: 'invalid_spotify_link' });
  const uri = `spotify:track:${match[1]}`;

  const meta = await fetchSpotifyOEmbed(url);
  if (!meta) return res.status(400).json({ error: 'invalid_spotify_link' });

  try {
    const [result] = await req.db.query(
      'INSERT INTO fallback_songs (track_uri, track_name, artist_name) VALUES (?, ?, ?)',
      [uri, meta.title || uri, '']
    );
    res.json({ song: { id: result.insertId, uri, name: meta.title || uri, artist: '' } });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'already_added' });
    throw err;
  }
});

router.delete('/fallback-songs/:id', async (req, res) => {
  await req.db.query('DELETE FROM fallback_songs WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Bulk variant of the single-track add above - pulls every track out of a
// public Spotify playlist and inserts them all at once. Unlike the
// single-track route (oEmbed, no auth needed), reading a playlist's actual
// track listing needs a real Spotify Web API call, which needs a real access
// token - reuses the calling dev's own account-linked Spotify connection
// (same one Playlists.jsx uses) rather than adding a separate app-only
// client-credentials flow just for this.
// Wrapped in asyncRoute (see spotify.js) because fetchPlaylistTracksWithToken
// below makes real Spotify Web API calls, which fail far more often than a
// local DB query - a private/deleted/region-locked playlist link, or Spotify
// simply being rate-limited, both throw. Without the wrapper, Express 4
// doesn't catch a rejected async handler, so the request would just hang
// with no response instead of the client ever seeing an error at all.
router.post('/fallback-songs/import-playlist', asyncRoute(async (req, res) => {
  const url = (req.body?.url || '').trim();
  const match = url.match(SPOTIFY_PLAYLIST_URL_RE);
  if (!match) return res.status(400).json({ error: 'invalid_spotify_link' });

  const userId = getUserIdFromRequest(req);
  const token = await getValidAccessToken(req.db, userId);
  if (!token) return res.status(409).json({ error: 'spotify_not_connected' });

  const tracks = await fetchPlaylistTracksWithToken(token.accessToken, match[1]);
  if (tracks.length === 0) return res.status(400).json({ error: 'empty_or_invalid_playlist' });

  const added = [];
  let skipped = 0;
  for (const track of tracks) {
    const uri = track.uri;
    try {
      const [result] = await req.db.query(
        'INSERT INTO fallback_songs (track_uri, track_name, artist_name) VALUES (?, ?, ?)',
        [uri, track.name || uri, track.artist || '']
      );
      added.push({ id: result.insertId, uri, name: track.name || uri, artist: track.artist || '' });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') { skipped++; continue; }
      throw err;
    }
  }
  res.json({ songs: added, addedCount: added.length, skippedCount: skipped });
}));

// Dev Dashboard - browsable history of every concluded/aborted game (see
// server/stats.js's recordGameHistory, the one place that writes any of
// this). List view first, newest first with simple offset pagination (a
// long-running deployment can accumulate a lot of games, unlike the capped
// feedback/fallback-song lists above) - full round-by-round detail is a
// separate route below, fetched only when a dev actually opens one.
router.get('/games', asyncRoute(async (req, res) => {
  const limit = Math.min(Math.max(Number(req.query.limit) || 30, 1), 100);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const [rows] = await req.db.query(
    `SELECT g.id, g.room_id, g.kill_mode, g.started_at, g.ended_at, g.aborted, g.killers_won,
      u.display_name AS gm_display_name,
      (SELECT COUNT(*) FROM game_couple_members gcm
        JOIN game_couples gc ON gc.id = gcm.game_couple_id WHERE gc.game_id = g.id) AS player_count,
      (SELECT COUNT(*) FROM game_rounds gr WHERE gr.game_id = g.id) AS round_count
    FROM games g
    LEFT JOIN users u ON u.id = g.gm_user_id
    ORDER BY g.ended_at DESC
    LIMIT ? OFFSET ?`,
    [limit, offset]
  );
  const [[{ total }]] = await req.db.query('SELECT COUNT(*) AS total FROM games');
  res.json({
    games: rows.map(r => ({
      id: r.id,
      roomId: r.room_id,
      gmDisplayName: r.gm_display_name,
      killMode: r.kill_mode,
      startedAt: r.started_at,
      endedAt: r.ended_at,
      aborted: !!r.aborted,
      killersWon: r.killers_won === null ? null : !!r.killers_won,
      playerCount: Number(r.player_count),
      roundCount: Number(r.round_count),
    })),
    total: Number(total),
  });
}));

// Full detail for one game - every couple and its members, every round with
// its kills/votes/kill-claims/victim-reports (couple names resolved inline
// so the client never has to cross-reference ids itself), and every song
// played. Several small queries rather than one giant join, since the round-
// level child tables (kills/votes/claims/reports) would otherwise multiply
// each other out into a huge cross product.
router.get('/games/:id', asyncRoute(async (req, res) => {
  const gameId = Number(req.params.id);
  if (!Number.isInteger(gameId)) return res.status(400).json({ error: 'invalid_id' });

  const [gameRows] = await req.db.query(
    `SELECT g.id, g.room_id, g.kill_mode, g.started_at, g.ended_at, g.aborted, g.killers_won,
      u.display_name AS gm_display_name
    FROM games g LEFT JOIN users u ON u.id = g.gm_user_id WHERE g.id = ?`,
    [gameId]
  );
  if (gameRows.length === 0) return res.status(404).json({ error: 'game_not_found' });
  const g = gameRows[0];

  const [coupleMemberRows] = await req.db.query(
    `SELECT gc.id AS couple_id, gc.couple_key, gc.name, gc.role, gc.final_status,
      gcm.id AS member_id, gcm.player_name, gcm.dance_role, gcm.user_id AS member_user_id,
      mu.display_name AS member_display_name
    FROM game_couples gc
    LEFT JOIN game_couple_members gcm ON gcm.game_couple_id = gc.id
    LEFT JOIN users mu ON mu.id = gcm.user_id
    WHERE gc.game_id = ?
    ORDER BY gc.id, gcm.id`,
    [gameId]
  );
  const couplesById = new Map();
  const coupleNameById = new Map();
  for (const row of coupleMemberRows) {
    if (!couplesById.has(row.couple_id)) {
      couplesById.set(row.couple_id, {
        id: row.couple_id,
        coupleKey: row.couple_key,
        name: row.name,
        role: row.role,
        finalStatus: row.final_status,
        members: [],
      });
      coupleNameById.set(row.couple_id, row.name);
    }
    if (row.member_id) {
      couplesById.get(row.couple_id).members.push({
        id: row.member_id,
        playerName: row.player_name,
        danceRole: row.dance_role,
        userId: row.member_user_id,
        userDisplayName: row.member_display_name,
      });
    }
  }
  const coupleName = (id) => (id == null ? null : (coupleNameById.get(id) || null));

  const [roundRows] = await req.db.query(
    `SELECT id, round_number, completed, eliminated_by_vote_couple_id FROM game_rounds WHERE game_id = ? ORDER BY round_number`,
    [gameId]
  );
  const roundIds = roundRows.map(r => r.id);

  let killRows = [], voteRows = [], claimRows = [], reportRows = [];
  if (roundIds.length > 0) {
    [[killRows], [voteRows], [claimRows], [reportRows]] = await Promise.all([
      req.db.query('SELECT game_round_id, killed_couple_id FROM game_round_kills WHERE game_round_id IN (?)', [roundIds]),
      req.db.query('SELECT game_round_id, voter_couple_id, voting_player_name, suspect_couple_id FROM game_round_votes WHERE game_round_id IN (?)', [roundIds]),
      req.db.query('SELECT game_round_id, killer_couple_id, victim_couple_id FROM game_round_kill_claims WHERE game_round_id IN (?)', [roundIds]),
      req.db.query('SELECT game_round_id, couple_id, felt_killed, suspect_couple_id FROM game_round_victim_reports WHERE game_round_id IN (?)', [roundIds]),
    ]);
  }
  const byRound = (rows) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row.game_round_id)) map.set(row.game_round_id, []);
      map.get(row.game_round_id).push(row);
    }
    return map;
  };
  const killsByRound = byRound(killRows);
  const votesByRound = byRound(voteRows);
  const claimsByRound = byRound(claimRows);
  const reportsByRound = byRound(reportRows);

  const rounds = roundRows.map(r => ({
    id: r.id,
    roundNumber: r.round_number,
    completed: !!r.completed,
    eliminatedByVote: r.eliminated_by_vote_couple_id
      ? { coupleId: r.eliminated_by_vote_couple_id, coupleName: coupleName(r.eliminated_by_vote_couple_id) }
      : null,
    kills: (killsByRound.get(r.id) || []).map(k => ({ coupleId: k.killed_couple_id, coupleName: coupleName(k.killed_couple_id) })),
    votes: (votesByRound.get(r.id) || []).map(v => ({
      voterCoupleId: v.voter_couple_id,
      voterCoupleName: coupleName(v.voter_couple_id),
      votingPlayerName: v.voting_player_name,
      suspectCoupleId: v.suspect_couple_id,
      suspectCoupleName: coupleName(v.suspect_couple_id),
    })),
    killClaims: (claimsByRound.get(r.id) || []).map(c => ({
      killerCoupleId: c.killer_couple_id,
      killerCoupleName: coupleName(c.killer_couple_id),
      victimCoupleId: c.victim_couple_id,
      victimCoupleName: coupleName(c.victim_couple_id),
    })),
    victimReports: (reportsByRound.get(r.id) || []).map(vr => ({
      coupleId: vr.couple_id,
      coupleName: coupleName(vr.couple_id),
      feltKilled: !!vr.felt_killed,
      suspectCoupleId: vr.suspect_couple_id,
      suspectCoupleName: coupleName(vr.suspect_couple_id),
    })),
  }));

  const [songRows] = await req.db.query(
    `SELECT round_number, track_uri, spotify_url, track_name, artist_name, played_at
    FROM game_played_songs WHERE game_id = ? ORDER BY played_at`,
    [gameId]
  );

  res.json({
    game: {
      id: g.id,
      roomId: g.room_id,
      gmDisplayName: g.gm_display_name,
      killMode: g.kill_mode,
      startedAt: g.started_at,
      endedAt: g.ended_at,
      aborted: !!g.aborted,
      killersWon: g.killers_won === null ? null : !!g.killers_won,
      couples: Array.from(couplesById.values()),
      rounds,
      playedSongs: songRows.map(s => ({
        roundNumber: s.round_number,
        trackUri: s.track_uri,
        spotifyUrl: s.spotify_url,
        trackName: s.track_name,
        artistName: s.artist_name,
        playedAt: s.played_at,
      })),
    },
  });
}));

// News posts (see server/db.js's news_posts) - written and optionally
// emailed from here; no public listing route, this is a one-way
// announcement, not a changelog visitors browse (that's /roadmap below).
// Wrapped in asyncRoute (like /games and /roadmap-items below) now that this
// runs two sequential queries instead of one - an unhandled rejection from
// either would otherwise crash the whole process (Express 4 doesn't catch
// async route errors on its own, and there's no process-level
// unhandledRejection handler), same crash class as the 2026-08-09 incident
// even though this specific route is superadmin-gated.
router.get('/news', asyncRoute(async (req, res) => {
  const [rows] = await req.db.query(
    'SELECT id, title, body, sent_at, recipient_count, created_at FROM news_posts ORDER BY created_at DESC LIMIT 100'
  );
  // Recipients are fetched in one extra query and grouped in JS rather than
  // joined - a JOIN would repeat title/body once per recipient row, and at
  // this deployment's scale (small friend group, a handful of posts) that's
  // not worth the extra parsing complexity over just two queries.
  const postIds = rows.map(r => r.id);
  const recipientsByPost = new Map();
  if (postIds.length > 0) {
    const [recipientRows] = await req.db.query(
      'SELECT news_post_id, email, success, sent_at FROM news_recipients WHERE news_post_id IN (?) ORDER BY sent_at ASC',
      [postIds]
    );
    for (const r of recipientRows) {
      if (!recipientsByPost.has(r.news_post_id)) recipientsByPost.set(r.news_post_id, []);
      recipientsByPost.get(r.news_post_id).push({ email: r.email, success: !!r.success, sentAt: r.sent_at });
    }
  }
  res.json({
    news: rows.map(r => ({
      id: r.id,
      title: r.title,
      body: r.body,
      sentAt: r.sent_at,
      recipientCount: r.recipient_count,
      createdAt: r.created_at,
      recipients: recipientsByPost.get(r.id) || [],
    })),
  });
}));

// sendEmail is opt-in per post - a dev can also just save an entry for the
// record without mailing anyone. Sent to every account with an email on
// file, sequentially (this is a small friend-group deployment, not a mailing
// list at any scale where that would matter) - one failed address (bounced,
// typo'd during registration, whatever) must not stop the rest from going
// out, so failures are only reflected in recipientCount coming back lower
// than the total user count, never thrown.
router.post('/news', asyncRoute(async (req, res) => {
  const title = (req.body?.title || '').trim();
  const body = (req.body?.body || '').trim();
  const sendEmail = !!req.body?.sendEmail;
  if (!title || !body) return res.status(400).json({ error: 'missing_fields' });

  let sentAt = null;
  let recipientCount = null;
  const recipients = [];
  if (sendEmail) {
    const [users] = await req.db.query('SELECT email FROM users WHERE email IS NOT NULL');
    recipientCount = 0;
    const html = `
      <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
        <h2 style="margin-bottom: 8px;">${escapeHtml(title)}</h2>
        <p style="white-space: pre-wrap;">${escapeHtml(body)}</p>
      </div>
    `;
    for (const u of users) {
      const ok = await sendMail({ to: u.email, subject: title, text: body, html });
      if (ok) recipientCount++;
      recipients.push({ email: u.email, success: ok, sentAt: new Date() });
    }
    sentAt = new Date();
  }

  const [result] = await req.db.query(
    'INSERT INTO news_posts (title, body, sent_at, recipient_count) VALUES (?, ?, ?, ?)',
    [title, body, sentAt, recipientCount]
  );
  // Per-recipient log for later review (see server/db.js's news_recipients) -
  // written even for failed sends so a bounced/typo'd address stays visible
  // instead of just quietly missing from recipientCount.
  if (recipients.length > 0) {
    await req.db.query(
      'INSERT INTO news_recipients (news_post_id, email, success, sent_at) VALUES ?',
      [recipients.map(r => [result.insertId, r.email, r.success, r.sentAt])]
    );
  }
  res.json({ news: { id: result.insertId, title, body, sentAt, recipientCount, createdAt: new Date(), recipients } });
}));

router.delete('/news/:id', asyncRoute(async (req, res) => {
  // Also clears this post's news_recipients rows (see server/db.js's table
  // comment) - there's no FK/cascade, so without this the recipient log
  // would just orphan silently: no route ever queries news_recipients
  // independent of news_posts, so those rows would become permanently
  // invisible dead data instead of any kind of surviving history.
  await req.db.query('DELETE FROM news_recipients WHERE news_post_id = ?', [req.params.id]);
  await req.db.query('DELETE FROM news_posts WHERE id = ?', [req.params.id]);
  res.json({ success: true });
}));

// Roadmap items (see server/db.js's roadmap_items) - the dev-panel editor
// behind this admin_users gate; the public-facing read is the unauthenticated
// GET /api/roadmap in server/index.js.
router.get('/roadmap-items', async (req, res) => {
  const [rows] = await req.db.query('SELECT id, title, description, status, sort_order FROM roadmap_items ORDER BY status, sort_order');
  res.json({ items: rows.map(r => ({ id: r.id, title: r.title, description: r.description, status: r.status, sortOrder: r.sort_order })) });
});

const ROADMAP_STATUSES = ['planned', 'in_progress', 'done'];

// Wrapped in asyncRoute (see the /news comment above) - both routes below
// run 2-3 sequential queries, more failure surface than a single-query
// route, so an unhandled rejection here would otherwise crash the process.
router.post('/roadmap-items', asyncRoute(async (req, res) => {
  const title = (req.body?.title || '').trim();
  const description = (req.body?.description || '').trim() || null;
  const status = ROADMAP_STATUSES.includes(req.body?.status) ? req.body.status : 'planned';
  if (!title) return res.status(400).json({ error: 'missing_title' });

  const [[{ maxOrder }]] = await req.db.query(
    'SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM roadmap_items WHERE status = ?',
    [status]
  );
  const sortOrder = maxOrder + 1;
  const [result] = await req.db.query(
    'INSERT INTO roadmap_items (title, description, status, sort_order) VALUES (?, ?, ?, ?)',
    [title, description, status, sortOrder]
  );
  res.json({ item: { id: result.insertId, title, description, status, sortOrder } });
}));

router.put('/roadmap-items/:id', asyncRoute(async (req, res) => {
  const title = (req.body?.title || '').trim();
  const description = (req.body?.description || '').trim() || null;
  const status = ROADMAP_STATUSES.includes(req.body?.status) ? req.body.status : null;
  if (!title || !status) return res.status(400).json({ error: 'missing_fields' });

  const [[existing]] = await req.db.query('SELECT status FROM roadmap_items WHERE id = ?', [req.params.id]);
  if (!existing) return res.status(404).json({ error: 'not_found' });

  // Moving to a different status column drops it to the end of the new one
  // (a dev can then use the move buttons to place it precisely) rather than
  // trying to preserve a sort_order that was only ever meaningful within its
  // old column.
  let sortOrder;
  if (existing.status !== status) {
    const [[{ maxOrder }]] = await req.db.query(
      'SELECT COALESCE(MAX(sort_order), -1) AS maxOrder FROM roadmap_items WHERE status = ?',
      [status]
    );
    sortOrder = maxOrder + 1;
  }
  if (sortOrder === undefined) {
    await req.db.query('UPDATE roadmap_items SET title = ?, description = ?, status = ? WHERE id = ?', [title, description, status, req.params.id]);
  } else {
    await req.db.query('UPDATE roadmap_items SET title = ?, description = ?, status = ?, sort_order = ? WHERE id = ?', [title, description, status, sortOrder, req.params.id]);
  }
  res.json({ success: true });
}));

router.delete('/roadmap-items/:id', async (req, res) => {
  await req.db.query('DELETE FROM roadmap_items WHERE id = ?', [req.params.id]);
  res.json({ success: true });
});

// Swaps this item's sort_order with its immediate neighbor within the same
// status column (direction: 'up' or 'down') - the only reordering operation
// the dev-panel needs, so a full drag-and-drop reorder endpoint would be
// more machinery than the actual use case (a handful of items per column).
router.post('/roadmap-items/:id/move', asyncRoute(async (req, res) => {
  const direction = req.body?.direction;
  if (direction !== 'up' && direction !== 'down') return res.status(400).json({ error: 'invalid_direction' });

  const [[item]] = await req.db.query('SELECT id, status, sort_order FROM roadmap_items WHERE id = ?', [req.params.id]);
  if (!item) return res.status(404).json({ error: 'not_found' });

  const [[neighbor]] = await req.db.query(
    direction === 'up'
      ? 'SELECT id, sort_order FROM roadmap_items WHERE status = ? AND sort_order < ? ORDER BY sort_order DESC LIMIT 1'
      : 'SELECT id, sort_order FROM roadmap_items WHERE status = ? AND sort_order > ? ORDER BY sort_order ASC LIMIT 1',
    [item.status, item.sort_order]
  );
  if (!neighbor) return res.json({ success: true }); // already at the edge, nothing to swap

  await req.db.query('UPDATE roadmap_items SET sort_order = ? WHERE id = ?', [neighbor.sort_order, item.id]);
  await req.db.query('UPDATE roadmap_items SET sort_order = ? WHERE id = ?', [item.sort_order, neighbor.id]);
  res.json({ success: true });
}));

export default router;
