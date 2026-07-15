import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import gameStore from './gameStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

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

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', (callback) => {
    const room = gameStore.createRoom(socket.id);
    socket.join(room.id);
    console.log(`Room created: ${room.id} by GM: ${socket.id}`);
    callback({ success: true, room, gmChatHistory: [] });
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
      updatedRoom = gameStore.addPlayer(roomId, playerName, danceRole, isFlexible, clientId, socket.id);
    }

    socket.join(roomId);
    io.to(roomId).emit('roomUpdated', { ...updatedRoom, serverTime: Date.now() });
    console.log(`${playerName} joined/reconnected in room ${roomId}`);
    callback({ success: true, room: updatedRoom });
  });

  socket.on('addManualPlayer', ({ roomId, playerName, danceRole, isFlexible }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!room) {
      return callback({ success: false, messageKey: 'roomNotFound' });
    }
    if (room.status !== 'lobby') {
      return callback({ success: false, messageKey: 'lobbyOnly' });
    }
    if (room.players.some(p => p.name.toLowerCase() === playerName.toLowerCase())) {
      return callback({ success: false, messageKey: 'nameTaken' });
    }

    const updatedRoom = gameStore.addManualPlayer(roomId, playerName, danceRole, isFlexible);
    io.to(roomId).emit('roomUpdated', { ...updatedRoom, serverTime: Date.now() });
    console.log(`GM manually added phoneless player "${playerName}" to room ${roomId}`);
    callback({ success: true, room: updatedRoom });
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
    }

    socket.join(roomId);
    if (!isGM) {
      gameStore.updatePlayerSocket(roomId, clientId, socket.id);
    } else {
      const coGm = room.coGms.find(g => g.id === clientId);
      if (coGm) {
        coGm.socketId = socket.id;
      } else {
        room.gmId = socket.id; // Update main GM socket just in case
      }
    }
    callback({ success: true, room, gmChatHistory: isGM ? gameStore.getGMChatHistory(roomId) : undefined });
  });

  socket.on('leaveRoom', ({ roomId, clientId, isGM }) => {
    if (isGM) {
      const room = gameStore.getRoom(roomId);
      const isCoGm = room?.coGms.some(g => g.id === clientId);
      if (isCoGm) {
        const result = gameStore.removeCoGM(roomId, clientId);
        if (result?.room) {
          io.to(roomId).emit('roomUpdated', { ...result.room, serverTime: Date.now() });
          console.log(`Co-GM ${clientId} left room ${roomId}`);
        }
        return;
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
        io.to(roomId).emit('roomUpdated', { ...result.room, serverTime: Date.now() });
        console.log(`Player ${clientId} left room ${roomId} (couple removed)`);
      }
    } else {
      const updatedRoom = gameStore.removePlayer(roomId, clientId);
      if (updatedRoom) {
        io.to(roomId).emit('roomUpdated', { ...updatedRoom, serverTime: Date.now() });
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
      io.to(roomId).emit('roomUpdated', { ...result.room, serverTime: Date.now() });
      return callback({ success: true, room: result.room });
    }

    io.to(roomId).emit('roomUpdated', { ...result.room, serverTime: Date.now() });
    console.log(`Rejoin requested by "${playerName}" in room ${roomId}`);
    callback({ success: false, pending: true, messageKey: 'rejoinPending' });
  });

  socket.on('respondToRejoinRequest', ({ roomId, requestId, accept }) => {
    const result = gameStore.respondToRejoinRequest(roomId, requestId, accept);
    if (result.error) return;

    if (result.accepted) {
      const requestingSocket = io.sockets.sockets.get(result.request.requestingSocketId);
      if (requestingSocket) {
        requestingSocket.join(roomId);
        requestingSocket.emit('rejoinApproved', { room: result.room, clientId: result.newPlayerId });
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

    io.to(roomId).emit('roomUpdated', { ...result.room, serverTime: Date.now() });
  });

  socket.on('kickPlayer', ({ roomId, clientId }) => {
    const room = gameStore.getRoom(roomId);
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
        io.to(roomId).emit('roomUpdated', { ...result.room, serverTime: Date.now() });
        console.log(`Player ${clientId} kicked from room ${roomId} by GM (couple removed)`);
      }
    } else {
      const updatedRoom = gameStore.removePlayer(roomId, clientId);
      if (updatedRoom) {
        io.to(roomId).emit('roomUpdated', { ...updatedRoom, serverTime: Date.now() });
        console.log(`Player ${clientId} kicked from room ${roomId} by GM`);
      }
    }
  });

  socket.on('kickCouple', ({ roomId, coupleId }) => {
    const result = gameStore.removeCouple(roomId, coupleId);
    if (result?.room) {
      result.removedPlayers.forEach(p => {
        if (!p.socketId) return;
        const sock = io.sockets.sockets.get(p.socketId);
        if (sock) {
          sock.emit('removedFromGame', { messageKey: 'coupleKicked' });
        }
      });
      io.to(roomId).emit('roomUpdated', { ...result.room, serverTime: Date.now() });
      console.log(`Couple ${coupleId} kicked from room ${roomId} by GM`);
    }
  });

  socket.on('promoteToGM', ({ roomId, playerId }) => {
    const result = gameStore.promoteToGM(roomId, playerId);
    if (!result) return;

    const gmSocket = io.sockets.sockets.get(result.newGM.socketId);
    if (gmSocket) {
      gmSocket.join(roomId);
      gmSocket.emit('promotedToGM', { room: result.room, gmChatHistory: gameStore.getGMChatHistory(roomId) });
    }

    result.removedPartners.forEach(p => {
      if (!p.socketId) return;
      const sock = io.sockets.sockets.get(p.socketId);
      if (sock) {
        sock.emit('removedFromGame', { messageKey: 'partnerPromoted', messageParams: { name: result.newGM.name } });
      }
    });

    io.to(roomId).emit('roomUpdated', { ...result.room, serverTime: Date.now() });
    console.log(`Player "${result.newGM.name}" promoted to co-GM in room ${roomId}`);
  });

  socket.on('removeCoGM', ({ roomId, gmId }) => {
    const result = gameStore.removeCoGM(roomId, gmId);
    if (!result?.room) return;

    if (result.removedGM?.socketId) {
      const sock = io.sockets.sockets.get(result.removedGM.socketId);
      if (sock) {
        sock.emit('removedFromGame', { messageKey: 'gmRightsRevoked' });
      }
    }

    io.to(roomId).emit('roomUpdated', { ...result.room, serverTime: Date.now() });
    console.log(`Co-GM ${gmId} removed from room ${roomId}`);
  });

  socket.on('sendGMChatMessage', ({ roomId, senderName, text }) => {
    const room = gameStore.getRoom(roomId);
    if (!room) return;
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
    const room = gameStore.updatePlayerRole(roomId, clientId, newRole);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('setVotingRole', ({ roomId, role }) => {
    const room = gameStore.setVotingRole(roomId, role);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('releasePairs', ({ roomId, generatedCouples }) => {
    const room = gameStore.releasePairs(roomId, generatedCouples);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('confirmPartner', ({ roomId, clientId }) => {
    const room = gameStore.confirmPartner(roomId, clientId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('gmConfirmCouple', ({ roomId, coupleId }) => {
    const room = gameStore.gmConfirmCouple(roomId, coupleId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('gmMarkCoupleRoleViewed', ({ roomId, coupleId }) => {
    const room = gameStore.gmMarkCoupleRoleViewed(roomId, coupleId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('startGame', ({ roomId, killerCount, killMode }) => {
    const room = gameStore.startGame(roomId, killerCount, killMode);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      
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
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('startDancing', ({ roomId }) => {
    const room = gameStore.startDancing(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      console.log(`Dancing started in room ${roomId}`);
    }
  });

  socket.on('proceedToSilentReport', ({ roomId }) => {
    const room = gameStore.proceedToSilentReport(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      console.log(`Silent report phase started in room ${roomId}`);
    }
  });

  socket.on('reportKill', ({ roomId, victimId }) => {
    const room = gameStore.reportKill(roomId, victimId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      console.log(`Kill reported in room ${roomId}`);
    }
  });

  socket.on('submitKillClaim', ({ roomId, clientId, victimId }) => {
    const room = gameStore.submitKillClaim(roomId, clientId, victimId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('submitVictimReport', ({ roomId, clientId, feltKilled, suspectId }) => {
    const room = gameStore.submitVictimReport(roomId, clientId, feltKilled, suspectId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('gmSubmitKillClaim', ({ roomId, killerCoupleId, victimId }) => {
    const room = gameStore.gmSubmitKillClaim(roomId, killerCoupleId, victimId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('gmSubmitVictimReport', ({ roomId, coupleId, feltKilled, suspectId }) => {
    const room = gameStore.gmSubmitVictimReport(roomId, coupleId, feltKilled, suspectId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('resolveSilentReports', ({ roomId }) => {
    const room = gameStore.resolveSilentReports(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      console.log(`Silent reports resolved in room ${roomId}`);
    }
  });

  socket.on('revealKill', ({ roomId }) => {
    const room = gameStore.revealKill(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      console.log(`Kill revealed in room ${roomId}`);
    }
  });

  socket.on('startDiscussion', ({ roomId }) => {
    const room = gameStore.startDiscussion(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      console.log(`Discussion started in room ${roomId}`);
    }
  });

  socket.on('proceedToVoting', ({ roomId }) => {
    const room = gameStore.proceedToVoting(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      console.log(`Proceeding to voting in room ${roomId}`);
    }
  });

  socket.on('delegateVote', ({ roomId, coupleId, votingPlayerId }) => {
    const room = gameStore.delegateVote(roomId, coupleId, votingPlayerId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('castVote', ({ roomId, voterId, suspectId }) => {
    const room = gameStore.castVote(roomId, voterId, suspectId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('gmCastVote', ({ roomId, coupleId, suspectId }) => {
    const room = gameStore.gmCastVote(roomId, coupleId, suspectId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
    }
  });

  socket.on('executeVote', ({ roomId, suspectId }) => {
    const room = gameStore.executeVote(roomId, suspectId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      console.log(`Vote executed in room ${roomId}. Resulting status: ${room.status}`);
    }
  });

  socket.on('endGame', ({ roomId }) => {
    const room = gameStore.endGame(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      console.log(`Game ended by GM in room ${roomId}`);
    }
  });

  socket.on('resetGame', ({ roomId }) => {
    const room = gameStore.resetRoom(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      console.log(`Game reset to lobby in room ${roomId}`);
    }
  });

  socket.on('resetRoles', ({ roomId }) => {
    const room = gameStore.resetRoles(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', { ...room, serverTime: Date.now() });
      console.log(`Roles reset in room ${roomId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.post('/api/feedback', (req, res) => {
  const { name, message, timestamp } = req.body;
  const feedbackData = `\n[${timestamp}] ${name || 'Anonymous'}: ${message}`;
  
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

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Deathstep server running on port ${PORT}`);
});
