import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import gameStore from './gameStore.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());

// Serve the built React static files
app.use(express.static(path.join(__dirname, '../client/dist')));

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);

  socket.on('createRoom', (callback) => {
    const room = gameStore.createRoom(socket.id);
    socket.join(room.id);
    console.log(`Room created: ${room.id} by GM: ${socket.id}`);
    callback({ success: true, room });
  });

  socket.on('joinRoom', ({ roomId, playerName, danceRole, clientId }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!room) {
      return callback({ success: false, message: 'Room not found.' });
    }

    let updatedRoom;
    const existing = room.players.find(p => p.id === clientId || p.name === playerName);
    
    if (existing) {
      updatedRoom = gameStore.updatePlayerSocket(roomId, existing.id, socket.id);
    } else {
      if (room.status !== 'lobby') {
        return callback({ success: false, message: 'Game already in progress.' });
      }
      updatedRoom = gameStore.addPlayer(roomId, playerName, danceRole, clientId, socket.id);
    }

    socket.join(roomId);
    io.to(roomId).emit('roomUpdated', updatedRoom);
    console.log(`${playerName} joined/reconnected in room ${roomId}`);
    callback({ success: true, room: updatedRoom });
  });

  socket.on('reconnectToRoom', ({ roomId, clientId, isGM }, callback) => {
    const room = gameStore.getRoom(roomId);
    if (!room) {
      return callback({ success: false });
    }
    socket.join(roomId);
    if (!isGM) {
      gameStore.updatePlayerSocket(roomId, clientId, socket.id);
    } else {
      room.gmId = socket.id; // Update GM socket just in case
    }
    callback({ success: true, room });
  });

  socket.on('leaveRoom', ({ roomId, clientId, isGM }) => {
    if (isGM) {
      gameStore.destroyRoom(roomId);
      io.to(roomId).emit('roomDestroyed');
      console.log(`Room ${roomId} destroyed by GM`);
    } else {
      const room = gameStore.removePlayer(roomId, clientId);
      if (room) {
        io.to(roomId).emit('roomUpdated', room);
        console.log(`Player ${clientId} left room ${roomId}`);
      }
    }
  });

  socket.on('kickPlayer', ({ roomId, clientId }) => {
    const room = gameStore.removePlayer(roomId, clientId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
      console.log(`Player ${clientId} kicked from room ${roomId} by GM`);
    }
  });

  // New events for GM to manage roles and pairs
  socket.on('updatePlayerRole', ({ roomId, clientId, newRole }) => {
    const room = gameStore.updatePlayerRole(roomId, clientId, newRole);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
    }
  });

  socket.on('setVotingRole', ({ roomId, role }) => {
    const room = gameStore.setVotingRole(roomId, role);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
    }
  });

  socket.on('releasePairs', ({ roomId, generatedCouples }) => {
    const room = gameStore.releasePairs(roomId, generatedCouples);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
    }
  });

  socket.on('confirmPartner', ({ roomId, clientId }) => {
    const room = gameStore.confirmPartner(roomId, clientId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
    }
  });

  socket.on('startGame', ({ roomId }) => {
    const room = gameStore.startGame(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
      
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
      io.to(roomId).emit('roomUpdated', room);
    }
  });

  socket.on('startDancing', ({ roomId }) => {
    const room = gameStore.startDancing(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
      console.log(`Dancing started in room ${roomId}`);
    }
  });

  socket.on('reportKill', ({ roomId, victimId }) => {
    const room = gameStore.reportKill(roomId, victimId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
      console.log(`Kill reported in room ${roomId}`);
    }
  });

  socket.on('revealKill', ({ roomId }) => {
    const room = gameStore.revealKill(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
      console.log(`Kill revealed in room ${roomId}`);
    }
  });

  socket.on('startDiscussion', ({ roomId }) => {
    const room = gameStore.startDiscussion(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
      console.log(`Discussion started in room ${roomId}`);
    }
  });

  socket.on('proceedToVoting', ({ roomId }) => {
    const room = gameStore.proceedToVoting(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
      console.log(`Proceeding to voting in room ${roomId}`);
    }
  });

  socket.on('castVote', ({ roomId, voterId, suspectId }) => {
    const room = gameStore.castVote(roomId, voterId, suspectId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
    }
  });

  socket.on('executeVote', ({ roomId, suspectId }) => {
    const room = gameStore.executeVote(roomId, suspectId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
      console.log(`Vote executed in room ${roomId}. Resulting status: ${room.status}`);
    }
  });

  socket.on('endGame', ({ roomId }) => {
    const room = gameStore.endGame(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
      console.log(`Game ended by GM in room ${roomId}`);
    }
  });

  socket.on('resetGame', ({ roomId }) => {
    const room = gameStore.resetRoom(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
      console.log(`Game reset to lobby in room ${roomId}`);
    }
  });

  socket.on('resetRoles', ({ roomId }) => {
    const room = gameStore.resetRoles(roomId);
    if (room) {
      io.to(roomId).emit('roomUpdated', room);
      console.log(`Roles reset in room ${roomId}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
  });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3001;
httpServer.listen(PORT, () => {
  console.log(`Deathstep server running on port ${PORT}`);
});
