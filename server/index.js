import './loadEnv.js';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import gameStore, { sanitizeRoomForGM, sanitizeRoomForPlayer } from './gameStore.js';
import { getUserIdFromSocket } from './authToken.js';
import authRouter from './auth.js';
import statsRouter, { recordGameConclusion } from './stats.js';
import spotifyRouter from './spotify.js';
import playlistsRouter from './playlists.js';

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

// Serve the built React static files
app.use(express.static(path.join(__dirname, '../client/dist')));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

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
    callback({ success: true, room: sanitizeRoomForGM(room), gmChatHistory: [] });
  });

  // User-facing messages are sent as messageKey (+ messageParams); the client
  // translates them via its locale files ('server.<messageKey>').
  socket.on('joinRoom', ({ roomId, playerName, danceRole, isFlexible, clientId }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!room) {
      return callback({ success: false, messageKey: 'roomNotFound' });
    }

    let updatedRoom;
    const existingById = room.players.find(p => p.id === clientId);
    const existingByName = room.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
    
    if (existingById) {
      // Reconnecting with same client ID
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
    callback({ success: true, room: sanitizeRoomForPlayer(updatedRoom, clientId) });
  });

  socket.on('addManualPlayer', ({ roomId, playerName, danceRole, isFlexible }, callback) => {
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
    if (room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
      return callback({ success: false, messageKey: 'nameTaken' });
    }

    const updatedRoom = gameStore.addManualPlayer(roomId, playerName, danceRole, isFlexible);
    broadcastRoom(updatedRoom);
    console.log(`GM manually added phoneless player "${playerName}" to room ${roomId}`);
    callback({ success: true, room: sanitizeRoomForGM(updatedRoom) });
  });

  socket.on('reconnectToRoom', ({ roomId, clientId, isGM }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!room) {
      return callback({ success: false });
    }

    if (!isGM) {
      // If another device already took over this player slot via an approved
      // rejoin, this clientId no longer matches anyone - refuse instead of
      // silently letting the old, replaced session back in.
      const player = room.players.find(p => p.id === clientId);
      if (!player) {
        return callback({ success: false, messageKey: 'sessionInvalid' });
      }
    } else {
      // Only the verified creator (matched by their persistent device id) or an
      // already-promoted co-GM may reclaim the GM seat - otherwise anyone who
      // knows the room code could claim isGM:true and hijack full room control.
      const isPrimaryGm = !!clientId && room.gmClientId && clientId === room.gmClientId;
      const isCoGm = room.coGms.some(g => g.id === clientId);
      if (!isPrimaryGm && !isCoGm) {
        return callback({ success: false, messageKey: 'sessionInvalid' });
      }
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
    callback({ success: true, room: roomForCaller, gmChatHistory: isGM ? gameStore.getGMChatHistory(roomId) : undefined });
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
      // records entirely, see stats.js recordGameConclusion).
      if (room.status !== 'lobby' && room.status !== 'ended') {
        recordGameConclusion(room, { aborted: true });
      }
      gameStore.destroyRoom(roomId);
      io.to(roomId).emit('roomDestroyed');
      console.log(`Room ${roomId} destroyed by GM`);
      return;
    }

    const room = gameStore.getRoom(roomId);
    const couple = room?.couples.find(c => c.playerIds.includes(clientId));

    if (couple) {
      const leavingPlayer = room.players.find(p => p.id === clientId);
      const result = gameStore.removeCouple(roomId, couple.id);
      if (result?.room) {
        result.removedPlayers.forEach(p => {
          if (p.id === clientId || !p.socketId) return; // they left on purpose, they already know
          const sock = io.sockets.sockets.get(p.socketId);
          if (sock) {
            sock.emit('removedFromGame', { messageKey: 'partnerLeft', messageParams: { name: leavingPlayer?.name || '?' } });
          }
        });
        broadcastRoom(result.room);
        console.log(`Player ${clientId} left room ${roomId} (couple removed)`);
      }
    } else {
      const updatedRoom = gameStore.removePlayer(roomId, clientId);
      if (updatedRoom) {
        broadcastRoom(updatedRoom);
        console.log(`Player ${clientId} left room ${roomId}`);
      }
    }
  });

  socket.on('requestRejoin', ({ roomId, playerName, clientId }, callback) => {
    const result = gameStore.requestRejoin(roomId, playerName, clientId, socket.id);
    if (result.error) {
      return callback({ success: false, messageKey: result.error });
    }

    if (result.autoReconnected) {
      socket.join(roomId);
      broadcastRoom(result.room);
      return callback({ success: true, room: sanitizeRoomForPlayer(result.room, clientId) });
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
        requestingSocket.emit('rejoinApproved', { room: sanitizeRoomForPlayer(result.room, result.newPlayerId), clientId: result.newPlayerId });
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
  socket.on('suggestSong', ({ roomId, clientId, suggestion }, callback) => {
    const result = gameStore.addSongSuggestion(roomId, clientId, suggestion);
    if (result.error) {
      return callback?.({ success: false, messageKey: result.error });
    }
    broadcastRoom(result.room);
    callback?.({ success: true });
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

  socket.on('promoteToGM', ({ roomId, playerId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const result = gameStore.promoteToGM(roomId, playerId);
    if (!result) return;

    const gmSocket = io.sockets.sockets.get(result.newGM.socketId);
    if (gmSocket) {
      gmSocket.join(roomId);
      gmSocket.emit('promotedToGM', { room: sanitizeRoomForGM(result.room), gmChatHistory: gameStore.getGMChatHistory(roomId) });
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

  socket.on('removeCoGM', ({ roomId, gmId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const result = gameStore.removeCoGM(roomId, gmId);
    if (!result?.room) return;

    if (result.removedGM?.socketId) {
      const sock = io.sockets.sockets.get(result.removedGM.socketId);
      if (sock) {
        sock.emit('removedFromGame', { messageKey: 'gmRightsRevoked' });
      }
    }

    broadcastRoom(result.room);
    console.log(`Co-GM ${gmId} removed from room ${roomId}`);
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

  socket.on('releasePairs', ({ roomId, generatedCouples }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.releasePairs(roomId, generatedCouples);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('confirmPartner', ({ roomId, clientId }) => {
    const room = gameStore.confirmPartner(roomId, clientId);
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

  socket.on('startGame', ({ roomId, killerCount, killMode }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.startGame(roomId, killerCount, killMode);
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

  socket.on('roleViewed', ({ roomId, clientId }) => {
    const room = gameStore.markRoleViewed(roomId, clientId);
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

  socket.on('submitKillClaim', ({ roomId, clientId, victimId }) => {
    const room = gameStore.submitKillClaim(roomId, clientId, victimId);
    if (room) {
      broadcastRoom(room);
    }
  });

  socket.on('submitVictimReport', ({ roomId, clientId, feltKilled, suspectId }) => {
    const room = gameStore.submitVictimReport(roomId, clientId, feltKilled, suspectId);
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

  socket.on('startDiscussion', ({ roomId }) => {
    if (!isRoomGM(gameStore.getRoom(roomId), socket)) return;
    const room = gameStore.startDiscussion(roomId);
    if (room) {
      broadcastRoom(room);
      console.log(`Discussion started in room ${roomId}`);
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

  socket.on('castVote', ({ roomId, voterId, suspectId }) => {
    const room = gameStore.castVote(roomId, voterId, suspectId);
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

app.post('/api/feedback', (req, res) => {
  // name/message are client-controlled free text with no auth behind this
  // endpoint - cap their length so one request can't balloon the log file,
  // and use the server's own clock rather than trusting a client-supplied
  // timestamp (which could be set to anything).
  const name = String(req.body?.name || '').trim().slice(0, 100);
  const message = String(req.body?.message || '').trim().slice(0, 2000);
  if (!message) return res.status(400).json({ success: false });

  const feedbackData = `\n[${new Date().toISOString()}] ${name || 'Anonymous'}: ${message}`;

  const dataDir = path.join(__dirname, 'data');
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir);
  }
  
  fs.appendFile(path.join(dataDir, 'feedback.txt'), feedbackData, (err) => {
    if (err) {
      console.error('Error saving feedback:', err);
      return res.status(500).json({ success: false });
    }
    res.json({ success: true });
  });
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
