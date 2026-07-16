import jwt from 'jsonwebtoken';

export const COOKIE_NAME = 'deathstep_token';
export const TOKEN_TTL = '30d';
export const COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000;

export function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  };
}

export function signToken(userId) {
  return jwt.sign({ userId }, process.env.JWT_SECRET, { expiresIn: TOKEN_TTL });
}

function verifyTokenValue(token) {
  if (!token) return null;
  try {
    return jwt.verify(token, process.env.JWT_SECRET).userId;
  } catch (err) {
    return null;
  }
}

// Reads/verifies the login cookie and returns the userId, or null if there
// isn't a valid session - callers decide what "not logged in" means for them
// (auth.js's /me returns { user: null }, stats.js's /me does the same).
export function getUserIdFromRequest(req) {
  return verifyTokenValue(req.cookies?.[COOKIE_NAME]);
}

// Same as getUserIdFromRequest, but for a socket.io connection instead of an
// Express request - socket.io doesn't run cookie-parser, so the cookie
// header has to be parsed by hand. Cookies ride along automatically on the
// handshake's HTTP request (same-origin, per client/src/socket.js), so this
// is the only trustworthy source of "who is this socket" - never accept a
// userId supplied in an event payload instead, since that's just a value the
// client typed and can be set to anyone's id (see server/index.js's
// createRoom/joinRoom handlers).
export function getUserIdFromSocket(socket) {
  const header = socket.handshake.headers?.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key !== COOKIE_NAME) continue;
    try {
      return verifyTokenValue(decodeURIComponent(part.slice(idx + 1).trim()));
    } catch (err) {
      return null;
    }
  }
  return null;
}
