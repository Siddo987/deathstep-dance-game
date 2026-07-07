class GameStore {
  constructor() {
    this.rooms = new Map();
  }

  generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  createRoom(socketId) {
    let code;
    do {
      code = this.generateRoomCode();
    } while (this.rooms.has(code));

    const newRoom = {
      id: code,
      gmId: socketId,
      status: 'lobby', // lobby, paired, dancing, voting, ended
      round: 0,
      players: [], // { id, socketId, name, danceRole: 'lead'|'follow'|'spectator', isConfirmed: false }
      couples: [], // { id, name, playerIds: [], role: 'dancer'|'killer', status: 'alive' }
      votingRole: 'follow', // lead or follow
      votes: {}, // { voterId: suspectCoupleId }
      victimId: null, // this will be a couple id
      pendingVictimId: null, // secretly marked before reveal
    };
    
    this.rooms.set(code, newRoom);
    return newRoom;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  addPlayer(roomId, playerName, danceRole, clientId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'lobby') return null; // Can't join mid-game right now

    const newPlayer = {
      id: clientId,
      socketId: socketId,
      name: playerName,
      danceRole: danceRole, // 'lead', 'follow', or 'spectator'
      originalDanceRole: danceRole, // To reset after clearing pairs
      isConfirmed: false,
      hasViewedRole: false
    };
    
    room.players.push(newPlayer);
    return room;
  }

  updatePlayerSocket(roomId, clientId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = room.players.find(p => p.id === clientId);
    if (player) {
      player.socketId = socketId;
    }
    return room;
  }

  removePlayer(roomId, clientId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.players = room.players.filter(p => p.id !== clientId);
    // If they were in a couple, we might need to handle that, but for now we'll just let the GM reset if someone leaves mid-game.
    return room;
  }

  updatePlayerRole(roomId, clientId, newRole) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = room.players.find(p => p.id === clientId);
    if (player) {
      player.danceRole = newRole;
    }
    return room;
  }

  setVotingRole(roomId, role) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.votingRole = role;
    return room;
  }

  releasePairs(roomId, generatedCouples) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    room.couples = generatedCouples.map((c, index) => ({
      id: `couple_${index}`,
      name: c.name,
      playerIds: c.playerIds,
      role: 'dancer',
      status: 'alive'
    }));

    room.players.forEach(p => {
      p.isConfirmed = false;
      p.hasViewedRole = false;
    });
    room.status = 'paired';
    return room;
  }

  confirmPartner(roomId, clientId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = room.players.find(p => p.id === clientId);
    if (player) {
      player.isConfirmed = true;
    }
    return room;
  }

  destroyRoom(roomId) {
    this.rooms.delete(roomId);
  }

  startGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    room.couples.forEach(c => {
      c.status = 'alive';
      c.role = 'dancer';
    });
    room.votes = {};
    room.victimId = null;

    // Filter out spectator-only couples if any exist, but normally couples don't contain spectators.
    const activeCouples = room.couples;

    if (activeCouples.length > 0) {
      const killerIndex = Math.floor(Math.random() * activeCouples.length);
      activeCouples[killerIndex].role = 'killer';
    }

    room.players.forEach(p => p.hasViewedRole = false);
    room.status = 'role_reveal';
    room.round = 1;
    return room;
  }

  markRoleViewed(roomId, clientId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = room.players.find(p => p.id === clientId);
    if (player) {
      player.hasViewedRole = true;
    }
    return room;
  }

  startDancing(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (room.status === 'kill_reveal' || room.status === 'voting') {
      room.round += 1;
    }
    room.status = 'dancing';
    room.pendingVictimId = null;
    room.victimId = null;
    room.votes = {};
    return room;
  }

  checkEndCondition(room) {
    const aliveCouples = room.couples.filter(c => c.status === 'alive');
    const killersAlive = aliveCouples.some(c => c.role === 'killer');
    
    if (!killersAlive) {
      room.status = 'ended';
      return true;
    }
    
    if (aliveCouples.length <= 2) {
      room.status = 'ended';
      return true;
    }
    return false;
  }

  reportKill(roomId, victimCoupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.pendingVictimId = victimCoupleId;
    return room;
  }

  revealKill(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.victimId = room.pendingVictimId;

    if (room.victimId) {
      const couple = room.couples.find(c => c.id === room.victimId);
      if (couple) couple.status = 'eliminated';
    }

    if (!this.checkEndCondition(room)) {
      room.status = 'kill_reveal';
    }
    return room;
  }

  startDiscussion(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.status = 'discussion';
    return room;
  }

  proceedToVoting(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.status = 'voting';
    room.votes = {};
    return room;
  }

  delegateVote(roomId, coupleId, votingPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const couple = room.couples.find(c => c.id === coupleId);
    if (couple) {
      couple.votingPlayerId = votingPlayerId;
    }
    return room;
  }

  castVote(roomId, voterClientId, suspectCoupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'voting') return null;

    // Map voterClientId to their couple ID
    const voterCouple = room.couples.find(c => c.playerIds.includes(voterClientId));
    if (voterCouple) {
       // Store vote by couple ID so it's 1 vote per couple
       room.votes[voterCouple.id] = suspectCoupleId;
    }
    return room;
  }

  executeVote(roomId, suspectCoupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (suspectCoupleId) {
      const couple = room.couples.find(c => c.id === suspectCoupleId);
      if (couple) couple.status = 'eliminated';
    }

    if (!this.checkEndCondition(room)) {
      room.status = 'dancing';
      room.round += 1;
      room.victimId = null;
      room.pendingVictimId = null;
      room.votes = {};
    }

    return room;
  }

  endGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    const killers = room.couples.filter(c => c.role === 'killer');
    killers.forEach(k => k.status = 'eliminated');
    
    room.status = 'ended';
    return room;
  }

  resetRoles(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    room.players.forEach(p => {
      if (p.originalDanceRole) {
        p.danceRole = p.originalDanceRole;
      }
    });
    return room;
  }

  resetRoom(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    room.status = 'lobby';
    room.round = 0;
    room.votes = {};
    room.victimId = null;
    room.pendingVictimId = null;
    room.couples = []; // Reset couples completely for a new pairing
    room.players.forEach(p => {
      p.isConfirmed = false;
      if (p.originalDanceRole) {
        p.danceRole = p.originalDanceRole;
      }
    });

    return room;
  }
}

export default new GameStore();
