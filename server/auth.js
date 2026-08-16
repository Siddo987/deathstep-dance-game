import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { OAuth2Client } from 'google-auth-library';
import { requireDb } from './db.js';
import { COOKIE_NAME, COOKIE_MAX_AGE, cookieOptions, signToken, getUserIdFromRequest } from './authToken.js';
import { sendMail } from './mailer.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Login handle for password accounts (see the /register, /login and
// /forgot-password routes below) - deliberately not the same as
// display_name, which is public-facing and freely re-typeable, unlike a
// login credential.
const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
// Anti-spam floor between two "forgot password" requests for the same
// account - not a real rate limit (no IP tracking), just enough to stop a
// single accidental double-submit or a bored visitor from bombing someone
// else's inbox by repeatedly typing their email into the form.
const RESET_REQUEST_COOLDOWN_MS = 60 * 1000;

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

function sanitizeUser(row, isSuperAdmin = false) {
  return {
    id: row.id,
    email: row.email,
    // Never editable/re-shown as a "username" concept in the UI beyond
    // Settings' read-only display - it's a login handle, not a public name
    // (display_name stays the one users actually change/see elsewhere).
    username: row.username ?? null,
    displayName: row.display_name,
    defaultDanceRole: row.default_dance_role ?? null,
    defaultIsFlexible: !!row.default_is_flexible,
    leaderboardOptIn: !!row.leaderboard_opt_in,
    autoShareSpotify: !!row.auto_share_spotify,
    // Whether this account signs in with a password at all (false for a
    // Google-only signup). Never the hash itself - just enough for Settings'
    // delete-account flow to know whether to ask for a password, matching
    // what the DELETE /me route itself requires.
    hasPassword: !!row.password_hash,
    isSuperAdmin,
  };
}

// Membership in admin_users (see server/db.js) - a plain list of user ids the
// site owner inserts by hand, never through any route. A brand-new account
// (register/google-signup) can never already be in it, so callers creating a
// user don't need to check; every other sanitizeUser call site does.
async function isSuperAdmin(db, userId) {
  const [rows] = await db.query('SELECT 1 FROM admin_users WHERE user_id = ?', [userId]);
  return rows.length > 0;
}

// Resolves a client-supplied ?ref=<userId> invite code (see client/src/App.jsx
// capturing it and Auth.jsx passing it along) into a verified referrer id, or
// null if it's missing/malformed/doesn't match a real account - never trusted
// as-is, since a bogus or self-referential value should just be silently
// dropped rather than stored.
async function resolveReferrer(db, ref) {
  const refUserId = Number(ref);
  if (!Number.isInteger(refUserId) || refUserId <= 0) return null;
  const [rows] = await db.query('SELECT id FROM users WHERE id = ?', [refUserId]);
  return rows[0] ? refUserId : null;
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function hashResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// baseUrl mirrors client/src/spotify.js's getRedirectUri (window.location.
// origin) but has to be computed server-side here, since the email is built
// and sent entirely by the server - APP_URL lets a deployment behind a proxy
// that mangles req.protocol/host pin the real public origin explicitly;
// falling back to the request's own origin (correct in this app's actual
// deployment, which is always same-origin - see server/index.js's CORS
// comment) keeps local dev working with zero extra config.
function resolveBaseUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

function buildResetPasswordEmail(link, displayName) {
  const safeName = escapeHtml(displayName || 'Spieler:in');
  const subject = 'Passwort zurücksetzen – Deathstep';
  const text = `Hallo ${displayName || 'Spieler:in'},\n\n` +
    `du hast angefragt, dein Deathstep-Passwort zurückzusetzen. Klicke auf den folgenden Link, um ein neues Passwort zu vergeben (der Link ist 1 Stunde gültig):\n\n${link}\n\n` +
    `Warst du das nicht, kannst du diese E-Mail einfach ignorieren - an deinem Konto ändert sich dann nichts.`;
  const html = `
    <div style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 480px; margin: 0 auto; color: #111;">
      <h2 style="margin-bottom: 8px;">Passwort zurücksetzen</h2>
      <p>Hallo ${safeName},</p>
      <p>du hast angefragt, dein Deathstep-Passwort zurückzusetzen. Klicke auf den folgenden Button, um ein neues Passwort zu vergeben (der Link ist 1 Stunde gültig):</p>
      <p style="text-align: center; margin: 28px 0;">
        <a href="${link}" style="background: #7c3aed; color: #fff; padding: 12px 26px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: bold;">Neues Passwort vergeben</a>
      </p>
      <p style="font-size: 0.85em; color: #666;">Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:<br>${link}</p>
      <p style="font-size: 0.85em; color: #666;">Warst du das nicht, kannst du diese E-Mail einfach ignorieren - an deinem Konto ändert sich dann nichts.</p>
    </div>
  `;
  return { subject, text, html };
}

const router = Router();
router.use(requireDb);

router.post('/register', asyncRoute(async (req, res) => {
  const emailInput = (req.body?.email || '').trim().toLowerCase();
  const email = emailInput || null; // email is now optional - see username below
  const username = (req.body?.username || '').trim().toLowerCase();
  const password = req.body?.password || '';
  const displayName = (req.body?.displayName || '').trim();

  if (!USERNAME_RE.test(username)) return res.status(400).json({ error: 'invalid_username' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: 'invalid_email' });
  if (password.length < 8) return res.status(400).json({ error: 'weak_password' });
  if (!displayName) return res.status(400).json({ error: 'missing_display_name' });

  const [existingUsername] = await req.db.query('SELECT id FROM users WHERE username = ?', [username]);
  if (existingUsername.length > 0) return res.status(409).json({ error: 'username_taken' });

  if (email) {
    const [existingEmail] = await req.db.query('SELECT id FROM users WHERE email = ?', [email]);
    if (existingEmail.length > 0) return res.status(409).json({ error: 'email_taken' });
  }

  const referredBy = await resolveReferrer(req.db, req.body?.ref);
  const passwordHash = await bcrypt.hash(password, 10);
  const [result] = await req.db.query(
    'INSERT INTO users (email, username, password_hash, display_name, referred_by_user_id) VALUES (?, ?, ?, ?, ?)',
    [email, username, passwordHash, displayName, referredBy]
  );
  const user = { id: result.insertId, email, username, display_name: displayName };
  setAuthCookie(res, user);
  res.json({ user: sanitizeUser(user) });
}));

router.post('/login', asyncRoute(async (req, res) => {
  // "identifier" is either the account's email or its username (see
  // /register above) - email is now optional, so login can no longer assume
  // it's always the one being typed.
  const identifier = (req.body?.identifier || '').trim().toLowerCase();
  const password = req.body?.password || '';
  if (!identifier) return res.status(401).json({ error: 'invalid_credentials' });

  const [rows] = await req.db.query('SELECT * FROM users WHERE email = ? OR username = ?', [identifier, identifier]);
  const user = rows[0];
  if (!user || !user.password_hash) return res.status(401).json({ error: 'invalid_credentials' });

  const ok = await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'invalid_credentials' });

  setAuthCookie(res, user);
  res.json({ user: sanitizeUser(user, await isSuperAdmin(req.db, user.id)) });
}));

// Requests a password-reset email. Always answers the same generic
// { success: true } regardless of whether "identifier" actually matched an
// account, and regardless of whether that account has an email on file at
// all - a "forgot password" form that answers differently for a known vs.
// unknown account/username is a classic account-enumeration leak.
router.post('/forgot-password', asyncRoute(async (req, res) => {
  const identifier = (req.body?.identifier || '').trim().toLowerCase();
  const genericResponse = { success: true };
  if (!identifier) return res.json(genericResponse);

  const [rows] = await req.db.query('SELECT * FROM users WHERE email = ? OR username = ?', [identifier, identifier]);
  const user = rows[0];
  // No match, a Google-only account, or a username account with no email
  // ever added (Settings) - nothing to send to, but the response must look
  // identical to the "sent" case either way.
  if (!user || !user.email) return res.json(genericResponse);

  const [recent] = await req.db.query(
    'SELECT id FROM password_reset_tokens WHERE user_id = ? AND created_at > ? LIMIT 1',
    [user.id, new Date(Date.now() - RESET_REQUEST_COOLDOWN_MS)]
  );
  if (recent.length > 0) return res.json(genericResponse); // already sent one moments ago

  const rawToken = crypto.randomBytes(32).toString('hex');
  await req.db.query(
    'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [user.id, hashResetToken(rawToken), new Date(Date.now() + RESET_TOKEN_TTL_MS)]
  );

  const link = `${resolveBaseUrl(req)}/reset-password?token=${rawToken}`;
  const { subject, text, html } = buildResetPasswordEmail(link, user.display_name);
  await sendMail({ to: user.email, subject, text, html });

  res.json(genericResponse);
}));

// Consumes a token minted above and sets a new password. Auto-logs the user
// in on success (same convenience as /register), since they've just proven
// account ownership via the emailed link.
router.post('/reset-password', asyncRoute(async (req, res) => {
  const token = (req.body?.token || '').trim();
  const newPassword = req.body?.newPassword || '';
  if (!token) return res.status(400).json({ error: 'invalid_or_expired_token' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'weak_password' });

  const [rows] = await req.db.query(
    'SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW() LIMIT 1',
    [hashResetToken(token)]
  );
  const resetRow = rows[0];
  if (!resetRow) return res.status(400).json({ error: 'invalid_or_expired_token' });

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await req.db.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, resetRow.user_id]);
  // A successful reset retires every outstanding link ever emailed for this
  // account, not just the one actually clicked.
  await req.db.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [resetRow.user_id]);

  const [userRows] = await req.db.query('SELECT * FROM users WHERE id = ?', [resetRow.user_id]);
  const user = userRows[0];
  setAuthCookie(res, user);
  res.json({ user: sanitizeUser(user, await isSuperAdmin(req.db, user.id)) });
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
  let admin = false; // brand-new account below can never already be in admin_users

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
    const referredBy = await resolveReferrer(req.db, req.body?.ref);
    const [result] = await req.db.query(
      'INSERT INTO users (email, google_id, display_name, referred_by_user_id) VALUES (?, ?, ?, ?)',
      [email || null, googleId, displayName, referredBy]
    );
    user = { id: result.insertId, email: email || null, google_id: googleId, display_name: displayName };
  } else {
    admin = await isSuperAdmin(req.db, user.id);
  }

  setAuthCookie(res, user);
  res.json({ user: sanitizeUser(user, admin) });
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
  res.json({ user: sanitizeUser(rows[0], await isSuperAdmin(req.db, userId)) });
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
  const autoShareSpotify = req.body?.autoShareSpotify;
  // Unlike the booleans above, `null` is itself a valid target value here
  // (clearing a previously-set email), not just a "no change" sentinel - so
  // this can't reuse the same COALESCE(?, column) trick. undefined (field
  // omitted entirely) is the only "leave it alone" case, handled by simply
  // not touching the column at all below.
  const emailInput = req.body?.email;

  if (!displayName) return res.status(400).json({ error: 'missing_display_name' });
  if (defaultDanceRole !== null && defaultDanceRole !== 'lead' && defaultDanceRole !== 'follow') {
    return res.status(400).json({ error: 'invalid_dance_role' });
  }

  let email;
  if (emailInput !== undefined) {
    const trimmed = (emailInput || '').trim().toLowerCase();
    if (trimmed && !EMAIL_RE.test(trimmed)) return res.status(400).json({ error: 'invalid_email' });
    email = trimmed || null;
    if (email) {
      const [existing] = await req.db.query('SELECT id FROM users WHERE email = ? AND id != ?', [email, userId]);
      if (existing.length > 0) return res.status(409).json({ error: 'email_taken' });
    }
  }

  await req.db.query(
    `UPDATE users SET
      display_name = ?,
      default_dance_role = ?,
      default_is_flexible = COALESCE(?, default_is_flexible),
      leaderboard_opt_in = COALESCE(?, leaderboard_opt_in),
      auto_share_spotify = COALESCE(?, auto_share_spotify)
     WHERE id = ?`,
    [
      displayName,
      defaultDanceRole,
      defaultIsFlexible === undefined ? null : (defaultIsFlexible ? 1 : 0),
      leaderboardOptIn === undefined ? null : (leaderboardOptIn ? 1 : 0),
      autoShareSpotify === undefined ? null : (autoShareSpotify ? 1 : 0),
      userId,
    ]
  );
  if (email !== undefined) {
    await req.db.query('UPDATE users SET email = ? WHERE id = ?', [email, userId]);
  }

  const [rows] = await req.db.query('SELECT * FROM users WHERE id = ?', [userId]);
  res.json({ user: sanitizeUser(rows[0], await isSuperAdmin(req.db, userId)) });
}));

// Permanent, self-service account deletion (see Settings.jsx's danger zone).
//
// A single DELETE on the users row is enough for everything that hangs off
// it: server/db.js declares every user-owned table ON DELETE CASCADE
// (playlists -> playlist_tracks, spotify_accounts, achievement_progress,
// game_participations, gm_sessions, password_reset_tokens, admin_users) and
// every shared-history table ON DELETE SET NULL (games.gm_user_id,
// game_couple_members.user_id, feedback.user_id). So the account and its
// personal data go, while other players' game records stay intact and simply
// stop being attributed to anyone - deleting those outright would corrupt
// past games for everyone else who played in them.
//
// The three things no FK covers are cleaned up by hand first: other accounts
// still pointing at this one as their referrer (no FK by design, see the
// column's own comment in db.js), and the news send-log rows keyed by this
// account's email address (no FK either - it stores the address, not a user
// id, so a cascade could never have reached it, and leaving personal contact
// data behind after a deletion request is exactly what this route exists to
// prevent).
router.delete('/me', asyncRoute(async (req, res) => {
  const userId = getUserIdFromRequest(req);
  if (!userId) return res.status(401).json({ error: 'not_authenticated' });

  const [rows] = await req.db.query('SELECT id, email, password_hash FROM users WHERE id = ?', [userId]);
  const user = rows[0];
  if (!user) {
    // Session cookie outlived the row (already deleted elsewhere) - clear it
    // so the browser stops presenting a token for an account that's gone.
    res.clearCookie(COOKIE_NAME, cookieOptions());
    return res.json({ success: true });
  }

  // Re-authenticate before something irreversible. Only possible for accounts
  // that have a password at all - a Google-only signup has no second factor
  // to ask for here, and the session cookie is sameSite:'lax' + httpOnly, so
  // a request that got this far already came from the account's own browser
  // in a top-level context.
  if (user.password_hash) {
    const password = req.body?.password || '';
    if (!password) return res.status(400).json({ error: 'missing_password' });
    if (!await bcrypt.compare(password, user.password_hash)) {
      return res.status(401).json({ error: 'invalid_password' });
    }
  }

  await req.db.query('UPDATE users SET referred_by_user_id = NULL WHERE referred_by_user_id = ?', [userId]);
  if (user.email) {
    await req.db.query('DELETE FROM news_recipients WHERE email = ?', [user.email]);
  }
  await req.db.query('DELETE FROM users WHERE id = ?', [userId]);

  res.clearCookie(COOKIE_NAME, cookieOptions());
  res.json({ success: true });
}));

export default router;
