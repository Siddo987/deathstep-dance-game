import { Router } from 'express';
import { getPool, requireDb } from './db.js';
import { getUserIdFromRequest } from './authToken.js';
import { didKillersWin } from './gameStore.js';
import { recordGameAchievements } from './achievements.js';

// Without this, a thrown DB error inside an async route handler just hangs
// the request instead of returning a clean error - same pattern as
// spotify.js/playlists.js's own asyncRoute.
function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error('Stats route error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'unknown_error' });
    });
  };
}

// Spotify's "track" URIs (spotify:track:ID) are what room.playedSongs stores
// (see gameStore.js's addPlayedSong) - this derives the shareable web link
// for game_played_songs.spotify_url, null for anything that doesn't match
// that shape (there shouldn't be anything else, but this is persistence code
// for a live game's data, not worth throwing over).
function spotifyUriToUrl(uri) {
  const match = /^spotify:track:([A-Za-z0-9]+)$/.exec(uri || '');
  return match ? `https://open.spotify.com/track/${match[1]}` : null;
}

// Persists the full round-by-round history captured in room.roundHistory
// (see gameStore.js's pushRoundRecord/revealKill/executeVote/endGame) plus
// every couple/member and played song - fully normalized (not JSON) so any
// of it - who was a killer, who voted for whom, who claimed which kill - is
// directly queryable later once a frontend exists to browse it. Runs
// regardless of `aborted`, unlike the win/loss participation stats below it:
// a log of what actually happened is still useful for a game cut short.
async function recordGameHistory(pool, room, { aborted }) {
  const killersWon = aborted ? null : didKillersWin(room);
  const [gameResult] = await pool.query(
    'INSERT INTO games (room_id, gm_user_id, kill_mode, started_at, aborted, killers_won) VALUES (?, ?, ?, ?, ?, ?)',
    [room.id, room.gmUserId || null, room.killMode, new Date(room.startedAt || Date.now()), aborted ? 1 : 0, killersWon === null ? null : (killersWon ? 1 : 0)]
  );
  const gameId = gameResult.insertId;

  // Maps this room's transient couple ids (e.g. 'couple_0', reused across
  // different games) to this game's own game_couples row id, since every
  // other table below references couples by that stable DB id instead.
  const coupleDbIdByRoomId = new Map();
  for (const couple of room.couples) {
    const [coupleResult] = await pool.query(
      'INSERT INTO game_couples (game_id, couple_key, name, role, final_status, special_role, eliminated_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [gameId, couple.id, couple.name, couple.role, couple.status, couple.specialRole || null, couple.eliminatedBy || null]
    );
    coupleDbIdByRoomId.set(couple.id, coupleResult.insertId);

    const members = room.players.filter(p => couple.playerIds.includes(p.id));
    if (members.length > 0) {
      const values = members.map(p => [coupleResult.insertId, p.name, p.userId || null, p.danceRole]);
      await pool.query('INSERT INTO game_couple_members (game_couple_id, player_name, user_id, dance_role) VALUES ?', [values]);
    }
  }

  for (const round of room.roundHistory) {
    const eliminatedByVoteDbId = round.votedOutCoupleId ? (coupleDbIdByRoomId.get(round.votedOutCoupleId) || null) : null;
    const [roundResult] = await pool.query(
      'INSERT INTO game_rounds (game_id, round_number, completed, eliminated_by_vote_couple_id) VALUES (?, ?, ?, ?)',
      [gameId, round.roundNumber, round.completed ? 1 : 0, eliminatedByVoteDbId]
    );
    const roundId = roundResult.insertId;

    if (round.killedCoupleIds.length > 0) {
      const values = round.killedCoupleIds
        .filter(coupleId => coupleDbIdByRoomId.has(coupleId))
        .map(coupleId => [roundId, coupleDbIdByRoomId.get(coupleId)]);
      if (values.length > 0) {
        await pool.query('INSERT INTO game_round_kills (game_round_id, killed_couple_id) VALUES ?', [values]);
      }
    }

    if (round.votes.length > 0) {
      const values = round.votes
        .filter(v => coupleDbIdByRoomId.has(v.voterCoupleId))
        .map(v => [
          roundId,
          coupleDbIdByRoomId.get(v.voterCoupleId),
          v.votingPlayerName,
          v.suspectCoupleId ? (coupleDbIdByRoomId.get(v.suspectCoupleId) || null) : null,
        ]);
      if (values.length > 0) {
        await pool.query('INSERT INTO game_round_votes (game_round_id, voter_couple_id, voting_player_name, suspect_couple_id) VALUES ?', [values]);
      }
    }

    if (round.killClaims) {
      const entries = Object.entries(round.killClaims).filter(([killerCoupleId]) => coupleDbIdByRoomId.has(killerCoupleId));
      if (entries.length > 0) {
        const values = entries.map(([killerCoupleId, victimCoupleId]) => [
          roundId,
          coupleDbIdByRoomId.get(killerCoupleId),
          victimCoupleId ? (coupleDbIdByRoomId.get(victimCoupleId) || null) : null,
        ]);
        await pool.query('INSERT INTO game_round_kill_claims (game_round_id, killer_couple_id, victim_couple_id) VALUES ?', [values]);
      }
    }

    if (round.victimReports) {
      const entries = Object.entries(round.victimReports).filter(([coupleId]) => coupleDbIdByRoomId.has(coupleId));
      if (entries.length > 0) {
        const values = entries.map(([coupleId, report]) => [
          roundId,
          coupleDbIdByRoomId.get(coupleId),
          report.feltKilled ? 1 : 0,
          report.suspectCoupleId ? (coupleDbIdByRoomId.get(report.suspectCoupleId) || null) : null,
        ]);
        await pool.query('INSERT INTO game_round_victim_reports (game_round_id, couple_id, felt_killed, suspect_couple_id) VALUES ?', [values]);
      }
    }
  }

  if (room.playedSongs.length > 0) {
    const values = room.playedSongs.map(song => [
      gameId,
      song.round ?? null,
      song.uri,
      spotifyUriToUrl(song.uri),
      song.name,
      song.artist || '',
      new Date(song.playedAt),
    ]);
    await pool.query(
      'INSERT INTO game_played_songs (game_id, round_number, track_uri, spotify_url, track_name, artist_name, played_at) VALUES ?',
      [values]
    );
  }
}

// Called once per game conclusion (natural or aborted) from server/index.js.
// Stats are a bonus on top of the core (DB-free) party game, so a missing/
// unreachable DB - or any write failure - must never take down the game.
export async function recordGameConclusion(room, { aborted }) {
  const pool = await getPool();
  if (!pool) return;

  try {
    const gmUserIds = new Set();
    if (room.gmUserId) gmUserIds.add(room.gmUserId);
    (room.coGms || []).forEach(g => { if (g.userId) gmUserIds.add(g.userId); });

    for (const userId of gmUserIds) {
      await pool.query('INSERT INTO gm_sessions (user_id, room_id) VALUES (?, ?)', [userId, room.id]);
    }

    await recordGameHistory(pool, room, { aborted });

    // An aborted game has no winner, so it doesn't count as a win/loss for
    // anyone - only that it was hosted (recorded above). Achievements are the
    // same: "erst nach Beenden der Runde" (only after a game actually
    // concludes) - a cut-short game grants none.
    if (aborted) return;

    const killersWon = didKillersWin(room);
    for (const player of room.players) {
      if (!player.userId) continue;
      const couple = room.couples.find(c => c.playerIds.includes(player.id));
      if (!couple) continue;
      const won = (couple.role === 'killer') === killersWon;
      await pool.query(
        'INSERT INTO game_participations (user_id, room_id, role, won) VALUES (?, ?, ?, ?)',
        [player.userId, room.id, couple.role, won ? 1 : 0]
      );
    }

    await recordGameAchievements(pool, room);
  } catch (err) {
    console.error('Failed to record game conclusion stats:', err.message);
  }
}

const router = Router();

router.get('/me', requireDb, asyncRoute(async (req, res) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.json({ stats: null });

  const [participationRows] = await req.db.query(
    `SELECT
      COUNT(*) as gamesPlayed,
      COALESCE(SUM(won), 0) as wins,
      COALESCE(SUM(role = 'killer'), 0) as killerGames,
      COALESCE(SUM(role = 'killer' AND won), 0) as killerWins,
      COALESCE(SUM(role = 'dancer'), 0) as dancerGames,
      COALESCE(SUM(role = 'dancer' AND won), 0) as dancerWins
    FROM game_participations WHERE user_id = ?`,
    [userId]
  );
  const [hostingRows] = await req.db.query(
    'SELECT COUNT(*) as gamesHosted FROM gm_sessions WHERE user_id = ?',
    [userId]
  );
  // Only counts accounts that actually completed registration through this
  // user's invite link (referred_by_user_id is set once, at registration -
  // see server/auth.js) - never inflated by someone merely clicking the link.
  const [inviteRows] = await req.db.query(
    'SELECT COUNT(*) as invitedCount FROM users WHERE referred_by_user_id = ?',
    [userId]
  );

  const p = participationRows[0];
  res.json({
    stats: {
      gamesPlayed: Number(p.gamesPlayed),
      wins: Number(p.wins),
      killerGames: Number(p.killerGames),
      killerWins: Number(p.killerWins),
      dancerGames: Number(p.dancerGames),
      dancerWins: Number(p.dancerWins),
      gamesHosted: Number(hostingRows[0].gamesHosted),
      invitedCount: Number(inviteRows[0].invitedCount),
    },
  });
}));

// Public - no login required to view. Only lists accounts that opted in via
// Settings. Two independent rankings, since "wins" and "games hosted" aren't
// comparable on one scale - a GM-only account has no win/loss record at all,
// and a player-only account never hosts, so each list is its own JOIN
// (not a LEFT JOIN + HAVING) to naturally exclude accounts with zero of that kind.
router.get('/leaderboard', requireDb, asyncRoute(async (req, res) => {
  const [playerRows] = await req.db.query(`
    SELECT u.id, u.display_name,
      COUNT(gp.id) as gamesPlayed,
      COALESCE(SUM(gp.won), 0) as wins
    FROM users u
    JOIN game_participations gp ON gp.user_id = u.id
    WHERE u.leaderboard_opt_in = 1
    GROUP BY u.id
    ORDER BY wins DESC, gamesPlayed DESC
    LIMIT 100
  `);

  const [hostRows] = await req.db.query(`
    SELECT u.id, u.display_name, COUNT(gs.id) as gamesHosted
    FROM users u
    JOIN gm_sessions gs ON gs.user_id = u.id
    WHERE u.leaderboard_opt_in = 1
    GROUP BY u.id
    ORDER BY gamesHosted DESC
    LIMIT 100
  `);

  res.json({
    players: playerRows.map(row => ({
      id: row.id,
      displayName: row.display_name,
      gamesPlayed: Number(row.gamesPlayed),
      wins: Number(row.wins),
    })),
    hosts: hostRows.map(row => ({
      id: row.id,
      displayName: row.display_name,
      gamesHosted: Number(row.gamesHosted),
    })),
  });
}));

export default router;
