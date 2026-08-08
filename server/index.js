import './loadEnv.js';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';
import gameStore, { sanitizeRoomForGM, sanitizeRoomForPlayer } from './gameStore.js';
import { getUserIdFromSocket } from './authToken.js';
import authRouter from './auth.js';
import statsRouter, { recordGameConclusion } from './stats.js';
import spotifyRouter, { getValidAccessToken, searchTracksWithToken, fetchPlaylistsWithToken, fetchPlaylistTracksWithToken } from './spotify.js';
import playlistsRouter, { autoImportDeathstepPlaylists } from './playlists.js';
import adminRouter from './admin.js';
import feedbackRouter from './feedback.js';
import achievementsRouter from './achievements.js';
import { getPool } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());
app.use(cookieParser());
app.use('/api/auth', authRouter);
app.use('/api/stats', statsRouter);
app.use('/api/spotify', spotifyRouter);
app.use('/api/playlists', playlistsRouter);
app.use('/api/admin', adminRouter);
app.use('/api/feedback', feedbackRouter);
app.use('/api/achievements', achievementsRouter);

// Public, no Deathstep login required - lets any player suggest a real
// Spotify track without connecting their own account, by running the search
// through whichever GM/co-GM/delegate in the room already has a working
// Spotify connection (search itself is public catalog data, so it needs no
// per-caller identity - only playback/personal-playlist access does).
// See client/src/spotifyPlaylists.js's searchTracksInRoom, used by
// PlayerScreen.jsx's suggestion flow.
app.get('/api/rooms/:roomId/spotify-search', async (req, res) => {
  const room = gameStore.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });

  const q = (req.query.q || '').trim();
  if (!q) return res.json({ tracks: [] });

  const pool = await getPool();
  if (!pool) return res.status(409).json({ error: 'gm_spotify_not_connected' });

  // room.spotifyDelegate first: if a player lent their Spotify connection to
  // the room (see requestSpotifyShareToRoom/resolveSpotifyShareRequest),
  // that's the connection actually in use for the room right now - without
  // this, a room whose only working Spotify came from a player's share
  // (rather than the GM's own account) could never let ANY player search for
  // a song to suggest, since this route previously only ever looked at
  // room.gmUserId/coGms.
  const candidateUserIds = [room.spotifyDelegate?.userId, room.gmUserId, ...(room.coGms || []).map(g => g.userId)].filter(Boolean);
  for (const userId of candidateUserIds) {
    const token = await getValidAccessToken(pool, userId);
    if (!token) continue;
    try {
      const tracks = await searchTracksWithToken(token.accessToken, q);
      return res.json({ tracks });
    } catch (err) {
      console.error('Room-scoped Spotify search failed:', err.message);
      if (err.spotifyRateLimited) return res.status(429).json({ error: 'spotify_rate_limited', retryAfterSeconds: err.retryAfterSeconds });
      return res.status(502).json({ error: 'spotify_request_failed' });
    }
  }
  return res.status(409).json({ error: 'gm_spotify_not_connected' });
});

// Public, no Deathstep login required (same room-code trust boundary as
// spotify-search above) - mints a short-lived access token for the GM's
// browser from whichever player has currently lent their account-linked
// Spotify connection to this room (see gameStore.setSpotifyDelegate /
// socket events grantSpotifyToRoom/revokeSpotifyFromRoom). Only ever used
// for search/playback (GMDashboard.jsx's getPlaybackToken) - the app has no
// UI that would use a borrowed token to modify the donor's real playlists.
app.get('/api/rooms/:roomId/spotify-token', async (req, res) => {
  const room = gameStore.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  if (!room.spotifyDelegate) return res.status(409).json({ error: 'spotify_not_connected' });

  const pool = await getPool();
  if (!pool) return res.status(409).json({ error: 'spotify_not_connected' });

  const token = await getValidAccessToken(pool, room.spotifyDelegate.userId);
  if (!token) {
    // The donor's connection died (revoked, expired refresh token) - clear
    // the now-useless grant instead of leaving a dead delegate sitting on
    // the room indefinitely.
    room.spotifyDelegate = null;
    broadcastRoom(room);
    return res.status(409).json({ error: 'spotify_not_connected' });
  }
  res.json({ accessToken: token.accessToken, expiresIn: Math.floor((token.expiresAt - Date.now()) / 1000), name: room.spotifyDelegate.name });
});

// Public, no Deathstep login required (same room-code trust boundary as
// spotify-token above) - lets the GM browse and queue tracks from whichever
// player has lent their Spotify connection to the room. Those playlists live
// under that player's own Deathstep account (or under no account at all, if
// they only ever linked Spotify locally) and are otherwise completely
// invisible to the GM, who may not even be logged into a Deathstep account -
// the GM's own DB-backed playlist picker (GET /api/playlists) only ever
// shows playlists the GM's own account saved, never a delegate's.
app.get('/api/rooms/:roomId/spotify-playlists', async (req, res) => {
  const room = gameStore.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  if (!room.spotifyDelegate) return res.status(409).json({ error: 'spotify_not_connected' });

  const pool = await getPool();
  if (!pool) return res.status(409).json({ error: 'spotify_not_connected' });

  const token = await getValidAccessToken(pool, room.spotifyDelegate.userId);
  if (!token) return res.status(409).json({ error: 'spotify_not_connected' });

  try {
    const playlists = await fetchPlaylistsWithToken(token.accessToken);
    res.json({ playlists });
  } catch (err) {
    console.error('Room-scoped Spotify playlist fetch failed:', err.message);
    if (err.spotifyRateLimited) return res.status(429).json({ error: 'spotify_rate_limited', retryAfterSeconds: err.retryAfterSeconds });
    res.status(502).json({ error: 'spotify_request_failed' });
  }
});

// Same trust boundary/delegate resolution as spotify-playlists above - the
// tracks of one specific playlist of the room's current delegate, for
// GMDashboard.jsx's "add whole playlist / random / specific track" picker.
app.get('/api/rooms/:roomId/spotify-playlists/:playlistId/tracks', async (req, res) => {
  const room = gameStore.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  if (!room.spotifyDelegate) return res.status(409).json({ error: 'spotify_not_connected' });

  const pool = await getPool();
  if (!pool) return res.status(409).json({ error: 'spotify_not_connected' });

  const token = await getValidAccessToken(pool, room.spotifyDelegate.userId);
  if (!token) return res.status(409).json({ error: 'spotify_not_connected' });

  try {
    const tracks = await fetchPlaylistTracksWithToken(token.accessToken, req.params.playlistId);
    res.json({ tracks });
  } catch (err) {
    console.error('Room-scoped Spotify playlist-tracks fetch failed:', err.message);
    if (err.spotifyRateLimited) return res.status(429).json({ error: 'spotify_rate_limited', retryAfterSeconds: err.retryAfterSeconds });
    res.status(502).json({ error: 'spotify_request_failed' });
  }
});

// Same trust boundary as spotify-playlists above, but reads the delegate's
// own Deathstep-app playlists (server/playlists.js's DB-backed `playlists`
// table) instead of asking Spotify - the one set of playlists spotify-
// playlists can never show, since app-only playlists (never linked to a real
// Spotify playlist, e.g. built purely from pasted track links) don't exist on
// Spotify's side at all. Filtered to app-only rows only: anything already
// linked to Spotify is already visible to the GM via spotify-playlists above,
// so including it here too would just duplicate it under a different id.
app.get('/api/rooms/:roomId/deathstep-playlists', async (req, res) => {
  const room = gameStore.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  if (!room.spotifyDelegate) return res.status(409).json({ error: 'spotify_not_connected' });

  const pool = await getPool();
  if (!pool) return res.status(409).json({ error: 'spotify_not_connected' });

  const [rows] = await pool.query(
    `SELECT p.id, p.name, COUNT(pt.id) as trackCount
     FROM playlists p
     LEFT JOIN playlist_tracks pt ON pt.playlist_id = p.id
     WHERE p.user_id = ? AND p.spotify_playlist_id IS NULL
     GROUP BY p.id
     ORDER BY p.created_at DESC`,
    [room.spotifyDelegate.userId]
  );
  res.json({ playlists: rows.map(r => ({ id: r.id, name: r.name, trackCount: Number(r.trackCount) })) });
});

// Tracks of one of the delegate's app-only playlists (see deathstep-
// playlists above) - same role as spotify-playlists/:playlistId/tracks but
// reading the DB instead of Spotify.
app.get('/api/rooms/:roomId/deathstep-playlists/:playlistId/tracks', async (req, res) => {
  const room = gameStore.getRoom(req.params.roomId);
  if (!room) return res.status(404).json({ error: 'room_not_found' });
  if (!room.spotifyDelegate) return res.status(409).json({ error: 'spotify_not_connected' });

  const pool = await getPool();
  if (!pool) return res.status(409).json({ error: 'spotify_not_connected' });

  const [playlistRows] = await pool.query(
    'SELECT id FROM playlists WHERE id = ? AND user_id = ? AND spotify_playlist_id IS NULL',
    [req.params.playlistId, room.spotifyDelegate.userId]
  );
  if (!playlistRows[0]) return res.status(404).json({ error: 'playlist_not_found' });

  const [tracks] = await pool.query(
    'SELECT id, track_uri, track_name, artist_name FROM playlist_tracks WHERE playlist_id = ? ORDER BY position ASC',
    [req.params.playlistId]
  );
  res.json({ tracks: tracks.map(t => ({ id: t.id, uri: t.track_uri, name: t.track_name, artist: t.artist_name })) });
});

// Serve the built React static files
app.use(express.static(path.join(__dirname, '../client/dist')));

const httpServer = createServer(app);
// No cross-origin deployment of this app actually exists: the client is
// always served from this same Express origin in production, and in dev
// Vite's own proxy (client/vite.config.js) forwards /socket.io so the
// browser never sees a different origin either. `cors: { origin: "*" }`
// used to sit here, which told engine.io to accept a handshake from *any*
// origin - since cookies ride along with a WebSocket upgrade regardless of
// SameSite in some browsers (unlike a same-site-restricted fetch/XHR), that
// would have let a malicious page open an authenticated socket connection
// using a logged-in visitor's own session cookie and act as them through any
// handler that trusts getUserIdFromSocket. Socket.IO v4 already rejects any
// cross-origin handshake by default when no `cors` option is set at all, so
// simply not configuring one is the fix - only set CORS_ORIGIN if a genuine
// separate origin is ever added.
const io = new Server(httpServer, process.env.CORS_ORIGIN ? {
  cors: { origin: process.env.CORS_ORIGIN, methods: ["GET", "POST"] }
} : undefined);

function getGmSocketIds(room) {
  const ids = [];
  if (room.gmId) ids.push(room.gmId);
  (room.coGms || []).forEach(g => { if (g.socketId) ids.push(g.socketId); });
  return [...new Set(ids)];
}

// Whether this exact socket connection is the room's verified main GM or a
// verified co-GM. socket.id (unlike a client-supplied isGM flag or clientId)
// can't be spoofed - it's only ever assigned by reconnectToRoom/createRoom
// after checking the caller's identity, so this is safe to trust everywhere else.
function isRoomGM(room, socket) {
  if (!room) return false;
  if (room.gmId === socket.id) return true;
  return (room.coGms || []).some(g => g.socketId === socket.id);
}

// Resolves "which player is this?" from the actual connection (socket.id -
// assigned by the server itself, never spoofable) instead of a client-
// supplied clientId - every player's own id is visible to everyone else in
// the room (couples/kick-target references need it), so a handler that just
// trusted whatever clientId a caller sent could let anyone act as anyone
// else (cast another couple's vote, submit a fake kill claim/victim report
// on their behalf, confirm their partner-ready state for them, etc.). Used
// by every handler where "the calling player" needs to be identified, same
// reasoning as isRoomGM above and delegateVote's existing isOwnCouple check.
function getCallingPlayer(room, socket) {
  return room?.players.find(p => p.socketId === socket.id) || null;
}

// Best-effort auto-import of the sharer's own "deathstep"-named Spotify
// playlists, right after their share is accepted (see
// resolveSpotifyShareRequest) - never throws, a failure here shouldn't affect
// the share itself.
async function importDeathstepPlaylistsForDelegate(delegate) {
  if (!delegate) return;
  const pool = await getPool();
  if (!pool) return;
  await autoImportDeathstepPlaylists(pool, delegate.userId);
}

// Sends each socket in the room its own view of the state instead of one shared
// broadcast - the GM gets everything, each player gets their own redacted copy
// (see sanitizeRoomForPlayer) so secret data never reaches a socket that shouldn't have it.
function broadcastRoom(room) {
  gameStore.touchRoom(room.id);
  const serverTime = Date.now();

  getGmSocketIds(room).forEach(sid => {
    io.to(sid).emit('roomUpdated', { ...sanitizeRoomForGM(room), serverTime });
  });

  room.players.forEach(p => {
    if (!p.socketId) return;
    io.to(p.socketId).emit('roomUpdated', { ...sanitizeRoomForPlayer(room, p.id), serverTime });
  });
}

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  // The account (if any) behind this connection, verified from the login
  // cookie sent with the handshake - never trust a userId supplied in an
  // event payload instead (see getUserIdFromSocket's own comment), since
  // that's just a client-typed value anyone could set to spoof stats onto
  // another account. Computed once per connection since the handshake
  // cookies don't change for the lifetime of a socket; the client
  // reconnects the socket after login/logout so this stays in sync
  // (see App.jsx's handleAuthenticated/handleLogout).
  const authenticatedUserId = getUserIdFromSocket(socket);

  socket.on('createRoom', ({ clientId } = {}, callback) => {
    const room = gameStore.createRoom(socket.id, authenticatedUserId, clientId || null);
    socket.join(room.id);
    console.log(`Room created: ${room.id} by GM: ${socket.id}`);
    // sessionSecret here is room.gmSessionSecret (see gameStore.createRoom) -
    // the creating client must hold onto it and send it back on every future
    // reconnectToRoom call, same as a player/co-GM does with theirs.
    callback({ success: true, room: sanitizeRoomForGM(room), gmChatHistory: [], sessionSecret: room.gmSessionSecret });
  });

  // User-facing messages are sent as messageKey (+ messageParams); the client
  // translates them via its locale files ('server.<messageKey>').
  socket.on('joinRoom', ({ roomId, playerName, danceRole, isFlexible, clientId, sessionSecret }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!room) {
      return callback({ success: false, messageKey: 'roomNotFound' });
    }

    let updatedRoom;
    const existingById = room.players.find(p => p.id === clientId);
    const existingByName = room.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());

    if (existingById) {
      // Reconnecting with same client ID - every player's own id is visible
      // to everyone else in the room (couples/kick-target references need
      // it), so the id alone can't prove this really is that player's own
      // session. existingById.sessionSecret is null for a player added
      // before this check existed - falls back to id-only for those so an
      // in-progress game isn't forced to kick everyone out the moment this
      // ships, and gets upgraded to a real secret right here once seen again.
      if (existingById.sessionSecret && existingById.sessionSecret !== sessionSecret) {
        return callback({ success: false, messageKey: 'sessionInvalid' });
      }
      if (!existingById.sessionSecret) existingById.sessionSecret = randomUUID();
      updatedRoom = gameStore.updatePlayerSocket(roomId, existingById.id, socket.id);
      // Optionally update name/role if they changed it on the join screen?
      // For now, just reconnect them.
    } else if (existingByName) {
      return callback({ success: false, nameTaken: true, messageKey: 'nameTaken' });
    } else {
      if (room.status !== 'lobby') {
        return callback({ success: false, messageKey: 'gameInProgress' });
      }
      updatedRoom = gameStore.addPlayer(roomId, playerName, danceRole, isFlexible, clientId, socket.id, authenticatedUserId);
    }

    socket.join(roomId);
    broadcastRoom(updatedRoom);
    console.log(`${playerName} joined/reconnected in room ${roomId}`);
    const mySessionSecret = updatedRoom.players.find(p => p.id === clientId)?.sessionSecret;
    callback({ success: true, room: sanitizeRoomForPlayer(updatedRoom, clientId), sessionSecret: mySessionSecret });
  });

  socket.on('addManualPlayer', ({ roomId, playerName, danceRole, isFlexible, replaceExisting }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!room) {
      return callback({ success: false, messageKey: 'roomNotFound' });
    }
    if (!isRoomGM(room, socket)) {
      return callback({ success: false, messageKey: 'notAuthorized' });
    }
    if (room.status !== 'lobby') {
      return callback({ success: false, messageKey: 'lobbyOnly' });
    }
    const existing = room.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (existing) {
      // Name collision: by default just tell the GM so they can offer to
      // replace the existing player or type a different name (see
      // GMDashboard.jsx's handleAddManualPlayer) - only actually remove
      // anyone once the GM has explicitly confirmed that choice.
      if (!replaceExisting) {
        return callback({ success: false, messageKey: 'nameTaken' });
      }
      // Only reachable in the lobby (checked above), so nobody's paired into
      // a couple yet - a plain removePlayer is always correct here, unlike
      // kickPlayer's couple-aware branch used mid-game.
      if (existing.socketId) {
        const existingSocket = io.sockets.sockets.get(existing.socketId);
        existingSocket?.emit('removedFromGame', { messageKey: 'replacedByGm' });
      }
      gameStore.removePlayer(roomId, existing.id);
    }

    const updatedRoom = gameStore.addManualPlayer(roomId, playerName, danceRole, isFlexible);
    broadcastRoom(updatedRoom);
    console.log(`GM manually added phoneless player "${playerName}" to room ${roomId}${existing ? ' (replacing existing player)' : ''}`);
    callback({ success: true, room: sanitizeRoomForGM(updatedRoom) });
  });

  socket.on('reconnectToRoom', ({ roomId, clientId, isGM, sessionSecret }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!room) {
      return callback({ success: false });
    }

    let responseSecret;
    if (!isGM) {
      // If another device already took over this player slot via an approved
      // rejoin, this clientId no longer matches anyone - refuse instead of
      // silently letting the old, replaced session back in. Every player's
      // own id is visible to everyone else in the room too (couples/kick-
      // target references need it) - sessionSecret is the actual proof this
      // is really that player's own session, not just someone who saw the
      // id. Null for a player added before this check existed - falls back
      // to id-only for those so an in-progress game isn't forced to kick
      // everyone out the moment this ships, and gets upgraded to a real
      // secret right here once seen again.
      const player = room.players.find(p => p.id === clientId);
      if (!player) {
        return callback({ success: false, messageKey: 'sessionInvalid' });
      }
      if (player.sessionSecret && player.sessionSecret !== sessionSecret) {
        return callback({ success: false, messageKey: 'sessionInvalid' });
      }
      if (!player.sessionSecret) player.sessionSecret = randomUUID();
      responseSecret = player.sessionSecret;
    } else {
      // Only the verified creator (matched by their persistent device id) or an
      // already-promoted co-GM may reclaim the GM seat - otherwise anyone who
      // knows the room code could claim isGM:true and hijack full room control.
      // A co-GM's id is just as broadcast-visible as a player's, so it needs
      // the same sessionSecret proof. The primary GM's own gmClientId also
      // needs one now: it used to be safe on id-match alone since gmClientId
      // was never broadcast to anyone - but handoverGM can reassign it to a
      // promoted co-GM's own id, which WAS already broadcast to the whole
      // room the entire time they were a co-GM (see sanitizeRoomForGM/
      // ForPlayer). Checking gmSessionSecret (minted fresh in createRoom and
      // rotated in handoverGM, never broadcast either way) closes that gap.
      const isPrimaryGm = !!clientId && room.gmClientId && clientId === room.gmClientId
        && (!room.gmSessionSecret || sessionSecret === room.gmSessionSecret);
      const coGm = room.coGms.find(g => g.id === clientId);
      const isCoGm = !!coGm && (!coGm.sessionSecret || coGm.sessionSecret === sessionSecret);
      if (!isPrimaryGm && !isCoGm) {
        return callback({ success: false, messageKey: 'sessionInvalid' });
      }
      if (isPrimaryGm && !room.gmSessionSecret) room.gmSessionSecret = randomUUID();
      if (isCoGm && coGm && !coGm.sessionSecret) coGm.sessionSecret = randomUUID();
      responseSecret = isPrimaryGm ? room.gmSessionSecret : coGm?.sessionSecret;
    }

    socket.join(roomId);
    if (!isGM) {
      gameStore.updatePlayerSocket(roomId, clientId, socket.id);
    } else {
      const coGm = room.coGms.find(g => g.id === clientId);
      if (coGm) {
        coGm.socketId = socket.id;
      } else {
        room.gmId = socket.id; // Verified primary GM reconnecting with a fresh socket
      }
    }
    const roomForCaller = isGM ? sanitizeRoomForGM(room) : sanitizeRoomForPlayer(room, clientId);
    callback({ success: true, room: roomForCaller, gmChatHistory: isGM ? gameStore.getGMChatHistory(roomId) : undefined, sessionSecret: responseSecret });
  });

  socket.on('leaveRoom', ({ roomId, clientId, isGM }) => {
    if (isGM) {
      const room = gameStore.getRoom(roomId);
      if (!room) return;
      const coGm = room.coGms.find(g => g.id === clientId);
      if (coGm) {
        if (coGm.socketId !== socket.id) return; // not this co-GM's own connection
        const result = gameStore.removeCoGM(roomId, clientId);
        if (result?.room) {
          broadcastRoom(result.room);
          console.log(`Co-GM ${clientId} left room ${roomId}`);
        }
        return;
      }

      if (room.gmId !== socket.id) return; // only the verified main GM may destroy the room
      // GM's tab closing mid-game (rather than clicking "end game") shouldn't
      // lose the hosting record - but it's not a real conclusion either, so
      // only the GM's session counts (aborted:true skips player win/loss
      // records entirely, see stats.js recordGameConclusion). Routed through
      // gameStore.endGame() (rather than recording straight off the live
      // room) so any in-progress round still gets archived into
      // room.roundHistory first, same as a manual "End Game" click.
      if (room.status !== 'lobby' && room.status !== 'ended') {
        gameStore.endGame(roomId);
        recordGameConclusion(room, { aborted: true });
      }
      gameStore.destroyRoom(roomId);
      io.to(roomId).emit('roomDestroyed');
      console.log(`Room ${roomId} destroyed by GM`);
      return;
    }

    const room = gameStore.getRoom(roomId);
    // Resolved from the actual connection, not the client-supplied clientId -
    // every player's own id is visible to everyone else in the room (couples/
    // kick-target references need it), so trusting the payload here would let
    // any player remove any OTHER player from the game just by naming their id.
    const leavingPlayer = getCallingPlayer(room, socket);
    if (!leavingPlayer) return;
    const leavingClientId = leavingPlayer.id;
    const couple = room.couples.find(c => c.playerIds.includes(leavingClientId));

    if (couple) {
      const result = gameStore.removeCoupleMember(roomId, leavingClientId);
      if (result?.room) {
        const messageKey = result.dissolved ? 'partnerLeftSpectating' : 'groupmateLeftContinuing';
        result.remainingIds.forEach(id => {
          const p = result.room.players.find(pl => pl.id === id);
          if (p?.socketId) {
            io.to(p.socketId).emit('partnerLeftNotice', { messageKey, messageParams: { name: leavingPlayer.name || '?' } });
          }
        });
        broadcastRoom(result.room);
        console.log(`Player ${leavingClientId} left room ${roomId} (partner(s) remain${result.dissolved ? ' as spectator' : ''})`);
      }
    } else {
      const updatedRoom = gameStore.removePlayer(roomId, leavingClientId);
      if (updatedRoom) {
        broadcastRoom(updatedRoom);
        console.log(`Player ${leavingClientId} left room ${roomId}`);
      }
    }
  });

  socket.on('requestRejoin', ({ roomId, playerName, clientId, sessionSecret }, callback) => {
    const result = gameStore.requestRejoin(roomId, playerName, clientId, socket.id, sessionSecret);
    if (result.error) {
      return callback({ success: false, messageKey: result.error });
    }

    if (result.autoReconnected) {
      socket.join(roomId);
      broadcastRoom(result.room);
      return callback({ success: true, room: sanitizeRoomForPlayer(result.room, clientId), sessionSecret: result.sessionSecret });
    }

    broadcastRoom(result.room);
    console.log(`Rejoin requested by "${playerName}" in room ${roomId}`);
    callback({ success: false, pending: true, messageKey: 'rejoinPending' });
  });

  socket.on('respondToRejoinRequest', ({ roomId, requestId, accept }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const result = gameStore.respondToRejoinRequest(roomId, requestId, accept);
    if (result.error) return;

    if (result.accepted) {
      const requestingSocket = io.sockets.sockets.get(result.request.requestingSocketId);
      if (requestingSocket) {
        requestingSocket.join(roomId);
        requestingSocket.emit('rejoinApproved', { room: sanitizeRoomForPlayer(result.room, result.newPlayerId), clientId: result.newPlayerId, sessionSecret: result.sessionSecret });
      }
      if (result.oldSocketId && result.oldSocketId !== result.request.requestingSocketId) {
        const oldSocket = io.sockets.sockets.get(result.oldSocketId);
        if (oldSocket) {
          oldSocket.emit('sessionReplaced');
          oldSocket.disconnect(true);
        }
      }
      console.log(`Rejoin approved for "${result.request.playerName}" in room ${roomId}`);
    } else {
      const requestingSocket = io.sockets.sockets.get(result.request.requestingSocketId);
      if (requestingSocket) {
        requestingSocket.emit('rejoinDenied', { messageKey: 'rejoinDenied' });
      }
      console.log(`Rejoin denied for "${result.request.playerName}" in room ${roomId}`);
    }

    broadcastRoom(result.room);
  });

  // Players can suggest a song any time - either a real Spotify track (their
  // own connected Spotify, searched or picked from one of their own imported
  // playlists) or a plain-text title/artist hint if they have no Spotify
  // connected. The GM sees it in a persistent panel and can confirm (adopt as
  // the selected track, when it's a real Spotify track) or dismiss it.
  socket.on('suggestSong', ({ roomId, suggestion }, callback) => {
    const room = gameStore.getRoom(roomId);
    const player = getCallingPlayer(room, socket);
    if (!player) return callback?.({ success: false, messageKey: 'notInRoom' });
    const result = gameStore.addSongSuggestion(roomId, player.id, suggestion);
    if (result.error) {
      return callback?.({ success: false, messageKey: result.error });
    }
    broadcastRoom(result.room);
    callback?.({ success: true });
  });

  // A logged-in player with their own account-linked Spotify connection
  // (made once on the Playlists page) offers to lend it to the room for
  // playback - e.g. the GM has no Spotify of their own. Verified server-side
  // (authenticatedUserId from the login cookie, not anything the client
  // claims) that this really is a live Spotify connection before it's even
  // offered. Refused outright if the GM already has a working connection of
  // their own, or someone else's share is already active/pending - the
  // client is expected to already hide the entry point in those cases, this
  // is the authoritative check. Doesn't take effect until the GM explicitly
  // accepts (see resolveSpotifyShareRequest below) - see gameStore.requestSpotifyShare.
  socket.on('requestSpotifyShareToRoom', async ({ roomId }, callback) => {
    if (!authenticatedUserId) return callback?.({ success: false, messageKey: 'notAuthenticated' });
    const room = gameStore.getRoom(roomId);
    if (!room) return callback?.({ success: false, messageKey: 'roomNotFound' });
    const player = getCallingPlayer(room, socket);
    if (!player) return callback?.({ success: false, messageKey: 'playerNotFound' });
    const clientId = player.id;
    if (room.gmSpotifyConnected) return callback?.({ success: false, messageKey: 'gmAlreadyConnected' });
    if (room.spotifyDelegate && room.spotifyDelegate.playerId !== clientId) return callback?.({ success: false, messageKey: 'shareAlreadyActive' });
    if (room.pendingSpotifyShareRequest && room.pendingSpotifyShareRequest.playerId !== clientId) return callback?.({ success: false, messageKey: 'shareAlreadyActive' });

    const pool = await getPool();
    const token = pool ? await getValidAccessToken(pool, authenticatedUserId) : null;
    if (!token) return callback?.({ success: false, messageKey: 'spotifyNotConnected' });

    const updatedRoom = gameStore.requestSpotifyShare(roomId, clientId, authenticatedUserId, player.name);
    broadcastRoom(updatedRoom);
    callback?.({ success: true });
  });

  // GM-only: accepts or denies the room's pending share offer (see
  // requestSpotifyShareToRoom above) - this is the one place a delegate
  // actually becomes active, so a share can never silently take effect
  // without the GM explicitly choosing to use it.
  socket.on('resolveSpotifyShareRequest', ({ roomId, accept }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!room) return callback?.({ success: false, messageKey: 'roomNotFound' });
    if (!isRoomGM(room, socket)) return callback?.({ success: false, messageKey: 'notAuthorized' });
    if (!room.pendingSpotifyShareRequest) return callback?.({ success: true });

    const updatedRoom = gameStore.resolveSpotifyShareRequest(roomId, !!accept);
    broadcastRoom(updatedRoom);
    if (accept) importDeathstepPlaylistsForDelegate(updatedRoom.spotifyDelegate).catch(() => {});
    callback?.({ success: true });
  });

  // The donor themselves, or the room's GM (e.g. the donor went silent/left
  // without their socket cleanly leaving), may revoke - also withdraws a
  // still-pending offer the same way (e.g. the requester changes their mind).
  socket.on('revokeSpotifyFromRoom', ({ roomId }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!room) return callback?.({ success: true });
    // A GM revokes regardless of clientId (see GMDashboard.jsx's
    // handleRevokeSpotifyDelegate) - only a player revoking their own share
    // needs their identity resolved, from the actual connection rather than
    // a client-supplied id (every player's own id is visible to everyone
    // else in the room, so trusting the payload would let anyone withdraw
    // or revoke someone else's share).
    const isGm = isRoomGM(room, socket);
    const clientId = isGm ? null : getCallingPlayer(room, socket)?.id;
    if (room.pendingSpotifyShareRequest?.playerId === clientId) {
      room.pendingSpotifyShareRequest = null;
      broadcastRoom(room);
      return callback?.({ success: true });
    }
    if (!room.spotifyDelegate) return callback?.({ success: true });
    const isDonor = room.spotifyDelegate.playerId === clientId;
    if (!isDonor && !isGm) return callback?.({ success: false, messageKey: 'notAuthorized' });

    const updatedRoom = gameStore.clearSpotifyDelegate(roomId);
    broadcastRoom(updatedRoom);
    callback?.({ success: true });
  });

  // GM-only: reports whether the GM's own browser currently has a working,
  // non-delegated Spotify connection (see gameStore.setGmSpotifyConnected) -
  // purely informational for players deciding whether offering their own
  // connection would even be usable.
  socket.on('setGmSpotifyConnected', ({ roomId, connected }) => {
    const room = gameStore.getRoom(roomId);
    if (!room || !isRoomGM(room, socket)) return;
    const updatedRoom = gameStore.setGmSpotifyConnected(roomId, connected);
    broadcastRoom(updatedRoom);
  });

  // Takes a callback so a losing GM (two co-GMs racing to handle the same
  // suggestion) gets told it's already gone, instead of silently doing nothing.
  socket.on('confirmSongSuggestion', ({ roomId, suggestionId }, callback) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const result = gameStore.confirmSongSuggestion(roomId, suggestionId);
    if (result.error) return callback?.({ success: false, messageKey: result.error });

    const player = result.room.players.find(p => p.id === result.suggestion.playerId);
    if (player?.socketId) {
      const name = result.suggestion.type === 'text' ? result.suggestion.text : result.suggestion.track.name;
      io.to(player.socketId).emit('songSuggestionHandled', { messageKey: 'suggestionConfirmed', messageParams: { name } });
    }
    broadcastRoom(result.room);
    callback?.({ success: true });
  });

  socket.on('dismissSongSuggestion', ({ roomId, suggestionId }, callback) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const result = gameStore.dismissSongSuggestion(roomId, suggestionId);
    if (result.error) return callback?.({ success: false, messageKey: result.error });

    const player = result.room.players.find(p => p.id === result.suggestion.playerId);
    if (player?.socketId) {
      const name = result.suggestion.type === 'text' ? result.suggestion.text : result.suggestion.track.name;
      io.to(player.socketId).emit('songSuggestionHandled', { messageKey: 'suggestionDismissed', messageParams: { name } });
    }
    broadcastRoom(result.room);
    callback?.({ success: true });
  });

  // Song queue - all GM-only (a co-GM may manage it same as the main GM).
  // Optional ack callback: handleBypassSongReady (GMDashboard.jsx) awaits it
  // before flipping its local "unblocked" flag, so an auto-continue action
  // gated on that flag (see runOnceSongReady) never races the queue update -
  // broadcastRoom above always reaches this same socket before the ack does
  // (both go out over the one connection, in this order), so by the time the
  // callback fires the caller's own room state already has the new entry.
  socket.on('addToSongQueue', ({ roomId, track }, callback) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.addToSongQueue(roomId, track);
    if (room) broadcastRoom(room);
    callback?.({ success: !!room });
  });

  socket.on('addPlaylistToSongQueue', ({ roomId, tracks }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.addPlaylistToSongQueue(roomId, tracks);
    if (room) broadcastRoom(room);
  });

  socket.on('removeFromSongQueue', ({ roomId, entryId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.removeFromSongQueue(roomId, entryId);
    if (room) broadcastRoom(room);
  });

  socket.on('reorderSongQueue', ({ roomId, entryIds }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.reorderSongQueue(roomId, entryIds);
    if (room) broadcastRoom(room);
  });

  socket.on('resolveQueueTextEntry', ({ roomId, entryId, track }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.resolveQueueTextEntry(roomId, entryId, track);
    if (room) broadcastRoom(room);
  });

  socket.on('playQueueEntry', ({ roomId, entryId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.playQueueEntry(roomId, entryId);
    if (room) broadcastRoom(room);
  });

  // GM-only: reports a track actually starting playback (Spotify Web
  // Playback SDK), so the server can keep a per-game record for the
  // post-game "played songs" summary. Own-audio-mode GMs never emit this -
  // the app has no visibility into what plays on an external device/speaker.
  socket.on('trackPlayed', ({ roomId, track }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.addPlayedSong(roomId, track);
    if (room) broadcastRoom(room);
  });

  socket.on('kickPlayer', ({ roomId, clientId }) => {
    const room = gameStore.getRoom(roomId);
    if (!isRoomGM(room, socket)) return;
    const couple = room?.couples.find(c => c.playerIds.includes(clientId));

    if (couple) {
      const result = gameStore.removeCouple(roomId, couple.id);
      if (result?.room) {
        result.removedPlayers.forEach(p => {
          if (!p.socketId) return;
          const sock = io.sockets.sockets.get(p.socketId);
          if (!sock) return;
          const messageKey = p.id === clientId ? 'kickedByGm' : 'partnerKicked';
          sock.emit('removedFromGame', { messageKey });
        });
        broadcastRoom(result.room);
        console.log(`Player ${clientId} kicked from room ${roomId} by GM (couple removed)`);
      }
    } else {
      const updatedRoom = gameStore.removePlayer(roomId, clientId);
      if (updatedRoom) {
        broadcastRoom(updatedRoom);
        console.log(`Player ${clientId} kicked from room ${roomId} by GM`);
      }
    }
  });

  socket.on('kickCouple', ({ roomId, coupleId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const result = gameStore.removeCouple(roomId, coupleId);
    if (result?.room) {
      result.removedPlayers.forEach(p => {
        if (!p.socketId) return;
        const sock = io.sockets.sockets.get(p.socketId);
        if (sock) {
          sock.emit('removedFromGame', { messageKey: 'coupleKicked' });
        }
      });
      broadcastRoom(result.room);
      console.log(`Couple ${coupleId} kicked from room ${roomId} by GM`);
    }
  });

  // Main-GM-only (not just any co-GM) - promoting/demoting the team is the
  // main GM's call, same reasoning as handoverGM below.
  socket.on('promoteToGM', ({ roomId, playerId }) => {
    const room = gameStore.getRoom(roomId);
    if (!room || room.gmId !== socket.id) return;
    const result = gameStore.promoteToGM(roomId, playerId);
    if (!result) return;

    const gmSocket = io.sockets.sockets.get(result.newGM.socketId);
    if (gmSocket) {
      gmSocket.join(roomId);
      gmSocket.emit('promotedToGM', { room: sanitizeRoomForGM(result.room), gmChatHistory: gameStore.getGMChatHistory(roomId), sessionSecret: result.newGM.sessionSecret });
    }

    result.removedPartners.forEach(p => {
      if (!p.socketId) return;
      const sock = io.sockets.sockets.get(p.socketId);
      if (sock) {
        sock.emit('removedFromGame', { messageKey: 'partnerPromoted', messageParams: { name: result.newGM.name } });
      }
    });

    broadcastRoom(result.room);
    console.log(`Player "${result.newGM.name}" promoted to co-GM in room ${roomId}`);
  });

  // Revokes a co-GM's GM rights - either the main GM acting on any co-GM, or
  // a co-GM stepping down themselves (never another co-GM acting on someone
  // else's behalf). Demotes back to a regular player (see
  // gameStore.demoteCoGMToPlayer) rather than removing them from the room
  // entirely - "become a player again" is the point, not "get kicked out".
  socket.on('removeCoGM', ({ roomId, gmId }) => {
    const room = gameStore.getRoom(roomId);
    if (!room) return;
    const targetCoGm = room.coGms.find(g => g.id === gmId);
    if (!targetCoGm) return;
    const isMainGm = room.gmId === socket.id;
    const isSelf = targetCoGm.socketId === socket.id;
    if (!isMainGm && !isSelf) return;

    const result = gameStore.demoteCoGMToPlayer(roomId, gmId);
    if (!result?.room) return;

    if (result.demotedPlayer?.socketId) {
      const sock = io.sockets.sockets.get(result.demotedPlayer.socketId);
      if (sock) {
        sock.emit('demotedToPlayer', { room: sanitizeRoomForPlayer(result.room, result.demotedPlayer.id), sessionSecret: result.demotedPlayer.sessionSecret });
      }
    }

    broadcastRoom(result.room);
    console.log(`Co-GM "${targetCoGm.name}" demoted to player in room ${roomId}`);
  });

  // Main-GM-only: steps down in favor of an existing co-GM, who becomes the
  // new main GM (see gameStore.handoverGM) - the outgoing main GM becomes a
  // co-GM themselves instead of losing GM status, so the round keeps running
  // uninterrupted under new primary control.
  socket.on('handoverGM', ({ roomId, targetCoGmId, outgoingName }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!room) return callback?.({ success: false, messageKey: 'roomNotFound' });
    if (room.gmId !== socket.id) return callback?.({ success: false, messageKey: 'notAuthorized' });

    const name = String(outgoingName || '').trim().slice(0, 100) || 'GM';
    const result = gameStore.handoverGM(roomId, targetCoGmId, name);
    if (!result) return callback?.({ success: false, messageKey: 'coGmNotFound' });

    const newGmSocket = io.sockets.sockets.get(result.newMainGm.socketId);
    if (newGmSocket) {
      // sessionSecret is the freshly rotated room.gmSessionSecret (see
      // gameStore.handoverGM) - delivered only to this one socket, same
      // reasoning as oldMainGm's below: it must never go through
      // broadcastRoom/sanitizeRoomForGM, which is exactly what a bare
      // clientId-match reconnect used to rely on being safe from.
      newGmSocket.emit('becameMainGM', { room: sanitizeRoomForGM(result.room), sessionSecret: result.newMainGmSessionSecret });
    }

    broadcastRoom(result.room);
    // The outgoing main GM (this caller) becomes a co-GM with a fresh
    // sessionSecret (see gameStore.handoverGM) - sanitizeRoomForGM strips it
    // from the broadcast above like every other co-GM's, so the only way
    // back to this specific socket is the ack callback here.
    callback?.({ success: true, sessionSecret: result.oldMainGm.sessionSecret });
    console.log(`GM handover in room ${roomId}: "${name}" -> "${result.newMainGm.name}"`);
  });

  socket.on('sendGMChatMessage', ({ roomId, senderName, text }) => {
    const room = gameStore.getRoom(roomId);
    if (!room) return;
    if (!isRoomGM(room, socket)) return;
    const trimmed = (text || '').trim();
    if (!trimmed) return;

    const message = gameStore.addGMChatMessage(roomId, senderName || 'GM', trimmed.slice(0, 500));
    if (!message) return;

    getGmSocketIds(room).forEach(sid => {
      io.to(sid).emit('gmChatMessage', message);
    });
  });

  // New events for GM to manage roles and pairs
  socket.on('updatePlayerRole', ({ roomId, clientId, newRole }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.updatePlayerRole(roomId, clientId, newRole);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('setVotingRole', ({ roomId, role }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.setVotingRole(roomId, role);
    if (room) {
      broadcastRoom(room);
    }
  });

  // GM-only: marks a player's phone as dead/unusable mid-game (or undoes
  // that) - see gameStore.setPlayerPhoneStatus for how this reuses the
  // existing no-phone fallback machinery.
  socket.on('setPlayerPhoneStatus', ({ roomId, playerId, hasNoPhone }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.setPlayerPhoneStatus(roomId, playerId, hasNoPhone);
    if (room) broadcastRoom(room);
  });

  // GM-only: broadcasts the lobby's "own audio"/"Spotify" choice onto the
  // room so players can tell whether Spotify-track suggestions are usable.
  socket.on('setUseSpotify', ({ roomId, useSpotify }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.setUseSpotify(roomId, useSpotify);
    if (room) broadcastRoom(room);
  });

  // Lets the GM's own "pending couples" preview (before they've committed
  // anything via releasePairs) already reflect the site owner's hidden
  // pairing override, instead of only the final release - see
  // gameStore.applyPairOverrides, which this calls directly without touching
  // room.pairOverrides/room.couples (a preview commits nothing). Answered via
  // callback (this GM's own request) rather than a room-wide broadcast.
  socket.on('previewPairing', ({ roomId, generatedCouples }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!isRoomGM(room, socket)) return callback?.({ success: false });
    const couples = gameStore.applyPairOverrides(room, generatedCouples.map(c => ({ ...c, playerIds: [...c.playerIds] })));
    callback?.({ success: true, couples });
  });

  socket.on('releasePairs', ({ roomId, generatedCouples }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.releasePairs(roomId, generatedCouples);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('confirmPartner', ({ roomId }) => {
    const player = getCallingPlayer(gameStore.getRoom(roomId), socket);
    if (!player) return;
    const room = gameStore.confirmPartner(roomId, player.id);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('gmConfirmCouple', ({ roomId, coupleId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.gmConfirmCouple(roomId, coupleId);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('gmMarkCoupleRoleViewed', ({ roomId, coupleId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.gmMarkCoupleRoleViewed(roomId, coupleId);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('startGame', ({ roomId, killerCount, killMode, deadPlayersKeepDancing, specialRoles, martyrWinsOnVote }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.startGame(roomId, { killerCount, killMode, deadPlayersKeepDancing, specialRoles, martyrWinsOnVote });
    if (room) {
      broadcastRoom(room);
      
      // Emit roles to individuals
      room.players.forEach(player => {
        if (player.socketId) {
          const couple = room.couples.find(c => c.playerIds.includes(player.id));
          if (couple) {
            io.to(player.socketId).emit('roleAssigned', { role: couple.role });
          }
        }
      });
      
      console.log(`Game started in room ${roomId}`);
    }
  });

  socket.on('roleViewed', ({ roomId }) => {
    const player = getCallingPlayer(gameStore.getRoom(roomId), socket);
    if (!player) return;
    const room = gameStore.markRoleViewed(roomId, player.id);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('startDancing', ({ roomId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.startDancing(roomId);
    if (room) {
      broadcastRoom(room);
      console.log(`Dancing started in room ${roomId}`);
    }
  });

  socket.on('proceedToSilentReport', ({ roomId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.proceedToSilentReport(roomId);
    if (room) {
      broadcastRoom(room);
      console.log(`Silent report phase started in room ${roomId}`);
    }
  });

  socket.on('reportKill', ({ roomId, victimId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.reportKill(roomId, victimId);
    if (room) {
      broadcastRoom(room);
      console.log(`Kill reported in room ${roomId}`);
    }
  });

  socket.on('submitKillClaim', ({ roomId, victimId }) => {
    const player = getCallingPlayer(gameStore.getRoom(roomId), socket);
    if (!player) return;
    const room = gameStore.submitKillClaim(roomId, player.id, victimId);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('submitVictimReport', ({ roomId, feltKilled, suspectId }) => {
    const player = getCallingPlayer(gameStore.getRoom(roomId), socket);
    if (!player) return;
    const room = gameStore.submitVictimReport(roomId, player.id, feltKilled, suspectId);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('seerPeek', ({ roomId, targetCoupleId }) => {
    const player = getCallingPlayer(gameStore.getRoom(roomId), socket);
    if (!player) return;
    const room = gameStore.seerPeek(roomId, player.id, targetCoupleId);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('submitProtectorPick', ({ roomId, targetCoupleId }) => {
    const player = getCallingPlayer(gameStore.getRoom(roomId), socket);
    if (!player) return;
    const room = gameStore.submitProtectorPick(roomId, player.id, targetCoupleId);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('gmSubmitKillClaim', ({ roomId, killerCoupleId, victimId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.gmSubmitKillClaim(roomId, killerCoupleId, victimId);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('gmSubmitVictimReport', ({ roomId, coupleId, feltKilled, suspectId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.gmSubmitVictimReport(roomId, coupleId, feltKilled, suspectId);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('resolveSilentReports', ({ roomId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.resolveSilentReports(roomId);
    if (room) {
      broadcastRoom(room);
      console.log(`Silent reports resolved in room ${roomId}`);
    }
  });

  socket.on('revealKill', ({ roomId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const wasAlreadyEnded = gameStore.getRoom(roomId)?.status === 'ended';
    const room = gameStore.revealKill(roomId);
    if (room) {
      broadcastRoom(room);
      console.log(`Kill revealed in room ${roomId}`);
      if (!wasAlreadyEnded && room.status === 'ended') {
        recordGameConclusion(room, { aborted: room.endReason === 'aborted' });
      }
    }
  });

  socket.on('proceedToVoting', ({ roomId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.proceedToVoting(roomId);
    if (room) {
      broadcastRoom(room);
      console.log(`Proceeding to voting in room ${roomId}`);
    }
  });

  // GM can delegate any couple's vote; a couple's own member may only delegate
  // their own couple's vote (e.g. handing it to their partner).
  socket.on('delegateVote', ({ roomId, coupleId, votingPlayerId }) => {
    const room = gameStore.getRoom(roomId);
    if (!room) return;
    const couple = room.couples.find(c => c.id === coupleId);
    const isOwnCouple = couple?.playerIds.some(id => {
      const p = room.players.find(pl => pl.id === id);
      return p && p.socketId === socket.id;
    });
    if (!isRoomGM(room, socket) && !isOwnCouple) return;
    const updatedRoom = gameStore.delegateVote(roomId, coupleId, votingPlayerId);
    if (updatedRoom) {
      broadcastRoom(updatedRoom);
    }
  });

  socket.on('castVote', ({ roomId, suspectId }) => {
    const player = getCallingPlayer(gameStore.getRoom(roomId), socket);
    if (!player) return;
    const room = gameStore.castVote(roomId, player.id, suspectId);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('gmCastVote', ({ roomId, coupleId, suspectId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.gmCastVote(roomId, coupleId, suspectId);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('executeVote', ({ roomId, suspectId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const wasAlreadyEnded = gameStore.getRoom(roomId)?.status === 'ended';
    const room = gameStore.executeVote(roomId, suspectId);
    if (room) {
      broadcastRoom(room);
      console.log(`Vote executed in room ${roomId}. Resulting status: ${room.status}`);
      if (!wasAlreadyEnded && room.status === 'ended') {
        recordGameConclusion(room, { aborted: room.endReason === 'aborted' });
      }
    }
  });

  // Advances out of the vote-reveal phase (see gameStore.executeVote's
  // 'voting' branch) into the next round - the GM's explicit "continue"
  // action from GMDashboard.jsx's VOTE REVEAL phase block, gated the same
  // way every other round-advance is (song-ready lock + bypass).
  socket.on('proceedFromVoteReveal', ({ roomId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.proceedFromVoteReveal(roomId);
    if (room) broadcastRoom(room);
  });

  socket.on('endGame', ({ roomId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const wasAlreadyEnded = gameStore.getRoom(roomId)?.status === 'ended';
    const room = gameStore.endGame(roomId);
    if (room) {
      broadcastRoom(room);
      console.log(`Game ended by GM in room ${roomId}`);
      if (!wasAlreadyEnded && room.status === 'ended') {
        recordGameConclusion(room, { aborted: room.endReason === 'aborted' });
      }
    }
  });

  socket.on('resetGame', ({ roomId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.resetRoom(roomId);
    if (room) {
      broadcastRoom(room);
      console.log(`Game reset to lobby in room ${roomId}`);
    }
  });

  socket.on('resetRoles', ({ roomId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.resetRoles(roomId);
    if (room) {
      broadcastRoom(room);
      console.log(`Roles reset in room ${roomId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

// Public - every GM's dashboard needs this to compute a live killer-count
// suggestion (see GMDashboard.jsx), not just developer accounts, so it lives
// outside the /api/admin gate. The divisor itself is only ever changed
// through the gated /api/admin/dev-settings route (see server/admin.js).
app.get('/api/dev-settings/killer-ratio', async (req, res) => {
  const pool = await getPool();
  if (!pool) return res.json({ divisor: 8 });
  const [rows] = await pool.query('SELECT killer_ratio_divisor FROM dev_settings WHERE id = 1');
  res.json({ divisor: rows[0]?.killer_ratio_divisor ?? 8 });
});

// Public, no login needed - a GM bypassing the "song ready" lock with no
// track selected at all (see GMDashboard.jsx's handleBypassSongReady) gets a
// random pick from this dev-curated list instead of proceeding with no music
// at all. The list itself is only ever edited through the gated
// /api/admin/fallback-songs routes (see server/admin.js). ORDER BY RAND() is
// fine at this table's expected size (a small, hand-curated list, not
// thousands of rows).
app.get('/api/fallback-songs/random', async (req, res) => {
  const pool = await getPool();
  if (!pool) return res.json({ track: null });
  const [rows] = await pool.query('SELECT track_uri, track_name, artist_name FROM fallback_songs ORDER BY RAND() LIMIT 1');
  const row = rows[0];
  res.json({ track: row ? { uri: row.track_uri, name: row.track_name, artist: row.artist_name } : null });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

// A GM's tab closing without emitting leaveRoom (crash, force-quit, lost
// connection) never destroys the room - sweep periodically for anything
// that's had zero activity in ROOM_MAX_AGE_MS, so the in-memory Map doesn't
// grow unbounded over a long server uptime.
const ROOM_CLEANUP_INTERVAL_MS = 30 * 60 * 1000;
const ROOM_MAX_AGE_MS = 8 * 60 * 60 * 1000;
setInterval(() => gameStore.cleanupAbandonedRooms(ROOM_MAX_AGE_MS), ROOM_CLEANUP_INTERVAL_MS);

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Deathstep server running on port ${PORT}`);
});
