import { randomUUID } from 'crypto';

// The GM needs the full, unredacted room (all roles, all silent-mode claims/reports,
// all votes) to run the game. Nothing in there is secret from the GM, so this only
// strips server-internal routing fields (socketId) that the client never uses.
// pairOverrides/killerOverridePlayerIds are the site owner's hidden, in-
// progress manipulation for this room's next round (see server/admin.js) -
// stripped here so even the room's own GM never receives them over the
// socket. The admin's own REST view (server/admin.js's GET /rooms/:roomId)
// reads them straight off the room object instead of through this function.
export function sanitizeRoomForGM(room) {
  // gmId (live socket.id) and gmClientId (persistent device id) are used
  // only for server-side reconnect verification (see index.js's
  // reconnectToRoom) - the client never reads either. gmClientId in
  // particular must never reach any socket: reconnectToRoom trusts a
  // client-supplied clientId that matches it to hand over full GM control,
  // so broadcasting the real value would let anyone who saw it hijack the
  // room. Stripped here (not just from the player view) since the GM's own
  // client doesn't need it either. gmSessionSecret is the actual bearer
  // credential checked alongside gmClientId in reconnectToRoom - stripped
  // for the same reason: gmClientId itself IS broadcast to co-GMs (see its
  // own comment further down), so leaking this too would hand every co-GM
  // everything needed to impersonate the primary GM.
  const { pairOverrides, killerOverridePlayerIds, gmId, gmClientId, gmUserId, gmSessionSecret, ...rest } = room;
  return {
    ...rest,
    players: room.players.map(({ socketId, sessionSecret, ...r }) => r),
    coGms: room.coGms.map(({ socketId, sessionSecret, ...r }) => r),
  };
}

// Players must never receive another couple's role, or silent-mode claims/reports/votes
// that aren't their own - those are the actual secrets the game is built around, and
// hiding them only in the UI would let anyone read them straight out of devtools.
// This is the one place that decides what a given player is allowed to know, so every
// socket emit that reaches a player must go through it instead of sending the raw room.
export function sanitizeRoomForPlayer(room, viewerClientId) {
  const myCouple = room.couples.find(c => c.playerIds.includes(viewerClientId));
  const viewerIsKiller = myCouple?.role === 'killer';
  const revealAllRoles = room.status === 'ended'; // no secret left to protect once the round is over

  const couples = room.couples.map(c => {
    const showRole = revealAllRoles
      || (myCouple && c.id === myCouple.id) // you already know your own role
      || (viewerIsKiller && c.role === 'killer'); // killers are told their teammates
    // Unlike the killer role, a special role (Seher/Beschützer/... - see
    // SPECIAL_ROLE_KEYS) is never shared with teammates - it's personal
    // info, not team info, so killers don't get to see each other's (they
    // never have one anyway) and dancer-team couples don't see each other's.
    const showSpecialRole = revealAllRoles || (myCouple && c.id === myCouple.id);
    return { ...c, role: showRole ? c.role : null, specialRole: showSpecialRole ? c.specialRole : null };
  });

  const pickOwn = (record) => {
    if (!myCouple || !Object.prototype.hasOwnProperty.call(record, myCouple.id)) return {};
    return { [myCouple.id]: record[myCouple.id] };
  };

  // gmId/gmClientId/gmUserId: see sanitizeRoomForGM's comment - gmClientId
  // especially must never reach a player socket, since reconnectToRoom
  // trusts a client-supplied clientId matching it to grant full GM control.
  // pendingRejoinRequests is a GM-only moderation queue (approve/deny another
  // player's rejoin) - never read by PlayerScreen.jsx, and would otherwise
  // hand every player in the room a live feed of who else is trying to
  // reconnect and their internal ids.
  const { pairOverrides, killerOverridePlayerIds, gmId, gmClientId, gmUserId, gmSessionSecret, pendingRejoinRequests, ...rest } = room;
  return {
    ...rest,
    players: room.players.map(({ socketId, sessionSecret, ...r }) => r),
    coGms: room.coGms.map(({ socketId, sessionSecret, ...r }) => r),
    couples,
    killClaims: pickOwn(room.killClaims),
    victimReports: pickOwn(room.victimReports),
    votes: pickOwn(room.votes),
    seerPeeks: pickOwn(room.seerPeeks), // a Seer's peek result is personal, not shared with teammates - same treatment as their specialRole itself
    pendingVictimIds: [], // GM's in-progress kill marking is not public until revealKill
  };
}

// Same winner predicate as GameStore's own checkEndCondition() below, but
// reusable after the room has already flipped to 'ended' (checkEndCondition
// itself mutates room.status as a side effect, so it can't just be called
// again). Shared by server/stats.js (win/loss participation records) and
// server/achievements.js (the 'first_win' achievement) so both agree on
// what "killers won" means.
// The full set of special-role keys a dancer-team couple can hold, layered
// on top of (never instead of) their team role - see couple.specialRole.
// Kept as one flat list (rather than scattered string literals) so the GM
// settings panel, DB migration, and any future validation can all iterate
// the same source of truth instead of drifting out of sync.
export const SPECIAL_ROLE_KEYS = ['seer', 'protector', 'toucher', 'martyr', 'puzzle'];

export function didKillersWin(room) {
  const aliveCouples = room.couples.filter(c => c.status === 'alive');
  const killersAlive = aliveCouples.some(c => c.role === 'killer');
  if (!killersAlive) return false;
  const aliveKillers = aliveCouples.filter(c => c.role === 'killer').length;
  const aliveDancers = aliveCouples.length - aliveKillers;
  return aliveKillers >= aliveDancers;
}

class GameStore {
  constructor() {
    this.rooms = new Map();
    this.gmChats = new Map(); // roomId -> [{ id, senderName, text, timestamp }] - kept separate from `rooms` so it never leaks into the player-facing roomUpdated broadcast.
    this.roomLastActivity = new Map(); // roomId -> timestamp, for cleanupAbandonedRooms - kept separate so this bookkeeping never leaks into the client broadcast either
  }

  generateRoomCode() {
    return Math.floor(1000 + Math.random() * 9000).toString();
  }

  // Called from index.js's broadcastRoom() - the one place virtually every
  // state-changing socket handler already passes through - so this doesn't
  // need touching from dozens of individual action methods.
  touchRoom(roomId) {
    this.roomLastActivity.set(roomId, Date.now());
  }

  // A GM's tab closing without emitting leaveRoom (crash, force-quit, lost
  // connection) never destroys the room - nothing else in the app ever
  // revisits it, so it would otherwise sit in memory forever. Call
  // periodically (see index.js) to reclaim anything untouched for maxAgeMs.
  cleanupAbandonedRooms(maxAgeMs) {
    const now = Date.now();
    for (const roomId of this.rooms.keys()) {
      const lastActivity = this.roomLastActivity.get(roomId) ?? now; // never touched yet - treat as fresh, not abandoned
      if (now - lastActivity > maxAgeMs) {
        this.destroyRoom(roomId);
      }
    }
  }

  createRoom(socketId, userId = null, gmClientId = null) {
    let code;
    do {
      code = this.generateRoomCode();
    } while (this.rooms.has(code));

    const newRoom = {
      id: code,
      gmId: socketId,
      gmClientId, // persistent device id of the room's creator - lets reconnectToRoom verify a claimed GM reconnect actually belongs to them
      // Real bearer credential for the primary-GM reconnect check, checked
      // alongside gmClientId - unlike gmClientId (which handoverGM openly
      // reassigns to a promoted co-GM's already-public id), this is always a
      // freshly minted, never-broadcast value, so knowing a co-GM's id alone
      // is never enough to reconnect as the primary GM after a handover. See
      // reconnectToRoom (server/index.js) and handoverGM below.
      gmSessionSecret: randomUUID(),
      gmUserId: userId, // logged-in account of the main GM, for gm_sessions stats - null if anonymous
      status: 'lobby', // lobby, paired, role_reveal, dancing, silent_report (silent kill mode only), kill_reveal, voting, vote_reveal, ended
      round: 0,
      players: [], // { id, socketId, name, danceRole: 'lead'|'follow'|'spectator', isConfirmed: false }
      couples: [], // { id, name, playerIds: [], role: 'dancer'|'killer', status: 'alive' }
      votingRole: 'random', // 'lead', 'follow', or 'random' (default) - see assignVotingPlayers
      votes: {}, // { voterId: suspectCoupleId }
      voteResult: null, // { votedOutCoupleId: string|null } | null - set by executeVote on entering 'vote_reveal', cleared by proceedFromVoteReveal
      victimIds: [], // couple ids eliminated this round (one kill per killer couple)
      pendingVictimIds: [], // secretly marked before reveal
      pendingRejoinRequests: [], // { id, playerName, targetPlayerId, requestingClientId, requestingSocketId }
      coGms: [], // { id, socketId, name, userId } - additional GMs promoted from the player pool
      killMode: 'classic', // 'classic' (GM marks kills manually) or 'silent' (phone-based report/match) - a room-level preference, like votingRole
      killClaims: {}, // silent mode: { killerCoupleId: victimCoupleId | null }
      victimReports: {}, // silent mode: { coupleId: { feltKilled: boolean, suspectCoupleId: string | null } }
      silentReportsResolved: false, // silent mode: whether this round's reports have been matched into pendingVictimIds yet
      songSuggestions: [], // { id, playerId, playerName, track, createdAt } - track is a raw Spotify track object, players can suggest any time
      playedSongs: [], // { uri, name, artist, playedAt, round } - reported by the GM's client whenever it actually starts a track; own-audio mode never reports anything since the app has no visibility into what plays on an external device/speaker
      songQueue: [], // { id, type: 'spotify'|'text', uri, name, artist, text } - ordered, GM-managed upcoming picks (see addToSongQueue etc.). Persists across rounds AND across games in this room - only destroyRoom() clears it, resetRoom() deliberately leaves it alone.
      nowPlaying: null, // { uri, name, artist } | null - the current pick, set by playQueueEntry. Broadcast as room state (not client-local) so a GM reload never loses it.
      startedAt: null, // set on startGame() - for the persisted games.started_at, see recordGameConclusion in server/stats.js
      roundHistory: [], // one entry per concluded round (see pushRoundRecord below) - the only place round-by-round detail survives past the live in-memory room, until recordGameConclusion persists it
      useSpotify: null, // null (not chosen yet) | true | false - mirrors the GM's lobby "Own Audio System"/"Use Spotify" choice (GMDashboard.jsx's local useSpotify state) so players can tell whether Spotify-track suggestions are actually usable this game (see setUseSpotify).
      spotifyDelegate: null, // { userId, playerId, name } | null - a player's account-linked Spotify connection, temporarily lent to the room for playback (see setSpotifyDelegate/clearSpotifyDelegate)
      gmSpotifyConnected: false, // mirrors whether the GM has their OWN (non-delegated) Spotify connection ready - see setGmSpotifyConnected. Lets players tell a share would be redundant before even asking.
      pendingSpotifyShareRequest: null, // { playerId, userId, name } | null - a player's offer to lend their Spotify, awaiting the GM's explicit accept/deny (see requestSpotifyShare/resolveSpotifyShareRequest)
      // Site-owner-only, one-shot manipulation set live from the hidden
      // /admin screen (server/admin.js) - re-set by hand before every round,
      // never persisted, and stripped out in sanitizeRoomForGM/ForPlayer
      // below so neither the room's GM nor any player ever sees these exist.
      // Consumed and cleared the moment they're applied (releasePairs /
      // startGame), so nothing lingers into a later, unrelated round.
      pairOverrides: [], // { playerIdA, playerIdB } - forces these two players into the same couple next time the GM randomizes pairing (never applied to a couple the GM built manually)
      killerOverridePlayerIds: [], // player ids, in priority order - whichever of their couples are present become killer(s) first, before the normal random draw fills any remaining slots
    };
    
    this.rooms.set(code, newRoom);
    this.touchRoom(code); // in case it's abandoned before broadcastRoom() ever fires for it (e.g. no player joins)
    return newRoom;
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  addPlayer(roomId, playerName, danceRole, isFlexible, clientId, socketId, userId = null) {
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
      hasNoPhone: false,
      userId: userId, // logged-in account, for game_participations stats - null if anonymous
      // Server-generated, unguessable - proves a reconnectToRoom/joinRoom
      // call claiming this clientId is really this player's own session, not
      // just someone who saw the id (every player's own id is visible to
      // everyone else in the room, e.g. for couples/kick-target references -
      // see index.js's joinRoom/reconnectToRoom, which reads this back off
      // the returned room to send in the join callback). Never included in
      // sanitizeRoomForGM/ForPlayer. Players added before this existed have
      // null here - reconnect falls back to id-only for those (see
      // index.js), so an in-progress game isn't forced to kick everyone the
      // moment this ships; they're upgraded to a real secret the next time
      // they successfully reconnect.
      sessionSecret: randomUUID(),
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
      hasNoPhone: true,
      userId: null, // manually added players never have an account
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

  // A departing player's lent Spotify connection (see setSpotifyDelegate)
  // shouldn't keep powering the room's music after they've left - they're no
  // longer around to revoke it themselves or notice it's still active.
  clearSpotifyDelegateIfPlayer(room, playerId) {
    if (room.spotifyDelegate?.playerId === playerId) room.spotifyDelegate = null;
    if (room.pendingSpotifyShareRequest?.playerId === playerId) room.pendingSpotifyShareRequest = null;
  }

  removePlayer(roomId, clientId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.players = room.players.filter(p => p.id !== clientId);
    room.pendingRejoinRequests = room.pendingRejoinRequests.filter(r => r.targetPlayerId !== clientId);
    this.clearSpotifyDelegateIfPlayer(room, clientId);
    return room;
  }

  // Removes an entire couple (all members) - used when the GM deletes a
  // couple directly or kicks one of its members (see kickPlayer/kickCouple
  // in index.js) - a GM removal takes the whole couple out deliberately.
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
    memberIds.forEach(id => this.clearSpotifyDelegateIfPlayer(room, id));

    if (room.status !== 'lobby' && room.status !== 'paired') {
      this.checkEndCondition(room);
    }

    return { room, removedPlayers };
  }

  // A player voluntarily leaving (closing the tab, clicking "leave") should
  // only remove that one player - their partner(s) didn't leave and
  // shouldn't be ejected too (see index.js's leaveRoom, as opposed to
  // kickPlayer/kickCouple which are deliberate GM removals of the whole
  // couple via removeCouple above). A 3-person group losing one member
  // still has a valid pair left, so the couple stays intact with that
  // member dropped; a 2-person couple losing one has nobody left to dance
  // with, so it's dissolved and whoever remains becomes an unpaired
  // spectator for the rest of this round instead of losing their spot
  // entirely - same as anyone else without a partner.
  removeCoupleMember(roomId, leavingClientId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const couple = room.couples.find(c => c.playerIds.includes(leavingClientId));
    if (!couple) return null;

    room.players = room.players.filter(p => p.id !== leavingClientId);
    room.pendingRejoinRequests = room.pendingRejoinRequests.filter(r => r.targetPlayerId !== leavingClientId);
    this.clearSpotifyDelegateIfPlayer(room, leavingClientId);

    const remainingIds = couple.playerIds.filter(id => id !== leavingClientId);
    const dissolved = remainingIds.length < 2;

    if (dissolved) {
      room.couples = room.couples.filter(c => c.id !== couple.id);
      remainingIds.forEach(id => {
        const player = room.players.find(p => p.id === id);
        if (player) player.danceRole = 'spectator';
      });
    } else {
      couple.playerIds = remainingIds;
      if (couple.votingPlayerId === leavingClientId) {
        couple.votingPlayerId = remainingIds[0];
      }
    }

    if (room.status !== 'lobby' && room.status !== 'paired') {
      this.checkEndCondition(room);
    }

    return { room, remainingIds, dissolved };
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

    // Carries over the player's own sessionSecret (see addPlayer's comment)
    // rather than issuing a new one - a co-GM's id is just as visible to
    // everyone else in the room as a player's is (needed for chat/UI
    // references), so reconnecting as a co-GM needs the same proof-of-
    // session check as reconnecting as a player (see index.js's
    // reconnectToRoom's isCoGm branch).
    const playerSnapshot = { id: player.id, socketId: player.socketId, name: player.name, userId: player.userId || null, sessionSecret: player.sessionSecret || randomUUID() };

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

  // Used only when a co-GM's own connection is actually leaving the room
  // (see index.js's leaveRoom) - fully removes their GM seat with no way
  // back except a fresh promotion. Revoking GM rights while they're still
  // around uses demoteCoGMToPlayer below instead, which keeps them in the
  // game as a regular player.
  removeCoGM(roomId, gmId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const removedGM = room.coGms.find(g => g.id === gmId) || null;
    room.coGms = room.coGms.filter(g => g.id !== gmId);
    return { room, removedGM };
  }

  // Revoking GM rights (by the main GM, or a co-GM stepping down themselves -
  // see index.js's removeCoGM handler) - unlike removeCoGM above, they stay
  // in the room as a fresh, unpaired player (spectator by default) rather
  // than being kicked out entirely, since "demoted to player" is the whole
  // point of this action.
  demoteCoGMToPlayer(roomId, gmId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const idx = room.coGms.findIndex(g => g.id === gmId);
    if (idx === -1) return null;
    const [demoted] = room.coGms.splice(idx, 1);

    const demotedPlayer = {
      id: demoted.id,
      socketId: demoted.socketId,
      name: demoted.name,
      danceRole: 'spectator',
      originalDanceRole: 'spectator',
      isFlexible: false,
      isConfirmed: false,
      hasViewedRole: false,
      hasNoPhone: false,
      userId: demoted.userId || null,
      sessionSecret: demoted.sessionSecret || randomUUID(), // see addPlayer's comment on this field
    };
    room.players.push(demotedPlayer);
    return { room, demotedPlayer };
  }

  // Main-GM-only (verified by socket.id in index.js, not just any GM) - the
  // current main GM steps down in favor of an existing co-GM, who becomes the
  // new main GM; the outgoing main GM becomes a co-GM themselves rather than
  // losing GM status entirely. outgoingName is the display name the outgoing
  // main GM will show as in the co-GM list from now on - the main GM has no
  // stored name of their own anywhere else (see gm.mainGmName's generic
  // client-side label), so the client supplies one (their account's display
  // name, or a generic fallback) at the moment of handover.
  handoverGM(roomId, targetCoGmId, outgoingName) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const idx = room.coGms.findIndex(g => g.id === targetCoGmId);
    if (idx === -1) return null;
    const [newMainGm] = room.coGms.splice(idx, 1);

    const oldMainGm = { id: room.gmClientId, socketId: room.gmId, name: outgoingName, userId: room.gmUserId, sessionSecret: randomUUID() };

    room.gmId = newMainGm.socketId;
    room.gmClientId = newMainGm.id;
    room.gmUserId = newMainGm.userId || null;
    // newMainGm.id (their old co-GM id) is not a secret - it's been visible
    // to every socket in the room in every roomUpdated broadcast the whole
    // time they were a co-GM (see sanitizeRoomForGM/ForPlayer, which only
    // ever strip socketId/sessionSecret from coGms entries, not id). Without
    // rotating gmSessionSecret here too, room.gmClientId alone would become
    // a publicly-known value the instant this handover completes, and
    // reconnectToRoom's isPrimaryGm check would accept it from literally
    // anyone who'd been watching the room - a full, silent GM takeover. This
    // mints a fresh one and hands it only to the new GM's own socket, same
    // as oldMainGm.sessionSecret just above for the outgoing GM's new co-GM
    // seat.
    room.gmSessionSecret = randomUUID();
    room.coGms.push(oldMainGm);

    return { room, newMainGm, newMainGmSessionSecret: room.gmSessionSecret, oldMainGm };
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

  requestRejoin(roomId, playerName, requestingClientId, requestingSocketId, sessionSecret) {
    const room = this.rooms.get(roomId);
    // Error values are locale keys resolved by the client ('server.<key>').
    if (!room) return { error: 'roomNotFound' };

    const targetPlayer = room.players.find(p => p.name.toLowerCase() === playerName.toLowerCase());
    if (!targetPlayer) return { error: 'rejoinPlayerNotFound' };

    if (targetPlayer.id === requestingClientId) {
      // Same device/session reconnecting - no GM approval needed. Same
      // sessionSecret proof as joinRoom/reconnectToRoom's own id-match
      // branches (see addPlayer's comment) - this id is just as visible to
      // everyone else in the room as any other player's.
      if (targetPlayer.sessionSecret && targetPlayer.sessionSecret !== sessionSecret) {
        return { error: 'sessionInvalid' };
      }
      if (!targetPlayer.sessionSecret) targetPlayer.sessionSecret = randomUUID();
      targetPlayer.socketId = requestingSocketId;
      return { room, autoReconnected: true, sessionSecret: targetPlayer.sessionSecret };
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
    // A fresh secret too (see addPlayer's comment on this field) - the old
    // device never knew this one anyway (it's never sent to a rejected/
    // superseded session), and issuing a new one here means the old device
    // couldn't reconnect as this player even if it somehow still had it cached.
    targetPlayer.sessionSecret = randomUUID();

    room.couples.forEach(c => {
      c.playerIds = c.playerIds.map(id => id === oldPlayerId ? newPlayerId : id);
      if (c.votingPlayerId === oldPlayerId) c.votingPlayerId = newPlayerId;
    });

    return { room, request, accepted: true, oldSocketId, newPlayerId, sessionSecret: targetPlayer.sessionSecret };
  }

  // Players can suggest a song any time. Two shapes: a real Spotify track
  // (searched from the player's own connected Spotify, or picked from one of
  // their own imported playlists) or a plain-text hint (title/artist typed by
  // hand) for players without their own Spotify connected - either way it's
  // capped per-player and per-room so it can't be used to spam the GM's list.
  // playerId must belong to an actual player in the room - the display name
  // is always read from there too, never trusted from the caller, so a
  // forged clientId can't spoof another player's name or dodge the per-player cap.
  addSongSuggestion(roomId, playerId, payload) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'roomNotFound' };

    const player = room.players.find(p => p.id === playerId);
    if (!player) return { error: 'notInRoom' };

    let typedFields;
    if (payload?.type === 'text') {
      const text = (payload.text || '').trim().slice(0, 200);
      if (!text) return { error: 'invalidTrack' };
      typedFields = { type: 'text', text };
    } else {
      const track = payload?.track;
      if (!track || !track.uri) return { error: 'invalidTrack' };
      typedFields = { type: 'spotify', track };
    }

    const ownCount = room.songSuggestions.filter(s => s.playerId === playerId).length;
    if (ownCount >= 5) return { error: 'suggestionLimitReached' };
    if (room.songSuggestions.length >= 20) return { error: 'suggestionLimitReached' };

    const suggestion = {
      id: `suggestion_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
      ...typedFields,
      playerId,
      playerName: player.name,
      createdAt: Date.now(),
    };
    room.songSuggestions.push(suggestion);
    return { room, suggestion };
  }

  makeQueueEntryId() {
    return `queue_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  }

  // A confirmed suggestion always lands in the queue rather than immediately
  // hijacking playback - the GM decides when to actually play it, same as
  // everything else queued (see playQueueEntry). A text-type suggestion
  // becomes a placeholder the GM must resolve with a real track before it
  // can be played (see resolveQueueTextEntry) - it no longer just vanishes.
  confirmSongSuggestion(roomId, suggestionId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'roomNotFound' };

    const idx = room.songSuggestions.findIndex(s => s.id === suggestionId);
    if (idx === -1) return { error: 'suggestionNotFound' };
    const [suggestion] = room.songSuggestions.splice(idx, 1);
    // Carried onto the queue entry (and from there onto nowPlaying/playedSongs -
    // see playQueueEntry/addPlayedSong) so the GM can still see who asked for a
    // track after it's been confirmed, not just while it's a pending suggestion.
    const suggestedBy = { id: suggestion.playerId, name: suggestion.playerName };

    if (suggestion.type === 'text') {
      room.songQueue.push({ id: this.makeQueueEntryId(), type: 'text', text: suggestion.text, suggestedBy });
    } else {
      const track = suggestion.track;
      room.songQueue.push({
        id: this.makeQueueEntryId(),
        type: 'spotify',
        uri: track.uri,
        name: track.name,
        artist: (track.artists || []).map(a => a.name).join(', ') || track.artist || '',
        suggestedBy,
      });
    }

    return { room, suggestion };
  }

  dismissSongSuggestion(roomId, suggestionId) {
    const room = this.rooms.get(roomId);
    if (!room) return { error: 'roomNotFound' };

    const idx = room.songSuggestions.findIndex(s => s.id === suggestionId);
    if (idx === -1) return { error: 'suggestionNotFound' };
    const [suggestion] = room.songSuggestions.splice(idx, 1);
    return { room, suggestion };
  }

  // Appends one real track to the queue - from search, or "add to queue" on
  // an already-known track.
  addToSongQueue(roomId, entry) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (!entry?.uri || !entry?.name) return room;
    room.songQueue.push({ id: this.makeQueueEntryId(), type: 'spotify', uri: entry.uri, name: entry.name, artist: entry.artist || '' });
    return room;
  }

  // Bulk-appends every track of a chosen playlist - replaces the old
  // client-local "use this playlist for the dance" cycling mechanism, which
  // never survived a GM reload (see the plan's item-10 root cause).
  // Shuffled (Fisher-Yates) before appending so the track that ends up
  // playing first is random instead of always the playlist's actual first
  // track every time it's picked.
  addPlaylistToSongQueue(roomId, tracks) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const valid = (tracks || []).filter(t => t?.uri && t?.name);
    for (let i = valid.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [valid[i], valid[j]] = [valid[j], valid[i]];
    }
    valid.forEach(t => {
      room.songQueue.push({ id: this.makeQueueEntryId(), type: 'spotify', uri: t.uri, name: t.name, artist: t.artist || '' });
    });
    return room;
  }

  removeFromSongQueue(roomId, entryId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.songQueue = room.songQueue.filter(e => e.id !== entryId);
    return room;
  }

  // Replaces the queue order with the given id order. Any id not currently
  // in the queue is ignored, and any current entry missing from entryIds is
  // kept (appended, in its prior relative order) instead of dropped - guards
  // against a stale reorder call (e.g. a co-GM added an entry between this
  // client reading the list and submitting the reorder) silently losing it.
  reorderSongQueue(roomId, entryIds) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const byId = new Map(room.songQueue.map(e => [e.id, e]));
    const reordered = (entryIds || []).map(id => byId.get(id)).filter(Boolean);
    const mentioned = new Set(reordered.map(e => e.id));
    const missing = room.songQueue.filter(e => !mentioned.has(e.id));
    room.songQueue = [...reordered, ...missing];
    return room;
  }

  // Converts a text-type placeholder into a real spotify-type entry in
  // place (same id, same position) once the GM finds a matching track.
  resolveQueueTextEntry(roomId, entryId, track) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const entry = room.songQueue.find(e => e.id === entryId);
    if (!entry || entry.type !== 'text') return room;
    if (!track?.uri || !track?.name) return room;
    entry.type = 'spotify';
    entry.uri = track.uri;
    entry.name = track.name;
    entry.artist = track.artist || '';
    delete entry.text;
    return room;
  }

  // Removes a queued entry and makes it the current pick. By entry id
  // (rather than always the front of the queue) so the GM can jump to any
  // queued track, not just the next one in line. A text-type entry must be
  // resolved first - this is a no-op for one, since there's no real track to play yet.
  playQueueEntry(roomId, entryId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const idx = room.songQueue.findIndex(e => e.id === entryId);
    if (idx === -1) return room;
    if (room.songQueue[idx].type !== 'spotify') return room;
    const [entry] = room.songQueue.splice(idx, 1);
    room.nowPlaying = { uri: entry.uri, name: entry.name, artist: entry.artist || '', suggestedBy: entry.suggestedBy || null };
    return room;
  }

  // Reported by the GM's client the moment it actually starts a track through
  // the Spotify Web Playback SDK - this is the only source of truth for "what
  // played", since track selection/playback itself is entirely client-side.
  // Skips a duplicate entry if it's the same track as the last one played
  // (redundant reconnect/resume calls shouldn't pad the post-game list).
  addPlayedSong(roomId, track) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (!track?.uri || !track?.name) return room;

    const last = room.playedSongs[room.playedSongs.length - 1];
    if (last && last.uri === track.uri) return room;

    room.playedSongs.push({ uri: track.uri, name: track.name, artist: track.artist || '', playedAt: Date.now(), round: room.round, suggestedBy: track.suggestedBy || null });
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

  // Picks who casts a couple's vote under a given votingRole setting:
  // prefers a member matching that role, falling back to any other
  // phone-carrying member of the couple. For 'random', no player's
  // danceRole is ever 'random', so the role-match filter is always empty
  // and this always falls through to picking randomly among every
  // phone-carrying member - i.e. 'random' needs no separate branch here.
  // Ties (e.g. a 3-person group with two members of the matching role) are
  // also broken randomly.
  pickVotingPlayerId(members, votingRole) {
    const votingRoleMembers = members.filter(p => p.danceRole === votingRole);
    let candidates = votingRoleMembers.filter(p => !p.hasNoPhone);
    if (candidates.length === 0) {
      candidates = members.filter(p => !p.hasNoPhone);
    }
    return candidates.length > 0
      ? candidates[Math.floor(Math.random() * candidates.length)].id
      : null;
  }

  // Re-assigns every couple's votingPlayerId under the room's current
  // votingRole - called once when pairs are released, and again whenever the
  // GM changes the setting afterward (setVotingRole), since that selector
  // lives in the paired-phase Game Settings panel, i.e. after couples
  // already exist.
  assignVotingPlayers(room) {
    room.couples.forEach(couple => {
      const members = couple.playerIds.map(id => room.players.find(p => p.id === id)).filter(Boolean);
      couple.votingPlayerId = this.pickVotingPlayerId(members, room.votingRole);
    });
  }

  // GM marks a player's phone as unusable mid-game (dead battery, lost
  // device, etc.) - or reverses that if it was a misclick. Reuses the exact
  // same hasNoPhone flag a manually-added phoneless player starts with, so
  // every existing fallback (partner speaks for the couple via
  // votingPlayerId, or the GM enters it directly if the whole couple is now
  // phoneless - see isCoupleFullyPhoneless in GMDashboard.jsx) applies here
  // too without any separate code path.
  setPlayerPhoneStatus(roomId, playerId, hasNoPhone) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    const player = room.players.find(p => p.id === playerId);
    if (!player) return null;
    player.hasNoPhone = !!hasNoPhone;

    const couple = room.couples.find(c => c.playerIds.includes(playerId));
    if (couple) {
      const members = couple.playerIds.map(id => room.players.find(p => p.id === id)).filter(Boolean);
      couple.votingPlayerId = this.pickVotingPlayerId(members, room.votingRole);
    }
    return room;
  }

  setVotingRole(roomId, role) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.votingRole = role;
    if (room.couples.length > 0) this.assignVotingPlayers(room);
    return room;
  }

  // Mirrors the GM's lobby "own audio system" / "use Spotify" choice onto the
  // room so players know whether Spotify-track suggestions are actually
  // usable this game (see PlayerScreen.jsx) - the choice itself still lives
  // client-side in GMDashboard.jsx, this is just a broadcastable copy of it.
  setUseSpotify(roomId, useSpotify) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.useSpotify = !!useSpotify;
    return room;
  }

  // Mirrors whether the GM's own browser currently has a working, non-
  // delegated Spotify connection (GMDashboard.jsx reports this whenever it
  // changes) - lets players tell a share offer would be redundant (or that
  // one is even allowed) without having to try it first.
  setGmSpotifyConnected(roomId, connected) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.gmSpotifyConnected = !!connected;
    return room;
  }

  // A player with their own account-linked Spotify connection (server/
  // spotify.js's spotify_accounts, made once from the Playlists page) offers
  // to lend it to the room for playback - e.g. the GM has no Spotify
  // Premium/account connected but a player does. index.js verifies the
  // connection is actually live (getValidAccessToken) before calling this.
  // Doesn't take effect on its own - only records the offer for the GM to
  // explicitly accept/deny (see resolveSpotifyShareRequest); only one offer
  // can be pending at a time, a second request from a different player is
  // rejected by the caller while one is already pending or already active.
  requestSpotifyShare(roomId, playerId, userId, name) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.pendingSpotifyShareRequest = { playerId, userId, name };
    return room;
  }

  // GM-only decision on a pending offer (see requestSpotifyShare). Accepting
  // commits it the same way the old direct-grant flow used to; denying just
  // clears the offer without ever touching room.spotifyDelegate.
  resolveSpotifyShareRequest(roomId, accept) {
    const room = this.rooms.get(roomId);
    if (!room || !room.pendingSpotifyShareRequest) return null;
    const { playerId, userId, name } = room.pendingSpotifyShareRequest;
    room.pendingSpotifyShareRequest = null;
    if (accept) room.spotifyDelegate = { userId, playerId, name };
    return room;
  }

  // Only the player who granted it (or the GM, e.g. if that player leaves
  // unexpectedly) may revoke - checked by the caller (index.js) via
  // room.spotifyDelegate.playerId, this just does the clearing.
  clearSpotifyDelegate(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.spotifyDelegate = null;
    return room;
  }

  // Site owner's hidden per-round pairing intent (see room.pairOverrides,
  // set live from /admin during this specific room's lobby phase - never a
  // persistent per-account rule, so it can't repeat suspiciously across
  // different games). Silently rearranges the GM's freshly-generated couples
  // so any pair of currently-joined players the owner picked end up in the
  // same couple - invisible to the GM, who only ever sees the final result.
  // Skips any couple the GM built by hand (isManual, see GMDashboard.jsx's
  // handleCreateManualCouple) - only couples that came from "randomize" are
  // ever touched, so a GM's explicit manual pairing is never overridden.
  // Swaps one other member between the two couples rather than just moving
  // the target player, so neither couple's size changes.
  applyPairOverrides(room, couples) {
    const overrides = room.pairOverrides;
    if (!overrides?.length) return couples;
    const usedPlayerIds = new Set();

    for (const { playerIdA, playerIdB } of overrides) {
      if (!playerIdA || !playerIdB || usedPlayerIds.has(playerIdA) || usedPlayerIds.has(playerIdB)) continue;

      const coupleA = couples.find(c => c.playerIds.includes(playerIdA));
      const coupleB = couples.find(c => c.playerIds.includes(playerIdB));
      if (!coupleA || !coupleB || coupleA === coupleB) continue;
      if (coupleA.isManual || coupleB.isManual) continue;

      const partnerOfA = coupleA.playerIds.find(id => id !== playerIdA);
      if (!partnerOfA) continue;

      coupleA.playerIds = coupleA.playerIds.filter(id => id !== partnerOfA).concat(playerIdB);
      coupleB.playerIds = coupleB.playerIds.filter(id => id !== playerIdB).concat(partnerOfA);
      [coupleA, coupleB].forEach(c => {
        c.name = c.playerIds.map(id => room.players.find(p => p.id === id)?.name).filter(Boolean).join(' & ');
      });

      usedPlayerIds.add(playerIdA);
      usedPlayerIds.add(playerIdB);
    }
    return couples;
  }

  releasePairs(roomId, generatedCouples) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const couples = this.applyPairOverrides(
      room,
      generatedCouples.map(c => ({ ...c, playerIds: [...c.playerIds] }))
    );
    room.pairOverrides = []; // one-shot - the owner sets this fresh before every round

    room.couples = couples.map((c, index) => ({
      id: `couple_${index}`,
      name: c.name,
      playerIds: c.playerIds,
      role: 'dancer',
      specialRole: null, // one of SPECIAL_ROLE_KEYS, assigned in startGame - never set on a killer couple
      status: 'alive',
      eliminatedBy: null, // 'kill' | 'vote', set when status flips to 'eliminated' - used by the Märtyrer special role
      votingPlayerId: null, // assigned below by assignVotingPlayers
    }));
    this.assignVotingPlayers(room);

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

  // --- Site-owner overrides (hidden /admin screen, server/admin.js) ---
  // All four below act on a live room's in-memory state only - nothing here
  // is ever persisted, so it can't outlive the room or leak into a later game.

  addPairOverride(roomId, playerIdA, playerIdB) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (!playerIdA || !playerIdB || playerIdA === playerIdB) return { error: 'invalid_players' };
    if (!room.players.some(p => p.id === playerIdA) || !room.players.some(p => p.id === playerIdB)) {
      return { error: 'player_not_found' };
    }
    const alreadyUsed = room.pairOverrides.some(o => [o.playerIdA, o.playerIdB].includes(playerIdA) || [o.playerIdA, o.playerIdB].includes(playerIdB));
    if (alreadyUsed) return { error: 'already_paired' };
    room.pairOverrides.push({ playerIdA, playerIdB });
    return { pairOverrides: room.pairOverrides };
  }

  removePairOverride(roomId, index) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.pairOverrides.splice(index, 1);
    return { pairOverrides: room.pairOverrides };
  }

  addKillerOverride(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (!playerId || !room.players.some(p => p.id === playerId)) return { error: 'player_not_found' };
    if (!room.killerOverridePlayerIds.includes(playerId)) room.killerOverridePlayerIds.push(playerId);
    return { killerOverridePlayerIds: room.killerOverridePlayerIds };
  }

  removeKillerOverride(roomId, playerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.killerOverridePlayerIds = room.killerOverridePlayerIds.filter(id => id !== playerId);
    return { killerOverridePlayerIds: room.killerOverridePlayerIds };
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
    this.roomLastActivity.delete(roomId);
  }

  // Options bundled into a single object (rather than more positional
  // params) since this list keeps growing with every new mode/setting - see
  // the new-roles/modes plan. specialRoles is a { [key in SPECIAL_ROLE_KEYS]:
  // boolean } map of which special roles the GM enabled this game; v1 keeps
  // it to at most one couple per role and one role per couple (no stacking -
  // see the assignment loop below), which is simple enough to not need an
  // "allow multiple" override yet.
  startGame(roomId, {
    killerCount = 1,
    killMode = 'classic',
    deadPlayersKeepDancing = false,
    specialRoles = {},
    martyrWinsOnVote = false, // GM override for the Märtyrer special role's win condition - see couple.eliminatedBy
  } = {}) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    // Only reachable from 'paired' in the UI (GMDashboard's killer-count/mode
    // stepper only renders there) - guarded here too so a stale co-GM tab or a
    // race between two GMs can't re-trigger role assignment mid-round.
    if (room.status !== 'paired') return null;

    room.couples.forEach(c => {
      c.status = 'alive';
      c.role = 'dancer';
      c.specialRole = null;
      c.eliminatedBy = null;
    });
    room.votes = {};
    room.victimIds = [];
    room.pendingVictimIds = [];
    room.killMode = killMode;
    room.killClaims = {};
    room.victimReports = {};
    room.silentReportsResolved = false;
    room.seerPeeks = {}; // { [seerCoupleId]: { targetCoupleId, targetRole } } - see seerPeek()
    // Cosmetic-only setting (see PlayerScreen.jsx's isEliminated branch) - an
    // eliminated couple gets a rotating physical task prompt instead of just
    // "leave the floor". Never affects game logic/elimination itself, so a
    // plain per-game flag (not reset mid-game) is enough - no server-side
    // validation needed since nothing reads it but that one client branch.
    room.deadPlayersKeepDancing = !!deadPlayersKeepDancing;
    room.martyrWinsOnVote = !!martyrWinsOnVote;

    // Filter out spectator-only couples if any exist, but normally couples don't contain spectators.
    const activeCouples = room.couples;

    if (activeCouples.length > 0) {
      // Hard rule: killers must stay a strict minority of individual
      // *players*, not just couples - a couple can be 2 or 3 people (see the
      // odd-excess trio handling in the pairing flow), so capping by
      // couple-count alone could let a majority of people end up killers if
      // the couples chosen as killers happen to be the larger ones. "< half"
      // (not "<= half"), so ceil(total/2) itself is never allowed either.
      const totalPlayers = activeCouples.reduce((sum, c) => sum + c.playerIds.length, 0);
      const maxKillerPlayers = Math.ceil(totalPlayers / 2) - 1;
      let killerPlayerCount = 0;
      const canAssign = (couple) => killerPlayerCount + couple.playerIds.length <= maxKillerPlayers;
      const assign = (couple) => { couple.role = 'killer'; killerPlayerCount += couple.playerIds.length; };

      // Site-owner override (room.killerOverridePlayerIds, set live from
      // /admin during this room's paired phase): whichever couple contains
      // one of these players becomes a killer first, in priority order,
      // before any remaining slots are filled by the normal random draw
      // below - invisible to the GM either way, who only ever sees who the
      // final killer(s) turned out to be. Killer selection has no manual GM
      // path to respect (always this random draw), unlike pairing. An
      // override that would break the half-player rule is skipped rather
      // than honored - the rule has no manual bypass.
      const forcedCoupleIds = new Set();
      for (const playerId of room.killerOverridePlayerIds) {
        if (forcedCoupleIds.size >= killerCount) break;
        const couple = activeCouples.find(c => c.playerIds.includes(playerId));
        if (!couple || forcedCoupleIds.has(couple.id) || !canAssign(couple)) continue;
        forcedCoupleIds.add(couple.id);
        assign(couple);
      }

      const remainingSlots = killerCount - forcedCoupleIds.size;
      if (remainingSlots > 0) {
        const remainingCouples = activeCouples.filter(c => !forcedCoupleIds.has(c.id));
        const shuffledIndices = Array.from({length: remainingCouples.length}, (_, i) => i).sort(() => 0.5 - Math.random());
        let assigned = 0;
        for (const idx of shuffledIndices) {
          if (assigned >= remainingSlots) break;
          const couple = remainingCouples[idx];
          if (!canAssign(couple)) continue; // would push killers to/past half the players - skip, try the next shuffled candidate
          assign(couple);
          assigned++;
        }
      }
    }
    room.killerOverridePlayerIds = []; // one-shot - the owner sets this fresh before every round

    // Special-role assignment (see SPECIAL_ROLE_KEYS/couple.specialRole) -
    // runs after killers are picked so a killer couple never doubles as a
    // special-role holder (these are a dancer-side mechanic). One random
    // dancer couple per GM-enabled role, one role per couple for v1 (no
    // stacking) - if there aren't enough dancer couples left for every
    // enabled role, the remaining ones are simply skipped rather than
    // failing the whole game start.
    const unassignedForSpecialRole = activeCouples.filter(c => c.role === 'dancer');
    for (const key of SPECIAL_ROLE_KEYS) {
      if (!specialRoles[key] || unassignedForSpecialRole.length === 0) continue;
      const idx = Math.floor(Math.random() * unassignedForSpecialRole.length);
      unassignedForSpecialRole[idx].specialRole = key;
      unassignedForSpecialRole.splice(idx, 1);
    }

    room.players.forEach(p => p.hasViewedRole = false);
    room.status = 'role_reveal';
    room.round = 1;
    room.endReason = null;
    room.startedAt = Date.now();
    room.roundHistory = [];
    return room;
  }

  // Snapshots one concluded round's outcome for later persistence (see
  // recordGameConclusion in server/stats.js) - called from revealKill (when a
  // round ends without a vote), executeVote (every completed round), and
  // endGame (a round cut short by an abort). Resolves each couple's vote to
  // the specific player who cast it via votingPlayerId, since that's the
  // detail that would otherwise only ever exist transiently in room.votes.
  pushRoundRecord(room, { votedOutCoupleId, completed }) {
    const votingPlayerName = (coupleId) => {
      const couple = room.couples.find(c => c.id === coupleId);
      const player = couple && room.players.find(p => p.id === couple.votingPlayerId);
      return player ? player.name : null;
    };

    room.roundHistory.push({
      roundNumber: room.round,
      killedCoupleIds: [...room.victimIds],
      votedOutCoupleId: votedOutCoupleId || null,
      votes: Object.entries(room.votes).map(([voterCoupleId, suspectCoupleId]) => ({
        voterCoupleId,
        suspectCoupleId,
        votingPlayerName: votingPlayerName(voterCoupleId),
      })),
      killClaims: room.killMode === 'silent' ? { ...room.killClaims } : null,
      victimReports: room.killMode === 'silent' ? { ...room.victimReports } : null,
      completed,
    });
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
    // Reachable from 'role_reveal' (first dancing phase of the round) or
    // 'kill_reveal'/'voting' (the round-increment branch just below exists
    // for those) - anything else (lobby, paired, dancing itself,
    // silent_report, ended) is a stale/out-of-order call.
    if (!['role_reveal', 'kill_reveal', 'voting'].includes(room.status)) return null;

    if (room.status === 'kill_reveal' || room.status === 'voting') {
      room.round += 1;
    }
    room.status = 'dancing';
    room.pendingVictimIds = [];
    room.victimIds = [];
    room.votes = {};
    room.killClaims = {};
    room.victimReports = {};
    room.silentReportsResolved = false;
    room.seerPeeks = {};
    // The previous round's track (if any) is over the moment this round
    // starts - only playQueueEntry should ever put something here again. Left
    // unset, a round started with nothing queued (the GM proceeded past the
    // song-ready lock with no track to hand off) would keep showing the
    // *previous* round's song as "currently playing" - stale display data,
    // not stale audio, but indistinguishable from the real thing on screen.
    room.nowPlaying = null;
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
    // GM's manual kill-marking UI only renders during 'dancing' (classic mode)
    // or 'silent_report' (GM override for a phoneless couple) - see
    // GMDashboard.jsx's handleReportKill call sites.
    if (room.status !== 'dancing' && room.status !== 'silent_report') return null;

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

  // Silent-report mode: moves from the (song-only) dancing phase into the report-collection phase.
  proceedToSilentReport(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'dancing' || room.killMode !== 'silent') return null;

    room.status = 'silent_report';
    return room;
  }

  // Silent-report mode: a killer couple privately declares who they killed (or null for nobody).
  submitKillClaim(roomId, clientId, victimCoupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'silent_report') return null;

    const couple = room.couples.find(c => c.playerIds.includes(clientId));
    if (!couple || couple.role !== 'killer' || couple.status !== 'alive') return null;
    if (victimCoupleId !== null) {
      const victim = room.couples.find(c => c.id === victimCoupleId);
      if (!victim || victim.status !== 'alive' || victim.role === 'killer') return null;
    }

    room.killClaims[couple.id] = victimCoupleId;
    return room;
  }

  // Silent-report mode: any other alive couple reports whether they felt killed, and by whom.
  submitVictimReport(roomId, clientId, feltKilled, suspectCoupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'silent_report') return null;

    const couple = room.couples.find(c => c.playerIds.includes(clientId));
    if (!couple || couple.role === 'killer' || couple.status !== 'alive') return null;
    if (feltKilled && suspectCoupleId !== null) {
      const suspect = room.couples.find(c => c.id === suspectCoupleId);
      if (!suspect || suspect.status !== 'alive') return null;
    }

    room.victimReports[couple.id] = { feltKilled: !!feltKilled, suspectCoupleId: feltKilled ? suspectCoupleId : null };
    return room;
  }

  // GM submits a kill claim directly on behalf of a killer couple with no phone in the game.
  gmSubmitKillClaim(roomId, killerCoupleId, victimCoupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'silent_report') return null;

    room.killClaims[killerCoupleId] = victimCoupleId;
    return room;
  }

  // GM submits a victim report directly on behalf of a couple with no phone in the game.
  gmSubmitVictimReport(roomId, coupleId, feltKilled, suspectCoupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'silent_report') return null;

    room.victimReports[coupleId] = { feltKilled: !!feltKilled, suspectCoupleId: feltKilled ? suspectCoupleId : null };
    return room;
  }

  // Silent-report mode: match killer claims against victim reports and pre-populate pendingVictimIds
  // for the GM to review/adjust using the same manual kill-marking UI as classic mode.
  resolveSilentReports(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'silent_report') return null;

    const matches = [];
    for (const [killerCoupleId, victimCoupleId] of Object.entries(room.killClaims)) {
      if (!victimCoupleId) continue;
      const report = room.victimReports[victimCoupleId];
      if (report && report.feltKilled && report.suspectCoupleId === killerCoupleId) {
        matches.push(victimCoupleId);
      }
    }

    room.pendingVictimIds = [...new Set(matches)];
    room.silentReportsResolved = true;
    return room;
  }

  revealKill(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    // Only reachable from 'dancing' (classic mode) or 'silent_report' (silent
    // mode, after resolveSilentReports) - see GMDashboard.jsx's
    // handleRevealKill call sites.
    if (room.status !== 'dancing' && room.status !== 'silent_report') return null;

    room.victimIds = [...room.pendingVictimIds];

    room.victimIds.forEach(victimId => {
      const couple = room.couples.find(c => c.id === victimId);
      if (couple) { couple.status = 'eliminated'; couple.eliminatedBy = 'kill'; }
    });

    if (this.checkEndCondition(room)) {
      // Game ends right after the kill phase - this round never reaches a
      // vote, so it has to be archived here instead of executeVote.
      this.pushRoundRecord(room, { votedOutCoupleId: null, completed: true });
    } else {
      room.status = 'kill_reveal';
    }
    return room;
  }

  // Seer special role: once per round, during 'kill_reveal' (after this
  // round's outcome is known to everyone, before voting) - a deliberate
  // choice over the silent-report phase, since that one only exists for
  // killMode: 'silent' and only covers reconciling *this* round's kill, not
  // a general phone-action moment. kill_reveal is common to both kill modes
  // and lands at the same "round's result is settled" beat, so Protector/
  // Toucher (once built) can reuse this exact hook without touching
  // proceedToSilentReport's classic/silent gating at all.
  seerPeek(roomId, clientId, targetCoupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'kill_reveal') return null;

    const couple = room.couples.find(c => c.playerIds.includes(clientId));
    if (!couple || couple.specialRole !== 'seer' || couple.status !== 'alive') return null;
    // One peek per round - room.seerPeeks is wiped at every round boundary
    // (startGame/startDancing/executeVote/proceedFromVoteReveal), so "already
    // used" just means this couple already has an entry in it.
    if (Object.prototype.hasOwnProperty.call(room.seerPeeks, couple.id)) return room;

    const target = room.couples.find(c => c.id === targetCoupleId);
    if (!target || target.id === couple.id || target.status !== 'alive') return room;

    room.seerPeeks[couple.id] = { targetCoupleId: target.id, targetRole: target.role };
    return room;
  }

  proceedToVoting(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'kill_reveal') return null;

    room.status = 'voting';
    room.votes = {};
    room.votingEndTime = Date.now() + 45000; // 45 seconds timer
    return room;
  }

  delegateVote(roomId, coupleId, votingPlayerId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;

    const couple = room.couples.find(c => c.id === coupleId);
    if (!couple) return room;
    // Only an actual member of this couple may be handed the vote - a bogus
    // or unrelated id here would just softlock the couple's own voting UI
    // (nothing else reads votingPlayerId), but there's no reason to allow it.
    if (!couple.playerIds.includes(votingPlayerId)) return room;
    couple.votingPlayerId = votingPlayerId;
    return room;
  }

  castVote(roomId, voterClientId, suspectCoupleId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'voting') return null;

    // Map voterClientId to their couple ID. Must still be alive - a couple
    // eliminated during this round's kill phase (before voting even started)
    // has no say in who gets voted out. The client already hides the voting
    // UI once eliminated (see PlayerScreen.jsx's isEliminated screen), but
    // that's not enforced here otherwise - unlike submitKillClaim/
    // submitVictimReport just above, which already both require
    // couple.status === 'alive'.
    const voterCouple = room.couples.find(c => c.playerIds.includes(voterClientId));
    if (voterCouple && voterCouple.status === 'alive') {
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
    // Reachable from 'voting' (normal execute) or 'kill_reveal' (GM's "skip
    // to next round" shortcut, handleSkipToNextRound -> handleExecuteVote(null))
    // - see GMDashboard.jsx. The two behave differently below: a real vote
    // has a result worth announcing (see 'vote_reveal' branch), the shortcut
    // never went through voting at all, so there's nothing to reveal.
    if (room.status !== 'voting' && room.status !== 'kill_reveal') return null;

    const wasVoting = room.status === 'voting';

    if (suspectCoupleId) {
      const couple = room.couples.find(c => c.id === suspectCoupleId);
      if (couple) { couple.status = 'eliminated'; couple.eliminatedBy = 'vote'; }
    }

    const gameEnded = this.checkEndCondition(room);
    // Archive this round before the reset below wipes victimIds/votes/etc. -
    // whether the game continues or ends here, this round genuinely
    // completed (reached a vote), unlike the abort case in endGame().
    this.pushRoundRecord(room, { votedOutCoupleId: suspectCoupleId || null, completed: true });

    if (gameEnded) return room; // checkEndCondition already set room.status = 'ended'

    if (wasVoting) {
      // Publish the result and stop here instead of jumping straight into
      // the next round unannounced - proceedFromVoteReveal (triggered by the
      // GM from this new phase) does the actual round-advance below, once
      // they've acknowledged who got voted out and (if needed) picked a song.
      room.status = 'vote_reveal';
      room.voteResult = { votedOutCoupleId: suspectCoupleId || null };
      return room;
    }

    // room.status was 'kill_reveal' (the skip-voting shortcut) - never had a
    // vote to reveal, so advance straight into the next round exactly as before.
    room.status = 'dancing';
    room.round += 1;
    room.victimIds = [];
    room.pendingVictimIds = [];
    room.votes = {};
    room.killClaims = {};
    room.victimReports = {};
    room.silentReportsResolved = false;
    room.seerPeeks = {};
    room.nowPlaying = null;

    return room;
  }

  // Advances from the vote-reveal phase (see executeVote's 'voting' branch
  // above) into the next round - the same round-advance executeVote used to
  // do immediately, now deferred until the GM has acknowledged the reveal
  // and (if the song-ready lock applies) picked a song via the same
  // popup/bypass flow as everywhere else this lock is enforced.
  proceedFromVoteReveal(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    if (room.status !== 'vote_reveal') return null;

    room.status = 'dancing';
    room.round += 1;
    room.victimIds = [];
    room.pendingVictimIds = [];
    room.votes = {};
    room.killClaims = {};
    room.victimReports = {};
    room.silentReportsResolved = false;
    room.seerPeeks = {};
    room.voteResult = null;
    // See the identical comment in startDancing() above - same stale-display
    // bug, reachable here when nothing was queued for the new round.
    room.nowPlaying = null;
    return room;
  }

  endGame(roomId) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    // Nothing to abort from 'lobby' (no game running - would otherwise create
    // a bogus games/game_couples row via recordGameConclusion), and re-running
    // this on an already-'ended' room would overwrite a natural conclusion's
    // endReason with 'aborted', flipping every player's victory screen to the
    // generic "game aborted" message even though it already legitimately
    // ended (the GM's "End Game Now" menu item stays visible after a natural
    // end too, so this is genuinely reachable, not just a theoretical race).
    if (room.status === 'lobby' || room.status === 'ended') return null;

    // A round already archived by revealKill/executeVote (game aborted right
    // after a normal conclusion, or endGame called again on an already-ended
    // room) shouldn't be recorded twice. Otherwise, if this round had any
    // real activity, archive it as cut short rather than losing it entirely.
    const lastRound = room.roundHistory[room.roundHistory.length - 1];
    const currentRoundAlreadyArchived = lastRound?.roundNumber === room.round;
    const hasUncommittedActivity = room.victimIds.length > 0 || Object.keys(room.votes).length > 0 || Object.keys(room.killClaims).length > 0;
    if (!currentRoundAlreadyArchived && hasUncommittedActivity) {
      this.pushRoundRecord(room, { votedOutCoupleId: null, completed: false });
    }

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
    room.voteResult = null;
    room.victimIds = [];
    room.pendingVictimIds = [];
    room.killClaims = {};
    room.victimReports = {};
    room.silentReportsResolved = false;
    room.seerPeeks = {};
    room.endReason = null;
    room.songSuggestions = [];
    room.playedSongs = [];
    room.startedAt = null;
    room.roundHistory = [];
    room.spotifyDelegate = null; // a new game should re-ask for consent rather than silently keep using a previous grant
    room.pendingSpotifyShareRequest = null;
    // Unlike songQueue (deliberately left alone - see its declaration comment
    // above, a GM re-running games in the same room shouldn't lose their
    // curated upcoming picks), nowPlaying represents "what's actively
    // playing this instant" - there's no active round anymore once reset to
    // lobby, so leaving the previous game's last track sitting here would
    // just be stale data with nothing left to describe.
    room.nowPlaying = null;
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
