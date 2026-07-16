import { Router } from 'express';
import { getPool, requireDb } from './db.js';
import { getUserIdFromRequest } from './authToken.js';

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

// Same winner predicate as gameStore.js's checkEndCondition(), reapplied
// after the room has already flipped to 'ended' so we don't need gameStore
// to hand us the answer directly.
function didKillersWin(room) {
  const aliveCouples = room.couples.filter(c => c.status === 'alive');
  const killersAlive = aliveCouples.some(c => c.role === 'killer');
  if (!killersAlive) return false;
  const aliveKillers = aliveCouples.filter(c => c.role === 'killer').length;
  const aliveDancers = aliveCouples.length - aliveKillers;
  return aliveKillers >= aliveDancers;
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

    // An aborted game has no winner, so it doesn't count as a win/loss for
    // anyone - only that it was hosted (recorded above).
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
