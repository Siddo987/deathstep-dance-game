import { Router } from 'express';
import { requireDb } from './db.js';
import { getUserIdFromRequest } from './authToken.js';
import gameStore from './gameStore.js';

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

export default router;
