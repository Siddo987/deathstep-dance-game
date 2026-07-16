import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { OAuth2Client } from 'google-auth-library';
import { requireDb } from './db.js';
import { COOKIE_NAME, COOKIE_MAX_AGE, cookieOptions, signToken, getUserIdFromRequest } from './authToken.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const googleClient = process.env.GOOGLE_CLIENT_ID ? new OAuth2Client(process.env.GOOGLE_CLIENT_ID) : null;

// Without this, a thrown DB error (dropped connection, etc.) inside an async
// route handler just hangs the request instead of returning a clean error -
// same pattern as spotify.js/playlists.js's own asyncRoute.
function asyncRoute(handler) {
  return (req, res, next) => {
    Promise.resolve(handler(req, res, next)).catch(err => {
      console.error('Auth route error:', err.message);
      if (!res.headersSent) res.status(500).json({ error: 'unknown_error' });
    });
  };
}

function setAuthCookie(res, user) {
  res.cookie(COOKIE_NAME, signToken(user.id), { ...cookieOptions(), maxAge: COOKIE_MAX_AGE });
}

function sanitizeUser(row) {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    defaultDanceRole: row.default_dance_role ?? null,
    defaultIsFlexible: !!row.default_is_flexible,
    leaderboardOptIn: !!row.leaderboard_opt_in,
  };
}

const router = Router();
router.use(requireDb);

router.post('/register', asyncRoute(async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password || '';
  const displayName = (req.body?.displayName || '').trim();

  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (password.length < 8) return res.status(400).json({ error: 'weak_password' });
  if (!displayName) return res.status(400).json({ error: 'missing_display_name' });

  const [existing] = await req.db.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length > 0) return res.status(409).json({ error: 'email_taken' });

  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await req.db.query(
    'INSERT INTO users (email, password_hash, display_name) VALUES (?, ?, ?)',
    [email, passwordHash, displayName]
  );
  const user = { id: result.insertId, email, display_name: displayName };
  setAuthCookie(res, user);
  res.json({ user: sanitizeUser(user) });
}));

router.post('/login', asyncRoute(async (req, res) => {
  const email = (req.body?.email || '').trim().toLowerCase();
  const password = req.body?.password || '';

  const [rows] = await req.db.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];
  if (!user || !user.password_hash) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  setAuthCookie(res, user);
  res.json({ user: sanitizeUser(user) });
}));

router.post('/google', asyncRoute(async (req, res) => {
  if (!googleClient) return res.status(503).json({ error: 'google_unavailable' });

  const credential = req.body?.credential;
  if (!credential) return res.status(400).json({ error: 'missing_credential' });

  let payload;
  try {
    const ticket = await googleClient.verifyIdToken({ idToken: credential, audience: process.env.GOOGLE_CLIENT_ID });
    payload = ticket.getPayload();
  } catch (err) {
    return res.status(401).json({ error: 'invalid_google_token' });
  }

  const googleId = payload.sub;
  const email = (payload.email || '').toLowerCase();

  const [byGoogleId] = await req.db.query('SELECT * FROM users WHERE google_id = ?', [googleId]);
  let user = byGoogleId[0];

  if (!user) {
    // Refuse to silently merge into an existing password account just
    // because the email matches, even though Google has verified it -
    // registration never verifies email ownership, so an attacker could
    // register a victim's email with a password first and wait for the
    // real owner to later "Sign in with Google". Auto-linking here would
    // hand the attacker's pre-made account to the real owner while the
    // attacker still knows the password - a classic account pre-hijacking
    // vector. Linking has to be an explicit, authenticated action instead
    // (not implemented here), never a side effect of login.
    if (email) {
      const [byEmail] = await req.db.query('SELECT id FROM users WHERE email = ?', [email]);
      if (byEmail[0]) return res.status(409).json({ error: 'email_registered' });
    }

    const displayName = payload.name || (email ? email.split('@')[0] : 'Player');
    const [result] = await req.db.query(
      'INSERT INTO users (email, google_id, display_name) VALUES (?, ?, ?)',
      [email || null, googleId, displayName]
    );
    user = { id: result.insertId, email: email || null, google_id: googleId, display_name: displayName };
  }

  setAuthCookie(res, user);
  res.json({ user: sanitizeUser(user) });
}));

router.post('/logout', (req, res) => {
  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ success: true });
});

router.get('/me', asyncRoute(async (req, res) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.json({ user: null });

  const [rows] = await req.db.query('SELECT * FROM users WHERE id = ?', [userId]);
  if (!rows[0]) return res.json({ user: null });
  res.json({ user: sanitizeUser(rows[0]) });
}));

router.put('/me', asyncRoute(async (req, res) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: 'not_authenticated' });

  const displayName = (req.body?.displayName || '').trim();
  const defaultDanceRole = req.body?.defaultDanceRole ?? null;
  // undefined (field omitted) means "no change", same as defaultDanceRole
  // above - only an explicit true/false overwrites. Resolved via SQL COALESCE
  // below rather than defaulting to false here, since `?? null` on a boolean
  // can't distinguish "omitted" from "explicitly false" once converted to 0/1.
  const defaultIsFlexible = req.body?.defaultIsFlexible;
  const leaderboardOptIn = req.body?.leaderboardOptIn;

  if (!displayName) return res.status(400).json({ error: 'missing_display_name' });
  if (defaultDanceRole !== null && defaultDanceRole !== 'lead' && defaultDanceRole !== 'follow') {
    return res.status(400).json({ error: 'invalid_dance_role' });
  }

  await req.db.query(
    `UPDATE users SET
      display_name = ?,
      default_dance_role = ?,
      default_is_flexible = COALESCE(?, default_is_flexible),
      leaderboard_opt_in = COALESCE(?, leaderboard_opt_in)
     WHERE id = ?`,
    [
      displayName,
      defaultDanceRole,
      defaultIsFlexible === undefined ? null : (defaultIsFlexible ? 1 : 0),
      leaderboardOptIn === undefined ? null : (leaderboardOptIn ? 1 : 0),
      userId,
    ]
  );

  const [rows] = await req.db.query('SELECT * FROM users WHERE id = ?', [userId]);
  res.json({ user: sanitizeUser(rows[0]) });
}));

export default router;
