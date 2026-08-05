import { Router } from 'express';
import { requireDb } from './db.js';
import { getUserIdFromRequest } from './authToken.js';

const router = Router();
router.use(requireDb);

// Public - no login required (see client/src/components/Feedback.jsx). Used
// to just append to a flat file with no way to review it; now stored so a
// developer account can browse/triage it from the hidden Dev Dashboard (see
// server/admin.js's /feedback routes).
router.post('/', async (req, res) => {
  // name/message are client-controlled free text with no auth behind this
  // endpoint - cap their length so one request can't balloon the table.
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const message = String(req.body?.message || '').trim().slice(0, 2000);
  if (!message) return res.status(400).json({ success: false });

  const userId = getUserIdFromRequest(req);
  await req.db.query(
    'INSERT INTO feedback (user_id, name, message) VALUES (?, ?, ?)',
    [userId || null, name || null, message]
  );
  res.json({ success: true });
});

export default router;
