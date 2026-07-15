class GameStore {
  constructor() {
    this.rooms = new Map();
    this.gmChats = new Map(); // roomId -> [{ id, senderName, text, timestamp }] - kept separate from `rooms` so it never leaks into the player-facing roomUpdated broadcast.
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
      victimIds: [], // couple ids eliminated this round (one kill per killer couple)
      pendingVictimIds: [], // secretly marked before reveal
      pendingRejoinRequests: [], // { id, playerName, targetPlayerId, requestingClientId, requestingSocketId }
      coGms: [], // { id, socketId, name } - additional GMs promoted from the player pool
    };
    
    this.rooms.set(code, newRoom);
    return newRoom;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  addPlayer(roomId, playerName, danceRole, isFlexible, clientId, socketId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'lobby') return null; // Can't join mid-game right now

    const newPlayer = {
      id: clientId,
      socketId: socketId,
      name: playerName,
      danceRole: danceRole, // 'lead', 'follow', or 'spectator'
      originalDanceRole: danceRole, // To reset after clearing pairs
      isFlexible: !!isFlexible,
      isConfirmed: false,
      hasViewedRole: false,
      hasNoPhone: false
    };

    room.players.push(newPlayer);
    return room;
  }

  // For players who don't have their own phone - the GM adds them manually
  // and the pairing logic guarantees they always get a partner with a device.
  addManualPlayer(roomId, playerName, danceRole, isFlexible) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'lobby') return null;

    const newPlayer = {
      id: `manual_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      socketId: null,
      name: playerName,
      danceRole: danceRole,
      originalDanceRole: danceRole,
      isFlexible: !!isFlexible,
      isConfirmed: false,
      hasViewedRole: false,
      hasNoPhone: true
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
    room.pendingRejoinRequests = room.pendingRejoinRequests.filter(r => r.targetPlayerId !== clientId);
    return room;
  }

  // Removes an entire couple (all members) - used both when the GM deletes a
  // couple directly, and when one partner leaves/gets kicked and the rest of
  // the couple can no longer continue on their own.
  removeCouple(roomId, coupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const couple = room.couples.find(c => c.id === coupleId);
    if (!couple) return null;

    const memberIds = [...couple.playerIds];
    const removedPlayers = room.players.filter(p => memberIds.includes(p.id));

    room.players = room.players.filter(p => !memberIds.includes(p.id));
    room.couples = room.couples.filter(c => c.id !== coupleId);
    room.pendingRejoinRequests = room.pendingRejoinRequests.filter(r => !memberIds.includes(r.targetPlayerId));

    if (room.status !== 'lobby' && room.status !== 'paired') {
      this.checkEndCondition(room);
    }

    return { room, removedPlayers };
  }

  // Promotes an existing player to co-GM. If they were part of a couple, the
  // whole couple is removed first (a GM can't also be a dancer), which cascades
  // to their former partner exactly like a kick would.
  promoteToGM(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'lobby') return null; // Only while pairing hasn't started yet
    const player = room.players.find(p => p.id === playerId);
    if (!player) return null;
    if (player.hasNoPhone) return null; // Can't hand GM control to someone without a device

    const playerSnapshot = { id: player.id, socketId: player.socketId, name: player.name };

    const couple = room.couples.find(c => c.playerIds.includes(playerId));
    let removedPartners = [];
    if (couple) {
      const result = this.removeCouple(roomId, couple.id);
      removedPartners = (result?.removedPlayers || []).filter(p => p.id !== playerId);
    } else {
      room.players = room.players.filter(p => p.id !== playerId);
    }

    room.coGms.push(playerSnapshot);
    return { room, newGM: playerSnapshot, removedPartners };
  }

  removeCoGM(roomId, gmId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const removedGM = room.coGms.find(g => g.id === gmId) || null;
    room.coGms = room.coGms.filter(g => g.id !== gmId);
    return { room, removedGM };
  }

  addGMChatMessage(roomId, senderName, text) {
    if (!this.rooms.has(roomId)) return null;
    if (!this.gmChats.has(roomId)) this.gmChats.set(roomId, []);
    const messages = this.gmChats.get(roomId);
    const message = {
      id: `msg_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      senderName,
      text,
      timestamp: Date.now(),
    };
    messages.push(message);
    if (messages.length > 200) messages.shift();
    return message;
  }

  getGMChatHistory(roomId) {
    return this.gmChats.get(roomId) || [];
  }

  requestRejoin(roomId, playerName, requestingClientId, requestingSocketId) {
    const room = this.rooms.get(roomId);
    // Error values are locale keys resolved by the client ('server.<key>').
    if (!room) return { error: 'roomNotFound' };

    const targetPlayer = room.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (!targetPlayer) return { error: 'rejoinPlayerNotFound' };

    if (targetPlayer.id === requestingClientId) {
      // Same device/session reconnecting - no GM approval needed.
      targetPlayer.socketId = requestingSocketId;
      return { room, autoReconnected: true };
    }

    // Replace any older pending request targeting the same player.
    room.pendingRejoinRequests = room.pendingRejoinRequests.filter(r => r.targetPlayerId !== targetPlayer.id);

    const request = {
      id: `rejoin_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      playerName: targetPlayer.name,
      targetPlayerId: targetPlayer.id,
      requestingClientId,
      requestingSocketId,
    };
    room.pendingRejoinRequests.push(request);
    return { room, request };
  }

  respondToRejoinRequest(roomId, requestId, accept) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'Room not found.' };

    const idx = room.pendingRejoinRequests.findIndex(r => r.id === requestId);
    if (idx === -1) return { error: 'Request not found.' };
    const [request] = room.pendingRejoinRequests.splice(idx, 1);

    if (!accept) {
      return { room, request, accepted: false };
    }

    const targetPlayer = room.players.find(p => p.id === request.targetPlayerId);
    if (!targetPlayer) return { error: 'Player no longer in room.' };

    const oldSocketId = targetPlayer.socketId;
    const oldPlayerId = targetPlayer.id;
    const newPlayerId = request.requestingClientId;

    // Hand the player identity over to the new device entirely (not just the socket).
    // This re-keys every reference to the old device's clientId so it can never
    // silently reclaim this seat again - it would need a fresh, GM-approved rejoin.
    targetPlayer.id = newPlayerId;
    targetPlayer.socketId = request.requestingSocketId;

    room.couples.forEach(c => {
      c.playerIds = c.playerIds.map(id => id === oldPlayerId ? newPlayerId : id);
      if (c.votingPlayerId === oldPlayerId) c.votingPlayerId = newPlayerId;
    });

    return { room, request, accepted: true, oldSocketId, newPlayerId };
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

    room.couples = generatedCouples.map((c, index) => {
      const members = c.playerIds.map(id => room.players.find(p => p.id === id)).filter(Boolean);

      // Default who votes for this couple: prefer someone with the assigned
      // voting role, but if that role has no phone in this couple, fall back
      // to whoever else in the couple does have one. If several people are
      // equally eligible (e.g. a 3-person group with two of the voting role),
      // pick randomly between them - they can still switch later.
      const votingRoleMembers = members.filter(p => p.danceRole === room.votingRole);
      let candidates = votingRoleMembers.filter(p => !p.hasNoPhone);
      if (candidates.length === 0) {
        candidates = members.filter(p => !p.hasNoPhone);
      }
      const votingPlayerId = candidates.length > 0
        ? candidates[Math.floor(Math.random() * candidates.length)].id
        : null;

      return {
        id: `couple_${index}`,
        name: c.name,
        playerIds: c.playerIds,
        role: 'dancer',
        status: 'alive',
        votingPlayerId,
      };
    });

    room.players.forEach(p => {
      const couple = room.couples.find(c => c.playerIds.includes(p.id));
      // A phoneless player can't tap "confirm" themselves - normally their
      // partner has a phone and speaks for the couple, so don't block the GM
      // on them. But if the whole couple has no phone, nobody can ever confirm
      // via the app - leave them unconfirmed so the GM has to manually mark
      // that couple ready (they can't be silently auto-confirmed with no one
      // having actually acknowledged anything).
      const coupleFullyPhoneless = !!couple && couple.playerIds.every(id => {
        const member = room.players.find(pl => pl.id === id);
        return member && member.hasNoPhone;
      });
      p.isConfirmed = !!p.hasNoPhone && !coupleFullyPhoneless;
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

  // GM override for couples where neither partner has a phone - they can
  // never tap "confirm" or "hold to view role" themselves.
  gmConfirmCouple(roomId, coupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const couple = room.couples.find(c => c.id === coupleId);
    if (!couple) return null;
    couple.playerIds.forEach(id => {
      const player = room.players.find(p => p.id === id);
      if (player) player.isConfirmed = true;
    });
    return room;
  }

  gmMarkCoupleRoleViewed(roomId, coupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const couple = room.couples.find(c => c.id === coupleId);
    if (!couple) return null;
    couple.playerIds.forEach(id => {
      const player = room.players.find(p => p.id === id);
      if (player) player.hasViewedRole = true;
    });
    return room;
  }

  destroyRoom(roomId) {
    this.rooms.delete(roomId);
    this.gmChats.delete(roomId);
  }

  startGame(roomId, killerCount = 1) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    
    room.couples.forEach(c => {
      c.status = 'alive';
      c.role = 'dancer';
    });
    room.votes = {};
    room.victimIds = [];
    room.pendingVictimIds = [];

    // Filter out spectator-only couples if any exist, but normally couples don't contain spectators.
    const activeCouples = room.couples;

    if (activeCouples.length > 0) {
      // Always leave at least one dancer couple, even if the client-side cap is bypassed.
      const maxKillers = Math.max(1, activeCouples.length - 1);
      const killersToAssign = Math.min(killerCount, maxKillers);
      const shuffledIndices = Array.from({length: activeCouples.length}, (_, i) => i).sort(() => 0.5 - Math.random());
      for (let i = 0; i < killersToAssign; i++) {
         activeCouples[shuffledIndices[i]].role = 'killer';
      }
    }

    room.players.forEach(p => p.hasViewedRole = false);
    room.status = 'role_reveal';
    room.round = 1;
    room.endReason = null;
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
    room.pendingVictimIds = [];
    room.victimIds = [];
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
    
    const aliveKillers = aliveCouples.filter(c => c.role === 'killer').length;
    const aliveDancers = aliveCouples.length - aliveKillers;
    if (aliveKillers >= aliveDancers) {
      room.status = 'ended';
      return true;
    }
    return false;
  }

  reportKill(roomId, victimCoupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    if (victimCoupleId === null) {
      // Explicit "nobody killed" - clear all pending marks for this round.
      room.pendingVictimIds = [];
    } else {
      const idx = room.pendingVictimIds.indexOf(victimCoupleId);
      if (idx === -1) {
        // At most one kill per surviving killer couple, per round.
        const aliveKillerCount = room.couples.filter(c => c.role === 'killer' && c.status === 'alive').length;
        if (room.pendingVictimIds.length < aliveKillerCount) {
          room.pendingVictimIds.push(victimCoupleId);
        }
      } else {
        room.pendingVictimIds.splice(idx, 1);
      }
    }
    return room;
  }

  revealKill(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    room.victimIds = [...room.pendingVictimIds];

    room.victimIds.forEach(victimId => {
      const couple = room.couples.find(c => c.id === victimId);
      if (couple) couple.status = 'eliminated';
    });

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
    room.votingEndTime = Date.now() + 45000; // 45 seconds timer
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

  // GM casts a vote directly on behalf of a couple with no phone in the game.
  gmCastVote(roomId, voterCoupleId, suspectCoupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'voting') return null;

    const voterCouple = room.couples.find(c => c.id === voterCoupleId);
    if (voterCouple) {
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
      room.victimIds = [];
      room.pendingVictimIds = [];
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
    room.endReason = 'aborted';
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
    room.victimIds = [];
    room.pendingVictimIds = [];
    room.endReason = null;
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
