import { Router } from 'express';
import { requireDb } from './db.js';
import { getUserIdFromRequest } from './authToken.js';
import { didKillersWin } from './gameStore.js';

// The full set of achievement types - client/src/locales/*.js hold the
// display title/description for each key (achievements.<key>Title/Desc), so
// this list is the single source of truth for which keys exist at all. Order
// here is also the display order on the dashboard.
export const ACHIEVEMENT_KEYS = [
  'first_kill',
  'first_killed',
  'voted_out_innocent',
  'voted_out_guilty',
  'voted_against_teammate',
  'voted_innocent_who_got_voted_out',
  'voted_guilty_who_got_voted_out',
  'lone_accuser',
  'first_win',
  'survivor',
  'games_played',
];

// A count of 1-9 is just "earned"; 10/50/100 upgrade it to bronze/silver/gold
// (see the feature request: "10/50/100 von jedem Achievement -> Bronze-,
// Silber- und Goldversion"). null means not earned at all yet.
export function tierForCount(count) {
  if (count >= 100) return 'gold';
  if (count >= 50) return 'silver';
  if (count >= 10) return 'bronze';
  if (count >= 1) return 'base';
  return null;
}

// Derives, from one fully concluded game's room object, which achievements
// each account-linked player earned - at most once per type per game
// (a Set, not a counter) regardless of how many of this game's own rounds
// contributed to it. That's deliberate: the 10/50/100 tiers are meant to
// reward playing many separate games, not farming one long game's rounds -
// each Set here only ever adds 1 to that type's lifetime count in
// recordGameAchievements below, win or lose.
//
// room.roundHistory (see gameStore.js's pushRoundRecord) is the only place
// round-by-round detail survives - couples/players themselves only reflect
// final end-of-game state, so killer-couple aliveness per round is
// reconstructed here by simulating forward through the rounds in order.
function evaluateGameAchievements(room) {
  const earnedByUser = new Map(); // userId -> Set<achievementKey>
  // Max Kills has no permanent killer/dancer team, no win/loss, and never
  // pushes to room.roundHistory (see the new-roles/modes plan) - none of the
  // achievements below make sense for it. Everyone would otherwise wrongly
  // earn 'first_win'/'survivor' every single Max Kills game, since the
  // tournament always ends with every couple's role reset to 'dancer' and
  // couple.status never flips away from 'alive'. A future update could add
  // its own ranking-based achievement type; for now this mode simply awards
  // nothing.
  if (room.gameMode === 'maxkills') return earnedByUser;
  const award = (userId, key) => {
    if (!userId) return;
    if (!earnedByUser.has(userId)) earnedByUser.set(userId, new Set());
    earnedByUser.get(userId).add(key);
  };
  const awardCouple = (coupleId, key) => {
    const couple = room.couples.find(c => c.id === coupleId);
    if (!couple) return;
    couple.playerIds.forEach(playerId => {
      const player = room.players.find(p => p.id === playerId);
      if (player?.userId) award(player.userId, key);
    });
  };

  for (const round of room.roundHistory) {
    // Who actually held the killer role *this* round, snapshotted at the
    // time (see gameStore.js's pushRoundRecord) - not derived from the
    // room's final state, which under Chaos mode only reflects whoever was
    // killer most recently and would misattribute every earlier round.
    // Falls back to an empty list for any pre-existing round record from
    // before this field existed (there shouldn't be any in practice, since
    // room.roundHistory never outlives a single room's process lifetime).
    const roundKillerCoupleIds = round.killerCoupleIds || [];

    if (round.killedCoupleIds.length > 0) {
      let attributedKillerIds = [];
      if (round.killClaims) {
        // Silent mode: only a claim that actually matches a real kill this
        // round counts - a claim the GM overrode/ignored shouldn't credit anyone.
        attributedKillerIds = Object.entries(round.killClaims)
          .filter(([, victimCoupleId]) => victimCoupleId && round.killedCoupleIds.includes(victimCoupleId))
          .map(([killerCoupleId]) => killerCoupleId);
      } else if (roundKillerCoupleIds.length === 1) {
        // Classic mode has no per-kill attribution at all (the GM just marks
        // a victim) - only safe to credit when exactly one killer couple
        // could possibly be responsible.
        attributedKillerIds = [...roundKillerCoupleIds];
      }
      attributedKillerIds.forEach(id => awardCouple(id, 'first_kill'));
      round.killedCoupleIds.forEach(id => awardCouple(id, 'first_killed'));
    }

    // Every role check below reads roundKillerCoupleIds (this round's
    // snapshot) rather than couple.role directly - under Chaos mode, a
    // still-alive couple's live role only reflects whoever holds it *now*,
    // which for an earlier round in the same game would misjudge who was
    // actually the killer back then. An eliminated couple's role happens to
    // stay frozen at whatever it was when they died (Chaos re-assignment
    // only ever touches alive couples), so this distinction only matters
    // for couples that survived the whole game - but checking the snapshot
    // uniformly is simplest, and correct for standard-mode games too (where
    // it's always equal to the live role anyway).
    const votedOutCouple = round.votedOutCoupleId ? room.couples.find(c => c.id === round.votedOutCoupleId) : null;
    if (votedOutCouple) {
      awardCouple(votedOutCouple.id, roundKillerCoupleIds.includes(votedOutCouple.id) ? 'voted_out_guilty' : 'voted_out_innocent');
    }

    const suspectVoterIds = new Map(); // suspectCoupleId -> voterCoupleId[]
    for (const vote of round.votes) {
      if (!vote.suspectCoupleId || vote.voterCoupleId === vote.suspectCoupleId) continue;
      const voterCouple = room.couples.find(c => c.id === vote.voterCoupleId);
      const suspectCouple = room.couples.find(c => c.id === vote.suspectCoupleId);
      if (!voterCouple || !suspectCouple) continue;

      if (roundKillerCoupleIds.includes(voterCouple.id) && roundKillerCoupleIds.includes(suspectCouple.id)) {
        awardCouple(voterCouple.id, 'voted_against_teammate');
      }
      if (votedOutCouple && vote.suspectCoupleId === votedOutCouple.id) {
        awardCouple(voterCouple.id, roundKillerCoupleIds.includes(votedOutCouple.id) ? 'voted_guilty_who_got_voted_out' : 'voted_innocent_who_got_voted_out');
      }
      if (!suspectVoterIds.has(vote.suspectCoupleId)) suspectVoterIds.set(vote.suspectCoupleId, []);
      suspectVoterIds.get(vote.suspectCoupleId).push(vote.voterCoupleId);
    }
    for (const [suspectCoupleId, voterIds] of suspectVoterIds) {
      if (voterIds.length !== 1) continue; // "als Einziger" - must be the sole accuser
      if (roundKillerCoupleIds.includes(suspectCoupleId)) awardCouple(voterIds[0], 'lone_accuser');
    }
  }

  const killersWon = didKillersWin(room);
  for (const player of room.players) {
    if (!player.userId) continue;
    award(player.userId, 'games_played');
    const couple = room.couples.find(c => c.playerIds.includes(player.id));
    if (!couple) continue;
    if (couple.status === 'alive') award(player.userId, 'survivor');
    if ((couple.role === 'killer') === killersWon) award(player.userId, 'first_win');
  }

  return earnedByUser;
}

// Called once per naturally-concluded game from stats.js's
// recordGameConclusion (never for an aborted one - see its own comment).
// Bumps each earned type's lifetime counter by exactly 1 for this game.
export async function recordGameAchievements(pool, room) {
  const earnedByUser = evaluateGameAchievements(room);
  for (const [userId, keys] of earnedByUser) {
    for (const key of keys) {
      await pool.query(
        `INSERT INTO achievement_progress (user_id, achievement_key, count, first_earned_at, last_earned_at)
         VALUES (?, ?, 1, NOW(), NOW())
         ON DUPLICATE KEY UPDATE count = count + 1, last_earned_at = NOW()`,
        [userId, key]
      );
    }
  }
}

function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error('Achievements route error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'unknown_error' });
    });
  };
}

function requireAuth(req, res, next) {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: 'not_authenticated' });
  req.userId = userId;
  next();
}

const router = Router();
router.use(requireDb);
router.use(requireAuth);

// Every achievement type, including ones this account hasn't earned yet
// (count 0, tier null) - the dashboard needs the full list to show locked
// achievements too, not just unlocked ones.
router.get('/me', asyncRoute(async (req, res) => {
  const [rows] = await req.db.query('SELECT achievement_key, count FROM achievement_progress WHERE user_id = ?', [req.userId]);
  const countByKey = new Map(rows.map(r => [r.achievement_key, Number(r.count)]));
  res.json({
    achievements: ACHIEVEMENT_KEYS.map(key => {
      const count = countByKey.get(key) || 0;
      return { key, count, tier: tierForCount(count) };
    }),
  });
}));

// "Übersicht über alle Leute mit bestimmtem Achievement" - clicking an
// achievement in your own dashboard. Only lists accounts that opted into
// leaderboard_opt_in (same Settings toggle server/stats.js's public
// /leaderboard route respects) - achievement progress is just as much a
// cross-account activity signal as win/loss stats, so it gets the same
// consent gate rather than a new one.
router.get('/:key/players', asyncRoute(async (req, res) => {
  if (!ACHIEVEMENT_KEYS.includes(req.params.key)) return res.status(404).json({ error: 'unknown_achievement' });
  const [rows] = await req.db.query(
    `SELECT u.id, u.display_name, ap.count
     FROM achievement_progress ap
     JOIN users u ON u.id = ap.user_id
     WHERE ap.achievement_key = ? AND ap.count > 0 AND u.leaderboard_opt_in = 1
     ORDER BY ap.count DESC
     LIMIT 200`,
    [req.params.key]
  );
  res.json({ players: rows.map(r => ({ id: r.id, displayName: r.display_name, count: Number(r.count), tier: tierForCount(Number(r.count)) })) });
}));

export default router;
