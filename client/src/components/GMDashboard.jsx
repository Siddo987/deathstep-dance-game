import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { socket } from '../socket.js';
import { ConfirmModal, AlertModal } from './Modal.jsx';
import { loginWithSpotify, searchTracks, playTrack, pausePlayback, logoutSpotify } from '../spotify.js';
import { getCookieConsent } from './CookieBanner.jsx';
import { useLanguage } from '../i18n.jsx';
import coupleIcon from './couple_icon.png';
import {
  MessageCircle, Crown, X, PhoneOff, Repeat, Scissors, AlertTriangle, Lightbulb,
  Music2, Skull, Sparkles, EyeOff, Eye, Check, Plus, Minus, LogOut, Flag,
  Send, UserPlus, QrCode, Play, Pause, Search, ChevronRight, Timer, Smartphone
} from 'lucide-react';

function GMDashboard({ room, onLeave, myGmName, gmChatMessages, onSendGMChatMessage }) {
  const { t } = useLanguage();
  const spotifyAllowed = getCookieConsent()?.spotify === true;

  const [pendingCouples, setPendingCouples] = useState([]);
  const [currentGroup, setCurrentGroup] = useState([]);

  // State for the randomizer dialog flow
  const [randomizerFlow, setRandomizerFlow] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [showCouplesModal, setShowCouplesModal] = useState(false);
  const [showTeamModal, setShowTeamModal] = useState(false);
  const [showChatModal, setShowChatModal] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [seenChatCount, setSeenChatCount] = useState(0);
  const [confirmState, setConfirmState] = useState(null);
  const [alertState, setAlertState] = useState(null);
  const [privacyMode, setPrivacyMode] = useState(() => {
    return localStorage.getItem('deathstep_privacy_mode') === 'true';
  });

  const PRIVACY_MASK = '**********';
  const maskName = (name) => (privacyMode && name) ? PRIVACY_MASK : name;
  const maskCombinedName = (combinedName) => {
    if (!combinedName || !privacyMode) return combinedName;
    return combinedName.split(' & ').map(() => PRIVACY_MASK).join(' & ');
  };

  // Spotify State - the whole feature is unavailable unless consented to in the cookie banner
  const [useSpotify, setUseSpotify] = useState(() => {
    return spotifyAllowed && localStorage.getItem('deathstep_use_spotify') === 'true';
  });
  const [spotifyToken, setSpotifyToken] = useState(null);
  const [spotifyPlayerId, setSpotifyPlayerId] = useState(null);
  const [spotifyPlayer, setSpotifyPlayer] = useState(null);
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasSongFinished, setHasSongFinished] = useState(false);
  // Spotify player status as a locale key plus optional raw detail from the SDK
  const [playerStatus, setPlayerStatus] = useState({ key: 'spotify.statusInit', detail: '', isError: false });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedTrack, setSelectedTrack] = useState(() => {
    const saved = localStorage.getItem('deathstep_selected_track');
    return saved ? JSON.parse(saved) : null;
  });
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(1);

  // New states
  const [bypassRoleView, setBypassRoleView] = useState(false);
  const [bypassPaired, setBypassPaired] = useState(false);
  const [bypassSongReady, setBypassSongReady] = useState(false);

  // Manual (phoneless) player form
  const [manualPlayerName, setManualPlayerName] = useState('');
  const [manualDanceRole, setManualDanceRole] = useState('lead');
  const [manualIsFlexible, setManualIsFlexible] = useState(false);

  // Killer setting
  const [killerCount, setKillerCount] = useState(() => room.couples?.length >= 9 ? 2 : 1);
  const [killMode, setKillMode] = useState('classic');

  // GM vote-on-behalf selections during voting phase, keyed by voting couple's id
  const [gmVoteSelections, setGmVoteSelections] = useState({});

  // GM submit-on-behalf selections during the silent-report dancing phase, keyed by couple's id
  const [gmKillClaimSelections, setGmKillClaimSelections] = useState({});
  const [gmVictimReportSelections, setGmVictimReportSelections] = useState({});

  // Voting countdown, shown to the GM purely as an informational hint (it never
  // gates any GM action - the GM can always execute a vote regardless of timer).
  const gmServerOffsetRef = React.useRef(0);
  React.useEffect(() => {
    if (room.serverTime) {
      gmServerOffsetRef.current = room.serverTime - Date.now();
    }
  }, [room.serverTime]);

  const [gmVotingTimeLeft, setGmVotingTimeLeft] = useState(0);
  React.useEffect(() => {
    if (room.status === 'voting' && room.votingEndTime) {
      const updateTimer = () => {
        const estimatedServerTime = Date.now() + gmServerOffsetRef.current;
        setGmVotingTimeLeft(Math.max(0, Math.ceil((room.votingEndTime - estimatedServerTime) / 1000)));
      };
      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    } else {
      setGmVotingTimeLeft(0);
    }
  }, [room.status, room.votingEndTime]);

  const isSpotifyReady = !useSpotify || (selectedTrack && spotifyPlayer);

  // Update default killer count when couples array changes
  React.useEffect(() => {
    if (room.status === 'lobby') {
      setKillerCount(room.couples?.length >= 9 ? 2 : 1);
    }
  }, [room.couples?.length, room.status]);

  React.useEffect(() => {
    if (room.status !== 'paired') setBypassPaired(false);
    if (room.status !== 'role_reveal') setBypassRoleView(false);
    if (room.status !== 'voting' && room.status !== 'role_reveal' && room.status !== 'kill_reveal') setBypassSongReady(false);
  }, [room.status]);

  React.useEffect(() => {
    localStorage.setItem('deathstep_use_spotify', useSpotify);
  }, [useSpotify]);

  React.useEffect(() => {
    if (!spotifyAllowed && useSpotify) {
      setUseSpotify(false);
    }
  }, [spotifyAllowed]);

  React.useEffect(() => {
    localStorage.setItem('deathstep_privacy_mode', privacyMode);
  }, [privacyMode]);

  const chatEndRef = React.useRef(null);
  React.useEffect(() => {
    if (showChatModal) {
      chatEndRef.current?.scrollIntoView({ block: 'end' });
      // While the chat is open, everything (including messages that arrive live) counts as seen.
      setSeenChatCount(gmChatMessages.length);
    }
  }, [showChatModal, gmChatMessages]);

  // Never notify for the GM's own messages, and never while the chat is already open.
  const unreadChatCount = showChatModal ? 0 : gmChatMessages.slice(seenChatCount).filter(m => m.senderName !== myGmName).length;

  // Ensure music is paused if we leave the dancing phase
  React.useEffect(() => {
    if (room.status !== 'dancing' && spotifyPlayer) {
      spotifyPlayer.pause().catch(e => console.error("Auto-pause failed", e));
    }
  }, [room.status, spotifyPlayer]);

  React.useEffect(() => {
    if (selectedTrack) {
      localStorage.setItem('deathstep_selected_track', JSON.stringify(selectedTrack));
    } else {
      localStorage.removeItem('deathstep_selected_track');
    }
  }, [selectedTrack]);

  React.useEffect(() => {
    if (room.status === 'kill_reveal' || room.status === 'lobby') {
      setSelectedTrack(null);
    }
  }, [room.status]);

  React.useEffect(() => {
    if (!spotifyPlayer || !isPlaying) return;
    const interval = setInterval(() => {
      spotifyPlayer.getCurrentState().then(state => {
        if (!state) return;
        setPlaybackProgress(state.position);
        setPlaybackDuration(state.duration);
        localStorage.setItem('deathstep_playback_state', JSON.stringify({
          position: state.position,
          uri: state.track_window.current_track.uri,
          timestamp: Date.now()
        }));
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [spotifyPlayer, isPlaying]);

  React.useEffect(() => {
    if (playbackDuration > 0 && playbackProgress >= playbackDuration - 1500) {
      setHasSongFinished(true);
    }
  }, [playbackProgress, playbackDuration]);

  React.useEffect(() => {
    setHasSongFinished(false);
  }, [selectedTrack, room?.status, room?.round]);

  React.useEffect(() => {
    const token = localStorage.getItem('spotify_access_token');
    if (token) {
      setSpotifyToken(token);
    }
  }, []);

  // Only fetch Spotify's SDK from their CDN once the GM has actually opted
  // into the Spotify integration - never load third-party scripts by default.
  React.useEffect(() => {
    if (!useSpotify) return;
    if (document.getElementById('spotify-sdk-script')) return;
    const script = document.createElement('script');
    script.id = 'spotify-sdk-script';
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    document.body.appendChild(script);
  }, [useSpotify]);

  React.useEffect(() => {
    if (!spotifyToken) return;

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'Deathstep Web Player',
        getOAuthToken: cb => { cb(spotifyToken); },
        volume: 0.5
      });

      player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        setSpotifyPlayerId(device_id);
        setSpotifyPlayer(player);
        setPlayerStatus({ key: 'spotify.statusReady', detail: '', isError: false });

        // Check if we should auto-resume
        const savedPlayback = localStorage.getItem('deathstep_playback_state');
        if (savedPlayback) {
          try {
            const pb = JSON.parse(savedPlayback);
            const elapsed = Date.now() - pb.timestamp;
            // Only resume if the timestamp is less than 15s old (meaning it was a quick reload while playing)
            if (elapsed < 15000) {
              const newPosition = pb.position + elapsed;
              playTrack(pb.uri, device_id, newPosition).catch(e => console.error(e));
            }
          } catch (e) { }
        }
      });

      player.addListener('player_state_changed', state => {
        if (!state) return;
        setIsPlaying(!state.paused);
        setPlaybackProgress(state.position);
        setPlaybackDuration(state.duration);
      });

      player.addListener('not_ready', ({ device_id }) => {
        setPlayerStatus({ key: 'spotify.statusOffline', detail: '', isError: false });
      });

      player.addListener('initialization_error', ({ message }) => setPlayerStatus({ key: 'spotify.statusError', detail: message, isError: true }));
      player.addListener('authentication_error', ({ message }) => setPlayerStatus({ key: 'spotify.statusAuthError', detail: message, isError: true }));
      player.addListener('account_error', ({ message }) => setPlayerStatus({ key: 'spotify.statusPremium', detail: message, isError: true }));

      player.connect();
    };

    if (window.Spotify) {
      window.onSpotifyWebPlaybackSDKReady();
    }
  }, [spotifyToken]);

  const menuRef = React.useRef();

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleStartGame = () => {
    socket.emit('startGame', { roomId: room.id, killerCount, killMode });
  };

  const handleSubmitKillClaimForCouple = (killerCoupleId) => {
    const victimId = gmKillClaimSelections[killerCoupleId];
    socket.emit('gmSubmitKillClaim', { roomId: room.id, killerCoupleId, victimId: victimId || null });
  };

  const handleSubmitVictimReportForCouple = (coupleId, feltKilled) => {
    const suspectId = feltKilled ? gmVictimReportSelections[coupleId] : null;
    socket.emit('gmSubmitVictimReport', { roomId: room.id, coupleId, feltKilled, suspectId: suspectId || null });
  };

  const handleResolveSilentReports = () => {
    socket.emit('resolveSilentReports', { roomId: room.id });
  };

  const handleRejoinResponse = (requestId, accept) => {
    socket.emit('respondToRejoinRequest', { roomId: room.id, requestId, accept });
  };

  const handleReportKill = (victimCoupleId) => {
    if (victimCoupleId === null) {
      socket.emit('reportKill', { roomId: room.id, victimId: null });
    } else {
      setConfirmState({
        message: t('gm.reportKillConfirm'),
        onConfirm: () => socket.emit('reportKill', { roomId: room.id, victimId: victimCoupleId })
      });
    }
  };

  const handleExecuteVote = async (suspectCoupleId) => {
    const aliveCouples = room.couples.filter(c => c.status === 'alive' && c.id !== suspectCoupleId);
    const killersAlive = aliveCouples.some(c => c.role === 'killer');
    const willEnd = !killersAlive || aliveCouples.length <= 2;

    socket.emit('executeVote', { roomId: room.id, suspectId: suspectCoupleId });

    if (!willEnd && selectedTrack && spotifyToken) {
      try {
        await playTrack(selectedTrack.uri, spotifyPlayerId);
      } catch (e) {
        if (e.message === 'NO_ACTIVE_DEVICE') {
          setAlertState({ message: t('spotify.noDevice') });
        } else {
          console.error("Failed to play track", e);
        }
      }
    }
  };

  const handleStartDancing = async () => {
    socket.emit('startDancing', { roomId: room.id });
    if (selectedTrack && spotifyToken) {
      try {
        await playTrack(selectedTrack.uri, spotifyPlayerId);
      } catch (e) {
        if (e.message === 'NO_ACTIVE_DEVICE') {
          setAlertState({ message: t('spotify.noDevice') });
        } else {
          console.error("Failed to play track", e);
        }
      }
    }
  };

  const handleRevealKill = () => {
    setConfirmState({
      message: t('gm.revealKillConfirm') + (isPlaying ? '\n' + t('gm.revealKillMusicWarning') : ''),
      onConfirm: async () => {
        socket.emit('revealKill', { roomId: room.id });
        if (spotifyToken) {
          try {
            await pausePlayback();
          } catch (e) {
            console.error("Failed to pause playback", e);
          }
        }
      }
    });
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    try {
      const results = await searchTracks(searchQuery);
      setSearchResults(results);
    } catch (e) {
      console.error("Failed to search tracks", e);
    }
  };

  const handleProceedToVoting = () => {
    socket.emit('proceedToVoting', { roomId: room.id });
  };

  const handleStartDiscussion = () => {
    socket.emit('startDiscussion', { roomId: room.id });
  };

  const handleSkipToNextRound = () => {
    handleExecuteVote(null);
  };

  const handleResetGame = () => {
    setConfirmState({
      message: t('gm.resetConfirm'),
      onConfirm: () => {
        if (spotifyPlayer) {
          spotifyPlayer.pause().catch(e => console.error("Failed to pause", e));
        }
        socket.emit('resetGame', { roomId: room.id });
        setPendingCouples([]);
        setCurrentGroup([]);
        setRandomizerFlow(null);
        setPrivacyMode(false);
      }
    });
  };

  const handleEndGame = () => {
    setConfirmState({
      message: t('gm.endGameConfirm'),
      onConfirm: () => {
        if (spotifyPlayer) {
          spotifyPlayer.pause().catch(e => console.error("Failed to pause", e));
        }
        socket.emit('endGame', { roomId: room.id });
      }
    });
  };

  const handleChangeRole = (clientId, newRole) => {
    socket.emit('updatePlayerRole', { roomId: room.id, clientId, newRole });
  };

  const handleAddManualPlayer = () => {
    const name = manualPlayerName.trim();
    if (!name) return;
    socket.emit('addManualPlayer', { roomId: room.id, playerName: name, danceRole: manualDanceRole, isFlexible: manualIsFlexible }, (response) => {
      if (response.success) {
        setManualPlayerName('');
        setManualIsFlexible(false);
      } else {
        setAlertState({ message: response.messageKey ? t(`server.${response.messageKey}`) : t('gm.addPlayerFailed') });
      }
    });
  };

  const handleKickPlayer = (clientId) => {
    setConfirmState({
      message: t('gm.kickPlayerConfirm'),
      onConfirm: () => socket.emit('kickPlayer', { roomId: room.id, clientId })
    });
  };

  const handleKickCouple = (coupleId, coupleName) => {
    setConfirmState({
      message: t('gm.kickCoupleConfirm', { name: maskName(coupleName) }),
      onConfirm: () => socket.emit('kickCouple', { roomId: room.id, coupleId })
    });
  };

  const handlePromoteToGM = (playerId, playerName) => {
    setConfirmState({
      message: t('gm.promoteConfirm', { name: maskName(playerName) }),
      onConfirm: () => socket.emit('promoteToGM', { roomId: room.id, playerId })
    });
  };

  const handleRemoveCoGM = (gmId, gmName) => {
    setConfirmState({
      message: t('gm.removeCoGmConfirm', { name: maskName(gmName) }),
      onConfirm: () => socket.emit('removeCoGM', { roomId: room.id, gmId })
    });
  };

  const handleSendChat = () => {
    const text = chatInput.trim();
    if (!text) return;
    onSendGMChatMessage(text);
    setChatInput('');
  };

  const handleDissolvePendingCouple = (index) => {
    const newCouples = [...pendingCouples];
    newCouples.splice(index, 1);
    setPendingCouples(newCouples);
  };

  const handleSetVotingRole = (e) => {
    socket.emit('setVotingRole', { roomId: room.id, role: e.target.value });
  };

  const handleGmConfirmCouple = (coupleId) => {
    socket.emit('gmConfirmCouple', { roomId: room.id, coupleId });
  };

  const handleGmMarkCoupleRoleViewed = (coupleId) => {
    socket.emit('gmMarkCoupleRoleViewed', { roomId: room.id, coupleId });
  };

  const handleGmCastVote = (voterCoupleId, suspectCoupleId) => {
    socket.emit('gmCastVote', { roomId: room.id, coupleId: voterCoupleId, suspectId: suspectCoupleId });
  };

  const handleGmDelegateVote = (coupleId, votingPlayerId) => {
    socket.emit('delegateVote', { roomId: room.id, coupleId, votingPlayerId });
  };

  const isCoupleFullyPhoneless = (couple) => couple.playerIds.every(id => {
    const player = room.players.find(p => p.id === id);
    return player && player.hasNoPhone;
  });

  const getCoupleMembers = (couple) => couple.playerIds.map(id => room.players.find(p => p.id === id)).filter(Boolean);

  // --- Pairing Logic ---

  const getUnpairedPlayers = () => {
    const pairedIds = pendingCouples.flatMap(c => c.playerIds);
    return room.players.filter(p => !pairedIds.includes(p.id));
  };

  const pickRandom = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const hasPhone = (p) => !p.hasNoPhone;

  const executePairing = (leads, follows, makeThreesomes) => {
    const newCouples = [...pendingCouples];
    let spectatorsToUpdate = [];

    // Determine how many base 1-to-1 couples we can form
    const baseCouplesCount = Math.min(leads.length, follows.length);

    // Form base 1-to-1 couples first. Players without a phone are matched with a
    // phone-having partner from the other role whenever one is still available,
    // so a couple never ends up with nobody able to use the app.
    for (let i = 0; i < baseCouplesCount; i++) {
      const noPhoneLeads = leads.filter(p => !hasPhone(p));
      const noPhoneFollows = follows.filter(p => !hasPhone(p));

      let l, f;
      if (noPhoneLeads.length > 0 && follows.some(hasPhone)) {
        l = pickRandom(noPhoneLeads);
        f = pickRandom(follows.filter(hasPhone));
      } else if (noPhoneFollows.length > 0 && leads.some(hasPhone)) {
        f = pickRandom(noPhoneFollows);
        l = pickRandom(leads.filter(hasPhone));
      } else {
        l = pickRandom(leads);
        f = pickRandom(follows);
      }

      leads.splice(leads.indexOf(l), 1);
      follows.splice(follows.indexOf(f), 1);

      newCouples.push({
        name: `${l.name} & ${f.name}`,
        playerIds: [l.id, f.id]
      });
    }

    if (makeThreesomes) {
      const remainingPlayers = [...leads, ...follows]; // One of these is empty
      const coupleHasPhone = (c) => c.playerIds.some(id => {
        const player = room.players.find(pl => pl.id === id);
        return player && hasPhone(player);
      });

      while (remainingPlayers.length > 0) {
        const pIndex = Math.floor(Math.random() * remainingPlayers.length);
        const p = remainingPlayers.splice(pIndex, 1)[0];

        // Find couples that currently have exactly 2 players (to avoid 4-person groups)
        const availableCouples = newCouples.filter(c => c.playerIds.length === 2);

        if (availableCouples.length > 0) {
          // Prefer fixing a phoneless base couple with a phone-having 3rd person,
          // and avoid adding a phoneless 3rd person to an already-phoneless couple.
          let candidates = availableCouples;
          if (hasPhone(p)) {
            const withoutPhone = availableCouples.filter(c => !coupleHasPhone(c));
            if (withoutPhone.length > 0) candidates = withoutPhone;
          } else {
            const withPhone = availableCouples.filter(c => coupleHasPhone(c));
            if (withPhone.length > 0) candidates = withPhone;
          }

          const chosen = pickRandom(candidates);
          chosen.name += ` & ${p.name}`;
          chosen.playerIds.push(p.id);
        } else {
          // Fallback if no 2-person couples left (should be blocked by UI check)
          spectatorsToUpdate.push(p);
        }
      }
    }

    const phonelessCouples = newCouples.filter(c => !c.playerIds.some(id => {
      const player = room.players.find(pl => pl.id === id);
      return player && hasPhone(player);
    }));
    if (phonelessCouples.length > 0) {
      setAlertState({ message: t('gm.phonelessWarning', { count: phonelessCouples.length, names: phonelessCouples.map(c => maskName(c.name)).join(', ') }) });
    }

    setPendingCouples(newCouples);

    spectatorsToUpdate.forEach(p => {
      socket.emit('updatePlayerRole', { roomId: room.id, clientId: p.id, newRole: 'spectator' });
    });
    setRandomizerFlow(null);
  };

  const handleRandomPairsClick = () => {
    const unpaired = getUnpairedPlayers();
    if (unpaired.length < 2) {
      setAlertState({ message: t('gm.notEnoughUnpaired') });
      return;
    }

    let leads = unpaired.filter(p => p.danceRole === 'lead');
    let follows = unpaired.filter(p => p.danceRole === 'follow');
    let excessCount = Math.abs(leads.length - follows.length);
    let baseCouplesCount = Math.min(leads.length, follows.length);

    if (excessCount > 0) {
      const isLeadExcess = leads.length > follows.length;
      let excessGroup = isLeadExcess ? leads : follows;
      let missingGroup = isLeadExcess ? follows : leads;
      const missingRole = isLeadExcess ? 'follow' : 'lead';

      const flexibleExcess = excessGroup.filter(p => p.isFlexible);
      let swapsDone = 0;

      // Calculate how many swaps are strictly needed to avoid 4-person couples
      // Math.max(0, Math.ceil((excessCount - baseCouplesCount) / 3))
      // But we actually want to reach perfect balance if we can (excessCount == 0 or 1).
      // optimalSwaps to get perfect balance is Math.floor(excessCount / 2).
      const optimalSwaps = Math.floor(excessCount / 2);

      while (flexibleExcess.length > 0 && swapsDone < optimalSwaps) {
        const flexPlayer = flexibleExcess.pop();

        // Remove from excess group
        const idx = excessGroup.findIndex(p => p.id === flexPlayer.id);
        excessGroup.splice(idx, 1);

        // Update role
        flexPlayer.danceRole = missingRole;
        missingGroup.push(flexPlayer);
        socket.emit('updatePlayerRole', { roomId: room.id, clientId: flexPlayer.id, newRole: missingRole });

        swapsDone++;
      }

      // Re-assign leads and follows after auto-swaps
      leads = isLeadExcess ? excessGroup : missingGroup;
      follows = isLeadExcess ? missingGroup : excessGroup;

      // Recalculate imbalance
      excessCount = Math.abs(leads.length - follows.length);
      baseCouplesCount = Math.min(leads.length, follows.length);
    }

    if (excessCount === 0) {
      executePairing([...leads], [...follows], false);
    } else {
      setRandomizerFlow({
        step: 'mixed_selection',
        excessType: leads.length > follows.length ? 'lead' : 'follow',
        excessCount,
        baseCouplesCount,
        leads,
        follows,
        selectedToKick: []
      });
    }
  };

  const handlePlayerActionChange = (playerId, action) => {
    setRandomizerFlow({
      ...randomizerFlow,
      playerActions: { ...randomizerFlow.playerActions, [playerId]: action }
    });
  };

  const executeMixedSelection = () => {
    let leads = [...randomizerFlow.leads];
    let follows = [...randomizerFlow.follows];

    const actions = randomizerFlow.playerActions || {};
    const selectedSwitch = Object.keys(actions).filter(id => actions[id] === 'switch');
    const selectedSpectator = Object.keys(actions).filter(id => actions[id] === 'spectator');

    const effectiveExcess = randomizerFlow.excessCount - (2 * selectedSwitch.length) - selectedSpectator.length;
    const effectiveBase = randomizerFlow.baseCouplesCount + selectedSwitch.length;

    const currentMinSwitchNeeded = Math.max(0, Math.ceil((effectiveExcess - effectiveBase) / 3));

    if (currentMinSwitchNeeded > 0) {
      setAlertState({ message: t('gm.randNotEnough') });
      return;
    }

    const targetRole = randomizerFlow.excessType === 'lead' ? 'follow' : 'lead';

    selectedSwitch.forEach(id => {
      socket.emit('updatePlayerRole', { roomId: room.id, clientId: id, newRole: targetRole });
    });
    selectedSpectator.forEach(id => {
      socket.emit('updatePlayerRole', { roomId: room.id, clientId: id, newRole: 'spectator' });
    });

    if (randomizerFlow.excessType === 'lead') {
      const switched = leads.filter(p => selectedSwitch.includes(p.id));
      leads = leads.filter(p => !selectedSwitch.includes(p.id) && !selectedSpectator.includes(p.id));
      switched.forEach(p => p.danceRole = 'follow');
      follows.push(...switched);
    } else {
      const switched = follows.filter(p => selectedSwitch.includes(p.id));
      follows = follows.filter(p => !selectedSwitch.includes(p.id) && !selectedSpectator.includes(p.id));
      switched.forEach(p => p.danceRole = 'lead');
      leads.push(...switched);
    }

    setRandomizerFlow(null);
    executePairing(leads, follows, true);
  };

  const handleToggleCurrentGroup = (player) => {
    if (currentGroup.includes(player.id)) {
      setCurrentGroup(currentGroup.filter(id => id !== player.id));
    } else {
      setCurrentGroup([...currentGroup, player.id]);
    }
  };

  const handleCreateManualCouple = () => {
    if (currentGroup.length < 2) return;
    if (currentGroup.length > 3) {
      setAlertState({ message: t('gm.groupMax3') });
      return;
    }

    const selectedPlayers = currentGroup.map(id => room.players.find(p => p.id === id)).filter(Boolean);
    const hasLead = selectedPlayers.some(p => p.danceRole === 'lead');
    const hasFollow = selectedPlayers.some(p => p.danceRole === 'follow');

    if (!hasLead || !hasFollow) {
      setAlertState({ message: t('gm.groupNeedsLeadFollow') });
      return;
    }

    if (!selectedPlayers.some(hasPhone)) {
      setAlertState({ message: t('gm.groupNeedsPhone') });
      return;
    }

    const names = currentGroup.map(id => room.players.find(p => p.id === id)?.name).join(' & ');
    setPendingCouples([
      ...pendingCouples,
      { name: names, playerIds: currentGroup }
    ]);
    setCurrentGroup([]);
  };

  const handleClearPairs = () => {
    socket.emit('resetRoles', { roomId: room.id });
    setPendingCouples([]);
    setCurrentGroup([]);
    setRandomizerFlow(null);
  };

  const handleReleasePairs = () => {
    if (pendingCouples.length === 0) {
      setAlertState({ message: t('gm.noCouplesToRelease') });
      return;
    }

    if (pendingCouples.length <= 2) {
      setAlertState({ message: t('gm.need3Couples') });
      return;
    }

    if (pendingCouples.length === 3) {
      setConfirmState({
        message: t('gm.only3Couples'),
        onConfirm: () => socket.emit('releasePairs', { roomId: room.id, generatedCouples: pendingCouples })
      });
      return;
    }

    socket.emit('releasePairs', { roomId: room.id, generatedCouples: pendingCouples });
  };

  // --- Helper views ---

  const getVoteCount = (suspectCoupleId) => {
    if (!room.votes) return 0;
    return Object.values(room.votes).filter(id => id === suspectCoupleId).length;
  };

  const handleExecuteVoteSafe = (suspectCoupleId) => {
    const aliveCouples = room.couples ? room.couples.filter(c => c.status === 'alive') : [];
    const voteCounts = aliveCouples.map(c => ({ id: c.id, votes: getVoteCount(c.id) }));
    const maxVotes = Math.max(...voteCounts.map(v => v.votes), 0);
    const topCouples = voteCounts.filter(v => v.votes === maxVotes && maxVotes > 0);

    const message = suspectCoupleId === null
      ? (topCouples.length === 1
        ? t('gm.voteWarnMajority', { name: maskName(aliveCouples.find(c => c.id === topCouples[0].id)?.name), count: maxVotes })
        : t('gm.voteKickNobody'))
      : (getVoteCount(suspectCoupleId) < maxVotes || maxVotes === 0
        ? t('gm.voteWarnNotMost', { count: getVoteCount(suspectCoupleId), max: maxVotes })
        : (topCouples.length > 1
          ? t('gm.voteTieBreak', { count: maxVotes })
          : t('gm.voteKickMost')));

    setConfirmState({
      message,
      onConfirm: () => handleExecuteVote(suspectCoupleId)
    });
  };

  const aliveCouples = room.couples ? room.couples.filter(c => c.status === 'alive') : [];

  const renderTruncatedNames = (combinedName) => {
    if (!combinedName) return null;
    const names = maskCombinedName(combinedName).split(' & ');
    return (
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1, gap: '5px' }}>
        {names.map((n, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <span style={{ opacity: 0.5, flexShrink: 0 }}>&amp;</span>}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{n}</span>
          </React.Fragment>
        ))}
      </div>
    );
  };

  // Members stacked vertically, each with a phone/no-phone icon - used anywhere
  // the GM needs to see phone status per person, not just the couple as a whole.
  const renderMembersWithPhoneIcons = (couple, { dimmed = false, bold = false } = {}) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0, flex: 1 }}>
      {getCoupleMembers(couple).map(m => (
        <span key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: dimmed ? 'var(--text-muted)' : 'white', fontWeight: bold ? 'bold' : 'normal' }}>
          {maskName(m.name)}
          {m.hasNoPhone
            ? <PhoneOff size={13} className="icon-inline" title={t('gm.noPhoneTitle')} style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
            : <Smartphone size={13} className="icon-inline" title={t('gm.hasPhoneTitle')} style={{ color: 'var(--neon-blue)', flexShrink: 0 }} />}
        </span>
      ))}
    </div>
  );

  const renderSpotifyControls = (hideIfConnected = false, isModal = false) => {
    if (!useSpotify) return null;
    if (hideIfConnected && spotifyToken) return null;
    if (!isModal && selectedTrack) return null;

    return (
      <div className="panel panel--success">
        <h3 style={{ color: 'var(--neon-green)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.84.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.54-1.02.72-1.559.42z" />
          </svg>
          {t('spotify.integration')}
        </h3>

        {!spotifyToken ? (
          <button className="cyber-button" style={{ background: 'var(--neon-green)', color: 'black' }} onClick={loginWithSpotify}>
            {t('spotify.connect')}
          </button>
        ) : (
          <div>
            <div style={{ color: 'var(--text-muted)', marginBottom: '15px' }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '5px' }}>
                <strong style={{ color: spotifyPlayerId ? 'var(--neon-green)' : 'var(--neon-red)' }}>{t(playerStatus.key)}{playerStatus.detail ? ` ${playerStatus.detail}` : ''}</strong>
                {playerStatus.isError && (
                  <button
                    className="cyber-button"
                    style={{ padding: '4px 8px', fontSize: '0.7rem', background: 'var(--neon-green)', color: 'black', minWidth: 'auto', margin: 0 }}
                    onClick={loginWithSpotify}
                  >
                    {t('spotify.retryAuth')}
                  </button>
                )}
              </div>
              {t('spotify.selectHint')}
            </div>

            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <input
                type="text"
                className="cyber-input"
                style={{ marginBottom: 0, flex: 1 }}
                placeholder={t('spotify.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Search size={16} className="icon-inline" /> {t('spotify.search')}
              </button>
            </form>

            {searchResults.length > 0 && (
              <div className="couple-list" style={{ marginTop: 0, marginBottom: '15px' }}>
                {searchResults.map(track => (
                  <div key={track.id}
                    onClick={() => {
                      setSelectedTrack(track);
                      setSearchResults([]);
                      setSearchQuery('');
                      if (room.status === 'dancing' && spotifyPlayerId) {
                        playTrack(track.uri, spotifyPlayerId).catch(console.error);
                      }
                    }}
                    className="list-item list-item--purple"
                    style={{ cursor: 'pointer' }}
                  >
                    <img src={track.album.images[2]?.url} alt="" style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{track.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{track.artists.map(a => a.name).join(', ')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedTrack && (
              <div className="list-item panel--success" style={{ borderColor: 'var(--neon-green)', background: 'rgba(29,185,84,0.2)' }}>
                <img src={selectedTrack.album.images[2]?.url} alt="" style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8rem', color: 'var(--neon-green)', textTransform: 'uppercase', fontWeight: 'bold' }}>{t('spotify.selectedTrack')}</div>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{selectedTrack.name}</div>
                </div>
                <button
                  className="icon-btn"
                  onClick={() => setSelectedTrack(null)}
                >
                  <X size={18} />
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSpotifyPlaybackBar = () => {
    if (!useSpotify || !spotifyToken || !selectedTrack) return null;
    return (
      <div style={{ position: 'relative', marginBottom: '20px', padding: '15px', background: 'rgba(29, 185, 84, 0.1)', border: '1px solid #1db954', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 0, height: '4px', background: '#1db954', width: `${(playbackProgress / playbackDuration) * 100}%`, transition: 'width 1s linear' }}></div>
        <img src={selectedTrack.album.images[2]?.url} alt="" style={{ width: '50px', height: '50px', borderRadius: '50%', position: 'relative', zIndex: 2 }} />
        <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 2 }}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white', fontWeight: 'bold' }}>{selectedTrack.name}</div>
          <div style={{ fontSize: '0.8rem', color: '#1db954' }}>{t('spotify.nowPlaying')}</div>
        </div>
        <button
          disabled={!spotifyPlayer}
          style={{
            width: '50px',
            height: '50px',
            borderRadius: '50%',
            padding: 0,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            background: spotifyPlayer ? '#1db954' : 'gray',
            color: 'black',
            border: 'none',
            cursor: spotifyPlayer ? 'pointer' : 'not-allowed',
            boxShadow: isPlaying ? '0 0 15px #1db954' : 'none',
            transition: 'all 0.2s ease-in-out',
            opacity: spotifyPlayer ? 1 : 0.5,
            flexShrink: 0
          }}
          onClick={async () => {
            if (spotifyPlayer) {
              if (isPlaying) {
                spotifyPlayer.pause();
              } else {
                const state = await spotifyPlayer.getCurrentState();
                if (state && state.track_window.current_track.uri === selectedTrack.uri) {
                  spotifyPlayer.resume();
                } else {
                  playTrack(selectedTrack.uri, spotifyPlayerId).catch(console.error);
                }
              }
            }
          }}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" /></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="cyber-card" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginBottom: '20px', marginTop: '20px' }}>
        <h2 style={{ color: 'var(--neon-purple)', margin: 0 }}>{t('gm.title')}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '10px' }}>
          <div style={{ background: 'rgba(0,240,255,0.1)', padding: '5px 10px', borderRadius: '5px', border: '1px solid var(--neon-blue)' }}>
            <span style={{ color: 'var(--text-muted)' }}>{t('gm.ballroomCode')}</span>{' '}
            <strong style={{ color: 'var(--neon-blue)', fontSize: '1.2rem', letterSpacing: '2px' }}>{room.id}</strong>
          </div>

          {privacyMode && (
            <div className="badge badge--red" title={t('gm.privacyModeTitle')}>
              <EyeOff size={14} className="icon-inline" /> {t('gm.privacyMode')}
            </div>
          )}

          {/* 3-Dot Menu Container */}
          <div style={{ position: 'relative', zIndex: 100 }} ref={menuRef}>
            <div style={{ display: 'flex', gap: '10px' }}>
              {selectedTrack && room.status !== 'dancing' && (
                <button
                  className="kebab-menu-btn pulse-animation"
                  onClick={() => setShowSpotifyModal(true)}
                  title={t('gm.changeTrackTitle')}
                  style={{ color: 'var(--neon-green)' }}
                >
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.84.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.54-1.02.72-1.559.42z" />
                  </svg>
                </button>
              )}
              {room.status !== 'lobby' && (
                <button
                  className="kebab-menu-btn"
                  onClick={() => setShowCouplesModal(true)}
                  title={t('gm.viewCouplesTitle')}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <img src={coupleIcon} alt={t('gm.couplesAlt')} style={{ width: '24px', height: '24px' }} />
                </button>
              )}
              <button
                className="kebab-menu-btn"
                onClick={() => setShowChatModal(true)}
                title={t('gm.chatTitle')}
                style={{ position: 'relative' }}
              >
                <MessageCircle size={20} />
                {unreadChatCount > 0 && (
                  <span className="count-badge">
                    {unreadChatCount}
                  </span>
                )}
              </button>
              <button
                className="kebab-menu-btn"
                onClick={() => setShowMenu(!showMenu)}
                title={t('gm.menuTitle')}
              >
                <div className="kebab-dot"></div>
                <div className="kebab-dot"></div>
                <div className="kebab-dot"></div>
              </button>
            </div>
            {showMenu && (
              <div className="dropdown-menu">
                <button className="dropdown-item" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => { setShowTeamModal(true); setShowMenu(false); }}>
                  <Crown size={16} className="icon-inline" /> {t('gm.manageTeam')}
                </button>
                <button className="dropdown-item" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => { setPrivacyMode(!privacyMode); setShowMenu(false); }}>
                  {privacyMode ? <Eye size={16} className="icon-inline" /> : <EyeOff size={16} className="icon-inline" />}
                  {privacyMode ? t('gm.privacyOff') : t('gm.privacyOn')}
                </button>
                {room.status !== 'lobby' && (
                  <button className="dropdown-item danger" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => { setShowMenu(false); handleEndGame(); }}>
                    <Flag size={16} className="icon-inline" /> {t('gm.endGameNow')}
                  </button>
                )}
                <button className="dropdown-item danger" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => {
                  setShowMenu(false);
                  setConfirmState({
                    message: t('gm.closeBallroomConfirm'), onConfirm: () => {
                      localStorage.removeItem('deathstep_selected_track');
                      if (spotifyPlayer) {
                        spotifyPlayer.pause().catch(e => console.error("Failed to pause on exit", e));
                      }
                      setPrivacyMode(false);
                      onLeave();
                    }
                  });
                }}>
                  <LogOut size={16} className="icon-inline" /> {t('gm.closeBallroom')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="panel" style={{ display: 'flex', flexWrap: 'wrap', gap: '10px 20px' }}>
        <p>{t('gm.status')} <strong style={{ textTransform: 'uppercase', color: (room.status === 'dancing' || room.status === 'role_reveal') ? 'var(--neon-blue)' : 'var(--neon-purple)' }}>{t(`phase.${room.status}`)}</strong></p>
        {room.round > 0 && <p>{t('gm.round')} <strong>{room.round}</strong></p>}
      </div>

      {/* PENDING REJOIN REQUESTS */}
      {room.pendingRejoinRequests?.length > 0 && (
        <div className="panel panel--danger">
          <div className="panel-title" style={{ color: 'var(--neon-red)' }}>
            <AlertTriangle size={16} className="icon-inline" /> {t('gm.rejoinRequested')}
          </div>
          {room.pendingRejoinRequests.map(req => (
            <div key={req.id} className="list-item" style={{ marginBottom: '10px' }}>
              <span style={{ color: 'white' }}><strong>{maskName(req.playerName)}</strong> {t('gm.wantsToRejoin')}</span>
              <div className="btn-row" style={{ flexShrink: 0 }}>
                <button className="cyber-button" style={{ padding: '5px 15px' }} onClick={() => handleRejoinResponse(req.id, true)}>{t('gm.accept')}</button>
                <button className="cyber-button" style={{ padding: '5px 15px', background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }} onClick={() => handleRejoinResponse(req.id, false)}>{t('gm.deny')}</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* LOBBY PHASE */}
      {room.status === 'lobby' && (
        <div className="phase-enter" style={{ marginBottom: '20px' }}>
          <div className="segmented-control" style={{ marginBottom: '20px' }}>
            {spotifyAllowed ? (
              <>
                <button className={`segmented-option accent-purple ${!useSpotify ? 'is-active' : ''}`} onClick={() => setUseSpotify(false)}>
                  {t('gm.useOwnAudio')}
                </button>
                <button className={`segmented-option accent-green ${useSpotify ? 'is-active' : ''}`} onClick={() => setUseSpotify(true)}>
                  {t('gm.useSpotify')}
                </button>
              </>
            ) : (
              <button className="segmented-option accent-purple is-active" style={{ cursor: 'default' }}>
                {t('gm.useOwnAudio')}
              </button>
            )}
          </div>

          {renderSpotifyControls(true)}

          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div className="qr-frame">
              <img
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(window.location.origin + '/?room=' + room.id)}`}
                alt="QR Code"
                style={{ display: 'block' }}
              />
            </div>
          </div>

          <h3 style={{ color: 'var(--neon-blue)', marginBottom: '10px' }}>{t('gm.players')} ({room.players.length})</h3>

          <div className="panel">
            <p style={{ color: 'var(--text-muted)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <PhoneOff size={16} className="icon-inline" />
              <span><strong style={{ color: 'var(--text-main)' }}>{t('gm.addPhonelessTitle')}</strong> {t('gm.addPhonelessHint')}</span>
            </p>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <input
                type="text"
                className="cyber-input"
                placeholder={t('gm.namePlaceholder')}
                value={manualPlayerName}
                onChange={(e) => setManualPlayerName(e.target.value)}
                style={{ flex: '1 1 150px', margin: 0 }}
              />
              <select
                className="cyber-select"
                value={manualDanceRole}
                onChange={(e) => setManualDanceRole(e.target.value)}
              >
                <option value="lead">{t('common.lead')}</option>
                <option value="follow">{t('common.follow')}</option>
              </select>
              <label className="check-row" style={{ fontSize: '0.9rem', whiteSpace: 'nowrap' }}>
                <input type="checkbox" checked={manualIsFlexible} onChange={(e) => setManualIsFlexible(e.target.checked)} />
                <span style={{ color: 'white' }}>{t('gm.flexible')}</span>
              </label>
              <button className="cyber-button" onClick={handleAddManualPlayer} disabled={!manualPlayerName.trim()} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserPlus size={16} className="icon-inline" /> {t('gm.add')}
              </button>
            </div>
          </div>

          <div className="btn-row" style={{ marginBottom: '20px' }}>
            <button className="cyber-button pulse-animation" onClick={handleRandomPairsClick} style={{ flex: 1 }}>
              {t('gm.randomPairs')}
            </button>
            <button className="cyber-button" onClick={handleClearPairs} style={{ flex: 1 }}>
              {t('gm.clearPairs')}
            </button>
          </div>

          {/* RANDOMIZER FLOW MODAL */}
          {randomizerFlow && createPortal(
            <div className="modal-overlay">
              <div className="modal-card cyber-card" style={{ maxWidth: '600px', border: '1px solid var(--neon-blue)' }}>
                <h3 style={{ color: 'var(--neon-blue)', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <AlertTriangle size={20} className="icon-inline" /> {t('gm.rolesUnbalanced')}
                </h3>

                {randomizerFlow.step === 'mixed_selection' && (() => {
                  const actions = randomizerFlow.playerActions || {};
                  const selectedSwitchCount = Object.keys(actions).filter(id => actions[id] === 'switch').length;
                  const selectedSpectatorCount = Object.keys(actions).filter(id => actions[id] === 'spectator').length;

                  const effectiveExcess = randomizerFlow.excessCount - (2 * selectedSwitchCount) - selectedSpectatorCount;
                  const effectiveBase = randomizerFlow.baseCouplesCount + selectedSwitchCount;

                  const currentMinSwitchNeeded = Math.max(0, Math.ceil((effectiveExcess - effectiveBase) / 3));
                  const originalMinSwitchNeeded = Math.max(0, Math.ceil((randomizerFlow.excessCount - randomizerFlow.baseCouplesCount) / 3));

                  const isSelectionValid = currentMinSwitchNeeded === 0;

                  const excessRoleName = randomizerFlow.excessType === 'lead' ? t('gm.leads') : t('gm.follows');
                  const missingRoleName = randomizerFlow.excessType === 'lead' ? t('gm.follows') : t('gm.leads');

                  const renderSkipAllowedText = () => {
                    if (randomizerFlow.excessCount === 1) {
                      return (
                        <p style={{ margin: 0, color: 'white' }}>
                          {t('gm.rand1Excess', { role: excessRoleName })}
                        </p>
                      );
                    } else if (randomizerFlow.excessCount % 2 === 0) {
                      return (
                        <p style={{ margin: 0, color: 'white' }}>
                          {t('gm.randEvenExcess', { count: randomizerFlow.excessCount, role: excessRoleName, half: randomizerFlow.excessCount / 2 })}<br />
                          <span style={{ color: 'var(--neon-blue)', fontSize: '0.9rem', marginTop: '10px', display: 'block' }}>{t('gm.randEvenExcessAlt')}</span>
                        </p>
                      );
                    } else {
                      return (
                        <div style={{ margin: 0, color: 'white' }}>
                          {t('gm.randOddExcess', { count: randomizerFlow.excessCount, role: excessRoleName })}<br />
                          <span style={{ color: 'var(--neon-blue)', fontSize: '0.9rem', marginTop: '10px', display: 'block' }}>{t('gm.randOptions')}</span>
                          <ul style={{ margin: '5px 0 0 20px', padding: 0, color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                            <li><strong>{t('gm.randOptAssignLabel')}</strong> {t('gm.randOptAssignText', { count: randomizerFlow.excessCount })}</li>
                            <li><strong>{t('gm.randOptMixLabel')}</strong> {t('gm.randOptMixText')}</li>
                            <li><strong>{t('gm.randOptSpectateLabel')}</strong> {t('gm.randOptSpectateText')}</li>
                          </ul>
                        </div>
                      );
                    }
                  };

                  return (
                    <div>
                      {originalMinSwitchNeeded > 0 ? (
                        <div className="panel panel--danger">
                          <p style={{ margin: 0, color: 'white', fontSize: '1.1rem' }}>
                            <strong>{t('gm.randTooManyStrong', { count: randomizerFlow.excessCount, role: excessRoleName })}</strong> {t('gm.randTooManyRest')}
                          </p>
                          <p style={{ margin: '15px 0 10px 0', color: 'white' }}>
                            {t('gm.randMustBalance')}
                          </p>
                          <ul style={{ margin: '0 0 15px 20px', padding: 0, color: 'var(--text-muted)' }}>
                            <li style={{ marginBottom: '5px' }}><strong style={{ color: 'var(--neon-blue)' }}>{t('gm.randSwitchOptionLabel')}</strong> {t('gm.randSwitchOptionText')}</li>
                            <li><strong style={{ color: 'var(--neon-purple)' }}>{t('gm.randSpectateOptionLabel')}</strong> {t('gm.randSpectateOptionText')}</li>
                          </ul>
                          <p style={{ margin: 0, color: 'var(--neon-red)', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <ChevronRight size={16} className="icon-inline" /> {t('gm.randChooseBelow')}
                          </p>
                          <div style={{ marginTop: '15px', padding: '10px', background: 'rgba(255,255,255,0.1)', borderRadius: '5px', fontSize: '0.9rem', color: 'var(--text-muted)', display: 'flex', gap: '8px' }}>
                            <Lightbulb size={16} className="icon-inline" style={{ flexShrink: 0, marginTop: '2px' }} />
                            <span><strong>{t('gm.randProTipLabel')}</strong> {t(randomizerFlow.excessCount % 2 !== 0 ? 'gm.randProTipOdd' : 'gm.randProTipEven', { count: Math.floor(randomizerFlow.excessCount / 2) })}</span>
                          </div>
                        </div>
                      ) : (
                        <div className="panel panel--info">
                          {renderSkipAllowedText()}
                        </div>
                      )}

                      <div className="couple-list" style={{ marginBottom: '15px' }}>
                        {(randomizerFlow.excessType === 'lead' ? randomizerFlow.leads : randomizerFlow.follows).map(p => {
                          const currentAction = actions[p.id] || 'none';
                          return (
                            <div key={p.id} className={`list-item ${currentAction !== 'none' ? 'list-item--active' : ''}`}>
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, fontWeight: currentAction !== 'none' ? 'bold' : 'normal' }}>
                                {maskName(p.name)}
                              </span>
                              <select
                                className="cyber-select"
                                value={currentAction}
                                onChange={(e) => handlePlayerActionChange(p.id, e.target.value)}
                              >
                                <option value="none">{t('gm.randAction3rd')}</option>
                                <option value="switch">{t('gm.randActionSwitch', { role: missingRoleName })}</option>
                                <option value="spectator">{t('gm.randActionSpectate')}</option>
                              </select>
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
                        <button
                          className={isSelectionValid ? "cyber-button pulse-animation" : "cyber-button disabled"}
                          onClick={() => executeMixedSelection()}
                          style={{
                            width: '100%',
                            opacity: isSelectionValid ? 1 : 0.5,
                            cursor: isSelectionValid ? 'pointer' : 'not-allowed',
                            ...(isSelectionValid ? { background: 'rgba(29, 185, 84, 0.2)', border: '1px solid var(--neon-green)', color: 'var(--neon-green)' } : { border: '1px solid var(--text-muted)' })
                          }}
                          disabled={!isSelectionValid}
                        >
                          {t('gm.randConfirm')}
                        </button>
                        <button className="cyber-button danger" onClick={() => setRandomizerFlow(null)} style={{ width: '100%' }}>{t('common.cancel')}</button>
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>,
            document.body
          )}

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginBottom: '20px' }}>
            <div style={{ flex: '1 1 260px', minWidth: 0, opacity: randomizerFlow ? 0.3 : 1, pointerEvents: randomizerFlow ? 'none' : 'auto' }}>
              <h4 style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>{t('gm.unpaired')}</h4>
              <div className="couple-list">
                {getUnpairedPlayers().map(p => (
                  <div key={p.id} className={`list-item ${currentGroup.includes(p.id) ? 'list-item--purple' : ''}`} style={{ flexWrap: 'wrap' }}>
                    <div
                      onClick={() => handleToggleCurrentGroup(p)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '10px', flex: '1 1 140px',
                        cursor: 'pointer', overflow: 'hidden', minHeight: '32px'
                      }}
                    >
                      <div style={{
                        width: '22px', height: '22px', borderRadius: '4px',
                        border: currentGroup.includes(p.id) ? '2px solid var(--neon-purple)' : '2px solid var(--text-muted)',
                        background: currentGroup.includes(p.id) ? 'var(--neon-purple)' : 'transparent',
                        display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0
                      }}>
                        {currentGroup.includes(p.id) && <Check size={14} strokeWidth={3} style={{ color: 'black' }} />}
                      </div>
                      <span style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        color: currentGroup.includes(p.id) ? 'white' : 'var(--text-muted)'
                      }}>
                        {maskName(p.name)}
                        {p.isFlexible && <Repeat size={14} className="icon-inline" title={t('gm.flexibleRoleTitle')} />}
                        {p.hasNoPhone && <PhoneOff size={14} className="icon-inline" title={t('gm.noPhoneTitle')} />}
                      </span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0, marginLeft: 'auto' }}>
                      <select
                        className="cyber-select"
                        value={p.danceRole}
                        onChange={(e) => handleChangeRole(p.id, e.target.value)}
                        style={{ color: 'var(--neon-blue)', padding: '8px', minHeight: '40px', fontSize: '0.95rem' }}
                      >
                        <option value="lead">{t('common.lead')}</option>
                        <option value="follow">{t('common.follow')}</option>
                        <option value="spectator">{t('common.spectator')}</option>
                      </select>
                      <button
                        onClick={() => handleKickPlayer(p.id)}
                        className="icon-btn danger"
                        title={t('gm.kickPlayerTitle')}
                      >
                        <X size={18} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {currentGroup.length > 0 && (() => {
                const selectedPlayers = currentGroup.map(id => room.players.find(p => p.id === id)).filter(Boolean);
                const hasLead = selectedPlayers.some(p => p.danceRole === 'lead');
                const hasFollow = selectedPlayers.some(p => p.danceRole === 'follow');
                const isTooLarge = currentGroup.length > 3;
                const isInvalidRoleCombo = currentGroup.length > 1 && (!hasLead || !hasFollow);
                const isDisabled = isTooLarge || isInvalidRoleCombo || currentGroup.length < 2;

                let buttonText = t('gm.createGroup', { count: currentGroup.length });
                if (isTooLarge) buttonText = t('gm.max3');
                else if (isInvalidRoleCombo) buttonText = t('gm.mixLeadFollow');

                return (
                  <button
                    className={isDisabled ? "cyber-button disabled" : "cyber-button"}
                    style={{
                      marginTop: '10px',
                      width: '100%',
                      borderColor: isDisabled ? 'var(--text-muted)' : 'var(--neon-purple)',
                      opacity: isDisabled ? 0.5 : 1,
                      cursor: isDisabled ? 'not-allowed' : 'pointer'
                    }}
                    onClick={handleCreateManualCouple}
                    disabled={isDisabled}
                  >
                    {buttonText}
                  </button>
                );
              })()}
            </div>

            <div style={{ flex: '1 1 260px', minWidth: 0, opacity: randomizerFlow ? 0.3 : 1, pointerEvents: randomizerFlow ? 'none' : 'auto' }}>
              <h4 style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>{t('gm.pendingCouples')}</h4>
              <div className="couple-list">
                {pendingCouples.map((c, i) => {
                  const members = c.playerIds.map(id => room.players.find(p => p.id === id)).filter(Boolean);
                  const allNoPhone = members.length > 0 && members.every(p => p.hasNoPhone);
                  return (
                    <div key={i} className={`list-item ${allNoPhone ? 'list-item--danger' : 'list-item--active'}`}>
                      <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', minWidth: 0, flex: 1, gap: '5px' }}>
                        {members.map((p, idx) => (
                          <React.Fragment key={p.id}>
                            {idx > 0 && <span style={{ opacity: 0.5, flexShrink: 0 }}>&amp;</span>}
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
                              {maskName(p.name)} {p.hasNoPhone && <PhoneOff size={13} className="icon-inline" title={t('gm.noPhoneTitle')} />}
                            </span>
                          </React.Fragment>
                        ))}
                        {allNoPhone && (
                          <span style={{ color: 'var(--neon-red)', fontSize: '0.8rem', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <AlertTriangle size={13} className="icon-inline" /> {t('gm.noPhoneInCouple')}
                          </span>
                        )}
                      </div>
                      <button
                        onClick={() => handleDissolvePendingCouple(i)}
                        className="icon-btn"
                        title={t('gm.dissolveCoupleTitle')}
                      >
                        <Scissors size={18} />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="panel">
            <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
              <span style={{ color: 'var(--text-muted)' }}>{t('gm.votingRight')}</span>
              <select className="cyber-select" value={room.votingRole} onChange={handleSetVotingRole}>
                <option value="lead">{t('gm.leadsOnly')}</option>
                <option value="follow">{t('gm.followsOnly')}</option>
              </select>
            </label>
          </div>

          <button className="cyber-button pulse-animation" onClick={handleReleasePairs} disabled={pendingCouples.length === 0 || randomizerFlow} style={{ width: '100%' }}>
            {t('gm.releasePairs')}
          </button>
        </div>
      )}

      {/* PAIRED PHASE */}
      {room.status === 'paired' && (() => {
        const pairedPlayers = room.players.filter(p => room.couples.some(c => c.playerIds.includes(p.id)));
        const allConfirmed = pairedPlayers.length > 0 && pairedPlayers.every(p => p.isConfirmed);
        const canStart = allConfirmed || bypassPaired;

        return (
          <div className="phase-enter" style={{ marginBottom: '20px' }}>
            {renderSpotifyControls()}

            <h3 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>{t('gm.waitingConfirmations')}</h3>
            <div className="couple-list" style={{ marginBottom: '20px' }}>
              {pairedPlayers.map(p => {
                const couple = room.couples.find(c => c.playerIds.includes(p.id));
                const needsGmConfirm = !p.isConfirmed && p.hasNoPhone && couple && isCoupleFullyPhoneless(couple);
                return (
                  <div key={p.id} className={`list-item ${p.isConfirmed ? 'list-item--active' : 'list-item--danger'}`}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      {maskName(p.name)}
                      {p.isFlexible && <Repeat size={14} className="icon-inline" title={t('gm.flexibleRoleTitle')} />}
                      {p.hasNoPhone
                        ? <PhoneOff size={14} className="icon-inline" title={t('gm.noPhoneTitle')} style={{ color: 'var(--text-muted)' }} />
                        : <Smartphone size={14} className="icon-inline" title={t('gm.hasPhoneTitle')} style={{ color: 'var(--neon-blue)' }} />}
                      ({p.danceRole})
                    </span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                      {needsGmConfirm && (
                        <button
                          className="cyber-button"
                          style={{ width: 'auto', padding: '4px 10px', fontSize: '0.8rem', margin: 0 }}
                          onClick={() => handleGmConfirmCouple(couple.id)}
                        >
                          {t('gm.markReadyGm')}
                        </button>
                      )}
                      <span className={`badge ${p.isConfirmed ? 'badge--blue' : 'badge--red'}`}>{p.isConfirmed ? t('common.ready') : t('common.waiting')}</span>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="panel panel--purple">
              <h4 style={{ color: 'var(--neon-purple)', marginBottom: '15px' }}>{t('gm.gameSettings')}</h4>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                <label style={{ color: 'white', fontWeight: 'bold' }}>{t('gm.killerCount')}</label>
                <div className="stepper">
                  <button className="stepper-btn" onClick={() => setKillerCount(Math.max(1, killerCount - 1))}><Minus size={18} /></button>
                  <span className="stepper-value">{killerCount}</span>
                  <button className="stepper-btn" onClick={() => setKillerCount(Math.min(Math.max(1, room.couples.length - 1), killerCount + 1))}><Plus size={18} /></button>
                </div>
              </div>
              {room.couples.length >= 9 && killerCount < 2 && (
                <p style={{ color: 'var(--neon-blue)', fontSize: '0.9rem', margin: '10px 0 0 0', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}><Lightbulb size={14} className="icon-inline" /> {t('gm.killerRecMore', { count: room.couples.length })}</p>
              )}
              {room.couples.length < 9 && killerCount > 1 && (
                <p style={{ color: 'var(--neon-blue)', fontSize: '0.9rem', margin: '10px 0 0 0', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}><Lightbulb size={14} className="icon-inline" /> {t('gm.killerRecOne', { count: room.couples.length })}</p>
              )}
              <div style={{ marginTop: '15px' }}>
                <label style={{ color: 'white', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>{t('gm.killMode')}</label>
                <select className="cyber-select" value={killMode} onChange={(e) => setKillMode(e.target.value)} style={{ width: '100%' }}>
                  <option value="classic">{t('gm.killModeClassic')}</option>
                  <option value="silent">{t('gm.killModeSilent')}</option>
                </select>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '8px 0 0 0', fontStyle: 'italic' }}>
                  {killMode === 'silent' ? t('gm.killModeSilentDesc') : t('gm.killModeClassicDesc')}
                </p>
              </div>
            </div>

            <button
              className={canStart ? "cyber-button pulse-animation" : "cyber-button disabled"}
              onClick={handleStartGame}
              disabled={!canStart}
              style={{ width: '100%', opacity: canStart ? 1 : 0.5, cursor: canStart ? 'pointer' : 'not-allowed' }}
            >
              {t('gm.revealRoles')}
            </button>

            {!allConfirmed && !bypassPaired && (
              <div style={{ textAlign: 'center' }}>
                <button
                  onClick={() => setBypassPaired(true)}
                  style={{ marginTop: '15px', background: 'transparent', border: 'none', color: 'var(--neon-red)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  {t('gm.bypassReveal')}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ROLE REVEAL PHASE */}
      {room.status === 'role_reveal' && (() => {
        const aliveCouples = room.couples.filter(c => c.status === 'alive');
        // Check if at least one player per couple has viewed their role
        const allCouplesViewedRole = aliveCouples.length > 0 && aliveCouples.every(c =>
          c.playerIds.some(id => {
            const player = room.players.find(p => p.id === id);
            return player && player.hasViewedRole;
          })
        );
        const isSpotifyReady = !useSpotify || (selectedTrack && spotifyPlayer);
        const canProceedSong = isSpotifyReady || bypassSongReady;
        const canStart = (allCouplesViewedRole || bypassRoleView) && canProceedSong;

        return (
          <div className="phase-enter" style={{ marginBottom: '20px' }}>
            {renderSpotifyControls()}

            <div style={{ textAlign: 'center' }}>
              <h3 style={{ color: 'var(--neon-blue)', marginBottom: '15px' }}>{t('gm.rolesRevealed')}</h3>

              {!isSpotifyReady && (
                <div className="panel panel--danger">
                  <strong style={{ color: 'var(--neon-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><AlertTriangle size={16} className="icon-inline" /> {t('gm.musicNotReady')}</strong><br />
                  <span style={{ color: 'white' }}>
                    {!selectedTrack ? t('gm.selectSongFirst') : t('gm.playerInitializing')}
                  </span>
                  {!bypassSongReady && (
                    <div>
                      <button
                        onClick={() => setBypassSongReady(true)}
                        style={{ marginTop: '10px', background: 'transparent', border: 'none', color: 'var(--neon-red)', textDecoration: 'underline', cursor: 'pointer' }}
                      >
                        {t('gm.bypassSongReady')}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {(!allCouplesViewedRole && !bypassRoleView) && (
                <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
                  {t('gm.waitingRoleViews')}
                </p>
              )}

              {(allCouplesViewedRole || bypassRoleView) && canProceedSong && (
                <p style={{ color: '#00ff66', marginBottom: '20px' }}>
                  {t('gm.allChecksPassed')}
                </p>
              )}

              <div className="couple-list" style={{ marginBottom: '20px', textAlign: 'left' }}>
                {aliveCouples.map(couple => {
                  const hasViewed = couple.playerIds.some(id => {
                    const player = room.players.find(p => p.id === id);
                    return player && player.hasViewedRole;
                  });
                  const needsGmConfirm = !hasViewed && isCoupleFullyPhoneless(couple);
                  return (
                    <div key={couple.id} className={`list-item ${hasViewed ? 'list-item--active' : 'list-item--danger'}`}>
                      <div style={{ flex: 1, minWidth: 0, marginRight: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                        {couple.role === 'killer' && (
                          <Skull size={15} className="icon-inline" title="Killer" style={{ color: 'var(--neon-red)', flexShrink: 0 }} />
                        )}
                        {renderMembersWithPhoneIcons(couple)}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
                        {needsGmConfirm && (
                          <button
                            className="cyber-button"
                            style={{ width: 'auto', padding: '4px 10px', fontSize: '0.8rem', margin: 0 }}
                            onClick={() => handleGmMarkCoupleRoleViewed(couple.id)}
                          >
                            Als bereit markieren (GM)
                          </button>
                        )}
                        <span className={`badge ${hasViewed ? 'badge--blue' : 'badge--red'}`}>
                          {hasViewed ? t('common.ready') : t('common.waiting')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              <button
                className={canStart ? "cyber-button pulse-animation" : "cyber-button disabled"}
                onClick={handleStartDancing}
                disabled={!canStart}
                style={{ width: '100%', fontSize: '1.2rem', padding: '15px', opacity: canStart ? 1 : 0.5, cursor: canStart ? 'pointer' : 'not-allowed' }}
              >
                {useSpotify
                  ? t('gm.startMusicDancing')
                  : t('gm.startDancing', { round: room.round })
                }
              </button>

              {!allCouplesViewedRole && !bypassRoleView && (
                <button
                  onClick={() => setBypassRoleView(true)}
                  style={{ marginTop: '15px', background: 'transparent', border: 'none', color: 'var(--neon-red)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  {t('gm.bypassStart')}
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* DANCING PHASE */}
      {room.status === 'dancing' && (() => {
        const aliveCouplesToKill = aliveCouples.filter(c => c.role !== 'killer');
        const aliveKillerCouples = aliveCouples.filter(c => c.role === 'killer');
        const aliveKillerCount = aliveKillerCouples.length;
        const markedCount = room.pendingVictimIds?.length || 0;
        const limitReached = markedCount >= aliveKillerCount;
        return (
          <div className="phase-enter" style={{ marginBottom: '20px' }}>
            <div className="panel panel--info" style={{ animation: 'pulse 2s infinite' }}>
              <h3 style={{ color: 'var(--neon-blue)', textAlign: 'center', margin: 0, letterSpacing: '2px', marginBottom: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <Music2 size={20} className="icon-inline" /> {t('gm.dancingInProgress')} <Music2 size={20} className="icon-inline" />
              </h3>

              {useSpotify && selectedTrack && (
                <div style={{ marginBottom: '15px' }}>
                  {!hasSongFinished ? (
                    <div className="list-item panel--success" style={{ borderColor: 'var(--neon-green)', background: 'rgba(29,185,84,0.2)' }}>
                      <img src={selectedTrack.album.images[2]?.url} alt="" style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--neon-green)', textTransform: 'uppercase', fontWeight: 'bold' }}>{t('gm.currentSong')}</div>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{selectedTrack.name}</div>
                      </div>
                      <button
                        disabled={!spotifyPlayer}
                        style={{
                          width: '40px', height: '40px', borderRadius: '50%', padding: 0,
                          display: 'flex', justifyContent: 'center', alignItems: 'center',
                          background: spotifyPlayer ? 'var(--neon-green)' : 'gray', color: 'black', border: 'none',
                          cursor: spotifyPlayer ? 'pointer' : 'not-allowed', flexShrink: 0
                        }}
                        onClick={async () => {
                          if (spotifyPlayer) {
                            if (isPlaying) {
                              spotifyPlayer.pause();
                            } else {
                              const state = await spotifyPlayer.getCurrentState();
                              if (state && state.track_window.current_track.uri === selectedTrack.uri) {
                                spotifyPlayer.resume();
                              } else {
                                playTrack(selectedTrack.uri, spotifyPlayerId).catch(console.error);
                              }
                            }
                          }
                        }}
                      >
                        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                      </button>
                    </div>
                  ) : (
                    <div className="panel panel--danger" style={{ textAlign: 'center', color: 'var(--neon-red)', fontWeight: 'bold', marginBottom: 0 }}>
                      {t('gm.songOver')}
                    </div>
                  )}
                </div>
              )}

              <p style={{ textAlign: 'center', color: 'white', margin: 0 }}>{t('gm.everyoneDancing')}</p>
            </div>

            {room.killMode === 'silent' ? (
              <div className="panel panel--purple">
                <h4 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>{t('gm.silentReportReadyTitle')}</h4>
                <p style={{ color: 'var(--text-muted)', marginBottom: '15px' }}>
                  {t('gm.silentReportReadyBody')}
                </p>
                <button
                  className="cyber-button pulse-animation"
                  style={{ width: '100%', padding: '15px', fontSize: '1.2rem', borderColor: 'var(--neon-purple)' }}
                  onClick={() => socket.emit('proceedToSilentReport', { roomId: room.id })}
                >
                  {t('gm.proceedToSilentReportBtn')}
                </button>
              </div>
            ) : (
              <div className="panel panel--purple">
                <h4 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>{t('gm.observeTitle')}</h4>
                <p style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>
                  {t('gm.observeBody')}
                </p>
                <p style={{ color: 'var(--text-muted)', marginBottom: '5px' }}>
                  <strong>{t('gm.markKilled')}</strong> <span style={{ color: 'var(--neon-purple)' }}>{t('gm.markedCount', { marked: markedCount, total: aliveKillerCount })}</span>
                </p>

                <div className="couple-list" style={{ marginBottom: '20px' }}>
                  {aliveCouplesToKill.map(couple => {
                    const isMarked = room.pendingVictimIds?.includes(couple.id);
                    const disabled = !isMarked && limitReached;
                    return (
                      <button
                        key={couple.id}
                        className={`kill-option-btn ${isMarked ? 'selected' : ''}`}
                        onClick={() => handleReportKill(couple.id)}
                        disabled={disabled}
                        style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                      >
                        <span style={{ flexShrink: 0, minWidth: '100px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {isMarked ? <><Check size={14} className="icon-inline" /> {t('gm.marked')}</> : <><Skull size={14} className="icon-inline" /> {t('gm.kill')}</>}
                        </span>
                        {renderTruncatedNames(couple.name)}
                      </button>
                    );
                  })}
                </div>
                {limitReached && aliveKillerCount > 0 && (
                  <p style={{ color: 'var(--neon-red)', fontSize: '0.85rem', margin: '-10px 0 15px 0', fontStyle: 'italic' }}>
                    {t('gm.killLimitReached', { count: aliveKillerCount })}
                  </p>
                )}
                <button
                  className={`nobody-option-btn ${!room.pendingVictimIds?.length ? 'selected' : ''}`}
                  onClick={() => handleReportKill(null)}
                  style={{ marginBottom: '20px' }}
                >
                  {!room.pendingVictimIds?.length ? <><Check size={16} className="icon-inline" /> {t('gm.markedNobody')}</> : t('gm.nobodyKilled')}
                </button>

                <button
                  className="cyber-button pulse-animation"
                  style={{ width: '100%', padding: '15px', fontSize: '1.2rem', borderColor: 'var(--neon-purple)' }}
                  onClick={handleRevealKill}
                >
                  {t('gm.revealKillBtn')}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* SILENT REPORT PHASE */}
      {room.status === 'silent_report' && (() => {
        const aliveCouplesToKill = aliveCouples.filter(c => c.role !== 'killer');
        const aliveKillerCouples = aliveCouples.filter(c => c.role === 'killer');
        const aliveKillerCount = aliveKillerCouples.length;
        const markedCount = room.pendingVictimIds?.length || 0;
        const limitReached = markedCount >= aliveKillerCount;
        return (
          <div className="phase-enter" style={{ marginBottom: '20px' }}>
            {renderSpotifyControls()}

            {!room.silentReportsResolved ? (
              <div className="panel panel--purple">
                <h4 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>{t('gm.silentReportTitle')}</h4>
                <p style={{ color: 'var(--text-muted)', marginBottom: '15px' }}>
                  {t('gm.silentReportBody')}
                </p>

                <p style={{ color: 'var(--text-muted)', marginBottom: '5px', fontWeight: 'bold' }}>{t('gm.silentReportKillerClaims')}</p>
                <div className="couple-list" style={{ marginBottom: '15px' }}>
                  {aliveKillerCouples.map(couple => {
                    const hasSubmitted = Object.prototype.hasOwnProperty.call(room.killClaims || {}, couple.id);
                    const claimId = room.killClaims?.[couple.id];
                    const claimedVictim = claimId ? room.couples.find(c => c.id === claimId) : null;
                    const needsGmSubmit = !hasSubmitted && isCoupleFullyPhoneless(couple);
                    const selectedVictim = gmKillClaimSelections[couple.id] ?? '';
                    return (
                      <div key={couple.id} className="panel panel--purple" style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: 0, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 0 }}>
                          {renderTruncatedNames(couple.name)}
                          <span className={`badge ${hasSubmitted ? 'badge--blue' : 'badge--muted'}`}>
                            {hasSubmitted ? (claimedVictim ? maskName(claimedVictim.name) : t('gm.silentReportNobody')) : t('gm.waitingBadge')}
                          </span>
                        </div>
                        {needsGmSubmit && (
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <select
                              className="cyber-select"
                              style={{ flex: '1 1 150px' }}
                              value={selectedVictim}
                              onChange={(e) => setGmKillClaimSelections({ ...gmKillClaimSelections, [couple.id]: e.target.value })}
                            >
                              <option value="">{t('gm.chooseVictim')}</option>
                              {aliveCouplesToKill.map(v => (
                                <option key={v.id} value={v.id}>{maskName(v.name)}</option>
                              ))}
                            </select>
                            <button
                              className="cyber-button"
                              style={{ width: 'auto', padding: '8px 12px', fontSize: '0.85rem', margin: 0, flex: '0 0 auto' }}
                              disabled={!selectedVictim}
                              onClick={() => handleSubmitKillClaimForCouple(couple.id)}
                            >
                              {t('gm.silentReportSubmit')}
                            </button>
                            <button
                              className="cyber-button"
                              style={{ width: 'auto', padding: '8px 12px', fontSize: '0.85rem', margin: 0, background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)', flex: '0 0 auto' }}
                              onClick={() => { setGmKillClaimSelections({ ...gmKillClaimSelections, [couple.id]: '' }); socket.emit('gmSubmitKillClaim', { roomId: room.id, killerCoupleId: couple.id, victimId: null }); }}
                            >
                              {t('gm.silentReportNobody')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <p style={{ color: 'var(--text-muted)', marginBottom: '5px', fontWeight: 'bold' }}>{t('gm.silentReportVictimReports')}</p>
                <div className="couple-list" style={{ marginBottom: '20px' }}>
                  {aliveCouplesToKill.map(couple => {
                    const hasSubmitted = Object.prototype.hasOwnProperty.call(room.victimReports || {}, couple.id);
                    const report = room.victimReports?.[couple.id];
                    const suspect = report?.suspectCoupleId ? room.couples.find(c => c.id === report.suspectCoupleId) : null;
                    const needsGmSubmit = !hasSubmitted && isCoupleFullyPhoneless(couple);
                    const selectedSuspect = gmVictimReportSelections[couple.id] ?? '';
                    return (
                      <div key={couple.id} className="panel panel--purple" style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: 0, minWidth: 0 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 0 }}>
                          {renderTruncatedNames(couple.name)}
                          <span className={`badge ${hasSubmitted ? 'badge--blue' : 'badge--muted'}`}>
                            {hasSubmitted
                              ? (report.feltKilled ? t('gm.silentReportFeltKilled', { name: suspect ? maskName(suspect.name) : '?' }) : t('gm.silentReportNotKilled'))
                              : t('gm.waitingBadge')}
                          </span>
                        </div>
                        {needsGmSubmit && (
                          <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                            <select
                              className="cyber-select"
                              style={{ flex: '1 1 150px' }}
                              value={selectedSuspect}
                              onChange={(e) => setGmVictimReportSelections({ ...gmVictimReportSelections, [couple.id]: e.target.value })}
                            >
                              <option value="">{t('gm.chooseSuspect')}</option>
                              {room.couples.filter(c => c.status === 'alive' && c.id !== couple.id).map(s => (
                                <option key={s.id} value={s.id}>{maskName(s.name)}</option>
                              ))}
                            </select>
                            <button
                              className="cyber-button"
                              style={{ width: 'auto', padding: '8px 12px', fontSize: '0.85rem', margin: 0, flex: '0 0 auto' }}
                              disabled={!selectedSuspect}
                              onClick={() => handleSubmitVictimReportForCouple(couple.id, true)}
                            >
                              {t('gm.silentReportFeltKilledBtn')}
                            </button>
                            <button
                              className="cyber-button"
                              style={{ width: 'auto', padding: '8px 12px', fontSize: '0.85rem', margin: 0, background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)', flex: '0 0 auto' }}
                              onClick={() => handleSubmitVictimReportForCouple(couple.id, false)}
                            >
                              {t('gm.silentReportNotKilledBtn')}
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>

                <button
                  className="cyber-button pulse-animation"
                  style={{ width: '100%', padding: '15px', fontSize: '1.2rem', borderColor: 'var(--neon-purple)' }}
                  onClick={handleResolveSilentReports}
                >
                  {t('gm.resolveSilentReportsBtn')}
                </button>
              </div>
            ) : (
              <div className="panel panel--purple">
                <h4 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>{t('gm.observeTitle')}</h4>
                <p style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>
                  {t('gm.silentReportResolvedBody')}
                </p>
                <p style={{ color: 'var(--text-muted)', marginBottom: '5px' }}>
                  <strong>{t('gm.markKilled')}</strong> <span style={{ color: 'var(--neon-purple)' }}>{t('gm.markedCount', { marked: markedCount, total: aliveKillerCount })}</span>
                </p>

                <div className="couple-list" style={{ marginBottom: '20px' }}>
                  {aliveCouplesToKill.map(couple => {
                    const isMarked = room.pendingVictimIds?.includes(couple.id);
                    const disabled = !isMarked && limitReached;
                    return (
                      <button
                        key={couple.id}
                        className={`kill-option-btn ${isMarked ? 'selected' : ''}`}
                        onClick={() => handleReportKill(couple.id)}
                        disabled={disabled}
                        style={disabled ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}
                      >
                        <span style={{ flexShrink: 0, minWidth: '100px', whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', gap: '6px' }}>
                          {isMarked ? <><Check size={14} className="icon-inline" /> {t('gm.marked')}</> : <><Skull size={14} className="icon-inline" /> {t('gm.kill')}</>}
                        </span>
                        {renderTruncatedNames(couple.name)}
                      </button>
                    );
                  })}
                </div>
                {limitReached && aliveKillerCount > 0 && (
                  <p style={{ color: 'var(--neon-red)', fontSize: '0.85rem', margin: '-10px 0 15px 0', fontStyle: 'italic' }}>
                    {t('gm.killLimitReached', { count: aliveKillerCount })}
                  </p>
                )}
                <button
                  className={`nobody-option-btn ${!room.pendingVictimIds?.length ? 'selected' : ''}`}
                  onClick={() => handleReportKill(null)}
                  style={{ marginBottom: '20px' }}
                >
                  {!room.pendingVictimIds?.length ? <><Check size={16} className="icon-inline" /> {t('gm.markedNobody')}</> : t('gm.nobodyKilled')}
                </button>

                <button
                  className="cyber-button pulse-animation"
                  style={{ width: '100%', padding: '15px', fontSize: '1.2rem', borderColor: 'var(--neon-purple)' }}
                  onClick={handleRevealKill}
                >
                  {t('gm.revealKillBtn')}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* KILL REVEAL PHASE */}
      {room.status === 'kill_reveal' && (() => {
        const victimCouples = (room.victimIds || []).map(id => room.couples.find(c => c.id === id)).filter(Boolean);
        const canSkipToNextRound = isSpotifyReady || bypassSongReady;
        const skipWarning = !isSpotifyReady && (
          <div className="panel panel--danger" style={{ textAlign: 'center' }}>
            <strong style={{ color: 'var(--neon-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><AlertTriangle size={16} className="icon-inline" /> {t('gm.musicNotReady')}</strong><br />
            <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('gm.selectSongNextRound')}</span>
            {!bypassSongReady && (
              <div>
                <button
                  onClick={() => setBypassSongReady(true)}
                  style={{ marginTop: '10px', background: 'transparent', border: 'none', color: 'var(--neon-red)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  {t('gm.bypassSongReady')}
                </button>
              </div>
            )}
          </div>
        );
        return (
          <div className="phase-enter" style={{ marginBottom: '20px', textAlign: 'center' }}>
            {renderSpotifyControls()}
            <h3 style={{ color: 'var(--neon-purple)', marginBottom: '15px' }}>{t('gm.killRevealed')}</h3>
            {victimCouples.length > 0 ? (
              <>
                <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <Skull size={20} className="icon-inline" /> <strong>{t('player.wereEliminated', { names: victimCouples.map(c => maskName(c.name)).join(' & ') })}</strong>
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button className="cyber-button pulse-animation" onClick={handleProceedToVoting} style={{ width: '100%', fontSize: '1.2rem', padding: '15px' }}>
                    {t('gm.proceedVotingSkip')}
                  </button>
                  <button className="cyber-button" onClick={handleStartDiscussion} style={{ width: '100%', background: 'transparent', color: 'var(--text-muted)' }}>
                    {t('gm.startDiscussion')}
                  </button>
                  <button
                    className="cyber-button"
                    onClick={handleSkipToNextRound}
                    disabled={!canSkipToNextRound}
                    style={{ width: '100%', background: 'transparent', color: 'var(--text-muted)', opacity: canSkipToNextRound ? 1 : 0.5, cursor: canSkipToNextRound ? 'pointer' : 'not-allowed' }}
                  >
                    {t('gm.skipToNextRound')}
                  </button>
                  {skipWarning}
                </div>
              </>
            ) : (
              <>
                <p style={{ color: 'var(--neon-blue)', fontSize: '1.2rem', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <Sparkles size={20} className="icon-inline" /> {t('gm.nobodyEliminated')}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button className="cyber-button pulse-animation" onClick={handleProceedToVoting} style={{ width: '100%', fontSize: '1.2rem', padding: '15px' }}>
                    {t('gm.proceedVotingSkip')}
                  </button>
                  <button className="cyber-button" onClick={handleStartDiscussion} style={{ width: '100%', background: 'transparent', color: 'var(--text-muted)' }}>
                    {t('gm.startDiscussion')}
                  </button>
                  <button
                    className="cyber-button"
                    onClick={handleSkipToNextRound}
                    disabled={!canSkipToNextRound}
                    style={{ width: '100%', background: 'transparent', color: 'var(--text-muted)', opacity: canSkipToNextRound ? 1 : 0.5, cursor: canSkipToNextRound ? 'pointer' : 'not-allowed' }}
                  >
                    {t('gm.skipToNextRound')}
                  </button>
                  {skipWarning}
                </div>
              </>
            )}
          </div>
        );
      })()}

      {/* DISCUSSION PHASE */}
      {room.status === 'discussion' && (
        <div className="phase-enter" style={{ marginBottom: '20px' }}>
          {renderSpotifyControls()}
          <h3 style={{ color: 'var(--neon-purple)', marginBottom: '15px', display: 'flex', alignItems: 'center', gap: '10px' }}><MessageCircle size={20} className="icon-inline" /> {t('gm.discussionPhase')}</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '30px' }}>{t('gm.discussionBody')}</p>
          <button className="cyber-button pulse-animation" onClick={handleProceedToVoting} style={{ width: '100%', fontSize: '1.2rem', padding: '15px' }}>
            {t('gm.proceedVoting')}
          </button>
        </div>
      )}

      {/* VOTING PHASE */}
      {room.status === 'voting' && (() => {
        const canProceedVoting = isSpotifyReady || bypassSongReady;
        return (
        <div className="phase-enter" style={{ marginBottom: '20px' }}>
          {renderSpotifyControls()}
          <h3 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>{t('gm.votingPhase')}</h3>
          {room.votingEndTime && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Timer size={14} className="icon-inline" />
              {gmVotingTimeLeft > 0
                ? t('gm.votingTimeLeft', { seconds: gmVotingTimeLeft })
                : t('gm.votingTimeUp')}
            </p>
          )}
          {!isSpotifyReady && (
            <div className="panel panel--danger" style={{ textAlign: 'center' }}>
              <strong style={{ color: 'var(--neon-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><AlertTriangle size={16} className="icon-inline" /> {t('gm.musicNotReady')}</strong><br />
              <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('gm.selectSongNextRound')}</span>
              {!bypassSongReady && (
                <div>
                  <button
                    onClick={() => setBypassSongReady(true)}
                    style={{ marginTop: '10px', background: 'transparent', border: 'none', color: 'var(--neon-red)', textDecoration: 'underline', cursor: 'pointer' }}
                  >
                    {t('gm.bypassSongReady')}
                  </button>
                </div>
              )}
            </div>
          )}
          <div className="couple-list">
            {aliveCouples.map(couple => {
              const hasVoted = Object.keys(room.votes || {}).includes(couple.id);
              const needsGmVote = !hasVoted && isCoupleFullyPhoneless(couple);
              const suspectOptions = aliveCouples.filter(c => c.id !== couple.id);
              const selectedSuspect = gmVoteSelections[couple.id] ?? '';
              const votingPlayer = couple.votingPlayerId ? room.players.find(p => p.id === couple.votingPlayerId) : null;
              return (
                <div key={couple.id} className="panel panel--purple" style={{ display: 'flex', flexDirection: 'column', gap: '5px', marginBottom: 0, minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 0 }}>
                    {renderTruncatedNames(couple.name)}
                    <span className={`badge ${hasVoted ? 'badge--blue' : 'badge--muted'}`} style={{ margin: '0 10px' }}>
                      {hasVoted ? t('gm.voted') : t('gm.waitingBadge')}
                    </span>
                    <strong style={{ color: 'var(--neon-purple)', flexShrink: 0 }}>{getVoteCount(couple.id)} {t('gm.votes')}</strong>
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    {votingPlayer
                      ? <><Smartphone size={12} className="icon-inline" /> {t('gm.votingByLabel')} {maskName(votingPlayer.name)}</>
                      : <><PhoneOff size={12} className="icon-inline" /> {t('gm.nobodyAssigned')}</>}
                  </div>
                  {needsGmVote && (
                    <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                      <select
                        className="cyber-select"
                        style={{ flex: '1 1 150px' }}
                        value={selectedSuspect}
                        onChange={(e) => setGmVoteSelections({ ...gmVoteSelections, [couple.id]: e.target.value })}
                      >
                        <option value="">{t('gm.chooseSuspect')}</option>
                        {suspectOptions.map(s => (
                          <option key={s.id} value={s.id}>{maskName(s.name)}</option>
                        ))}
                      </select>
                      <button
                        className="cyber-button"
                        style={{ width: 'auto', padding: '8px 12px', fontSize: '0.85rem', margin: 0, flex: '0 0 auto' }}
                        disabled={!selectedSuspect}
                        onClick={() => handleGmCastVote(couple.id, selectedSuspect)}
                      >
                        {t('gm.voteForCouple')}
                      </button>
                      <button
                        className="cyber-button"
                        style={{ width: 'auto', padding: '8px 12px', fontSize: '0.85rem', margin: 0, background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)', flex: '0 0 auto' }}
                        onClick={() => handleGmCastVote(couple.id, null)}
                      >
                        {t('gm.abstain')}
                      </button>
                    </div>
                  )}
                  <button
                    className={canProceedVoting ? "cyber-button danger" : "cyber-button disabled"}
                    style={{ padding: '8px', fontSize: '0.9rem', opacity: canProceedVoting ? 1 : 0.5, cursor: canProceedVoting ? 'pointer' : 'not-allowed' }}
                    onClick={() => handleExecuteVoteSafe(couple.id)}
                    disabled={!canProceedVoting}
                  >
                    {t('gm.kickNextRound')}
                  </button>
                </div>
              );
            })}
          </div>
          <button
            className={canProceedVoting ? "cyber-button" : "cyber-button disabled"}
            style={{ marginTop: '15px', opacity: canProceedVoting ? 1 : 0.5, cursor: canProceedVoting ? 'pointer' : 'not-allowed' }}
            onClick={() => handleExecuteVoteSafe(null)}
            disabled={!canProceedVoting}
          >
            {t('gm.tieKickNobody')}
          </button>
        </div>
        );
      })()}

      {room.status === 'ended' && (() => {
        if (room.endReason === 'aborted') {
          return (
            <div className="panel phase-enter" style={{ marginTop: '30px', textAlign: 'center' }}>
              <h3 style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
                {t('gm.abortedTitle')}
              </h3>
              <p style={{ color: 'white', marginBottom: '20px' }}>
                {t('gm.abortedBody')}
              </p>
              <button className="cyber-button pulse-animation" style={{ width: '100%' }} onClick={handleResetGame}>
                {t('gm.backToLobby')}
              </button>
            </div>
          );
        }
        const winners = room.couples.filter(c => c.status === 'alive');
        const killersWon = winners.some(c => c.role === 'killer');
        const killerCouples = room.couples.filter(c => c.role === 'killer');
        return (
          <div className={`panel phase-enter ${killersWon ? 'panel--danger' : 'panel--info'}`} style={{ marginTop: '30px', textAlign: 'center' }}>
            <h3 style={{ color: killersWon ? 'var(--neon-red)' : 'var(--neon-blue)', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              {killersWon ? <Skull size={20} className="icon-inline" /> : <Sparkles size={20} className="icon-inline" />}
              {killersWon ? t('gm.killersVictory') : t('gm.dancersVictory')}
            </h3>
            {killerCouples.length > 0 && (
              <div style={{ marginBottom: '15px' }}>
                <p style={{ fontSize: '1.2rem', marginBottom: '5px', color: 'white' }}>
                  {killerCouples.length > 1 ? t('gm.killersLabel') : t('gm.killerLabel')}
                </p>
                {killerCouples.map((k, i) => (
                  <strong key={k.id} style={{ color: 'var(--neon-red)', display: 'block', fontSize: '1.1rem' }}>{maskName(k.name)}</strong>
                ))}
              </div>
            )}
            <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
              {t('gm.gameEnded')}
            </p>
            <button className="cyber-button pulse-animation" style={{ width: '100%' }} onClick={handleResetGame}>
              ZURÜCK ZUR LOBBY / NEUE RUNDE
            </button>
          </div>
        );
      })()}

      {showCouplesModal && createPortal(
        <div className="modal-overlay" onClick={() => setShowCouplesModal(false)}>
          <div className="modal-card cyber-card" style={{ maxWidth: '600px', border: '1px solid var(--neon-blue)', background: '#111' }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowCouplesModal(false)}
              className="icon-btn modal-close-btn"
            >
              <X size={20} />
            </button>
            <h3 style={{ marginBottom: '20px', color: 'var(--text-muted)' }}>{t('gm.allCouples')} ({room.couples.length})</h3>
            <div className="couple-list">
              {room.couples.map(couple => {
                const members = getCoupleMembers(couple);
                const phoneHavingMembers = members.filter(m => !m.hasNoPhone);
                return (
                  <div key={couple.id} className={`list-item ${couple.status === 'eliminated' ? 'list-item--danger' : 'list-item--active'}`} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px', padding: '15px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                      {renderMembersWithPhoneIcons(couple, { dimmed: couple.status === 'eliminated', bold: true })}
                      {room.status !== 'lobby' && room.status !== 'paired' && (
                        <span className={`role-${couple.role}`} style={{ fontSize: '0.8rem', textTransform: 'uppercase', flexShrink: 0 }}>
                          {t(`role.${couple.role}`)}
                        </span>
                      )}
                      <button
                        onClick={() => handleKickCouple(couple.id, couple.name)}
                        className="icon-btn danger"
                        title={t('gm.kickCoupleTitle')}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    {phoneHavingMembers.length > 1 && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                          <Smartphone size={13} className="icon-inline" /> {t('gm.votingByLabel')}
                        </span>
                        <select
                          className="cyber-select"
                          style={{ flex: '1 1 150px', margin: 0 }}
                          value={couple.votingPlayerId || ''}
                          onChange={(e) => handleGmDelegateVote(couple.id, e.target.value)}
                        >
                          {phoneHavingMembers.map(m => (
                            <option key={m.id} value={m.id}>{maskName(m.name)}</option>
                          ))}
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>,
        document.body
      )}

      {showTeamModal && createPortal(
        <div className="modal-overlay" onClick={() => setShowTeamModal(false)}>
          <div className="modal-card cyber-card" style={{ maxWidth: '600px', border: '1px solid var(--neon-purple)', background: '#111' }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowTeamModal(false)}
              className="icon-btn modal-close-btn"
            >
              <X size={20} />
            </button>
            <h3 style={{ marginBottom: '20px', color: 'var(--neon-purple)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Crown size={20} className="icon-inline" /> {t('gm.manageTeamTitle')}
            </h3>

            <h4 style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>{t('gm.currentCoGms')} ({room.coGms?.length || 0})</h4>
            <div className="couple-list" style={{ marginBottom: '25px' }}>
              {(room.coGms || []).length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('gm.noCoGms')}</p>
              )}
              {(room.coGms || []).map(gm => (
                <div key={gm.id} className="list-item list-item--purple">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Crown size={15} className="icon-inline" /> {maskName(gm.name)}</span>
                  <button
                    onClick={() => handleRemoveCoGM(gm.id, gm.name)}
                    className="icon-btn danger"
                    title={t('gm.revokeGmTitle')}
                  >
                    <X size={18} />
                  </button>
                </div>
              ))}
            </div>

            <h4 style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>{t('gm.promoteHeader')}</h4>
            {room.status !== 'lobby' ? (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('gm.promoteLobbyOnly')}</p>
            ) : (
              <div className="couple-list">
                {room.players.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('gm.noPlayers')}</p>
                )}
                {room.players.map(p => (
                  <div key={p.id} className="list-item">
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{maskName(p.name)}</span>
                    {p.hasNoPhone ? (
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }} title={t('gm.cannotPromoteTitle')}>
                        <PhoneOff size={13} className="icon-inline" /> {t('gm.noPhoneShort')}
                      </span>
                    ) : (
                      <button
                        className="cyber-button"
                        style={{ padding: '10px 14px', minHeight: '40px', fontSize: '0.85rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}
                        onClick={() => handlePromoteToGM(p.id, p.name)}
                      >
                        <Crown size={14} className="icon-inline" /> {t('gm.promoteBtn', { name: maskName(p.name) })}
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>,
        document.body
      )}

      {showChatModal && createPortal(
          <div className="modal-overlay" onClick={() => setShowChatModal(false)}>
            <div className="modal-card cyber-card" style={{ maxWidth: '500px', height: '80dvh', border: '1px solid var(--neon-blue)', background: '#111', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
              <button
                onClick={() => setShowChatModal(false)}
                className="icon-btn modal-close-btn"
              >
                <X size={20} />
              </button>
              <h3 style={{ marginBottom: '15px', color: 'var(--neon-blue)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <MessageCircle size={20} className="icon-inline" /> {t('gm.gmChat')}
              </h3>
              <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '5px' }}>
                {gmChatMessages.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', marginTop: '20px' }}>{t('gm.noMessages')}</p>
                )}
                {gmChatMessages.map(msg => {
                  const isMine = msg.senderName === myGmName;
                  return (
                    <div key={msg.id} className={`chat-row ${isMine ? 'mine' : 'theirs'}`}>
                      <div className="chat-sender">
                        {isMine ? t('gm.you') : msg.senderName}
                      </div>
                      <div className="chat-bubble">
                        {msg.text}
                      </div>
                    </div>
                  );
                })}
                <div ref={chatEndRef} />
              </div>
              <div style={{ display: 'flex', gap: '10px', marginTop: '15px' }}>
                <input
                  type="text"
                  className="cyber-input"
                  placeholder={t('gm.chatPlaceholder')}
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleSendChat(); }}
                  style={{ flex: 1, margin: 0 }}
                  maxLength={500}
                />
                <button className="cyber-button" onClick={handleSendChat} disabled={!chatInput.trim()} style={{ width: 'auto', flexShrink: 0, padding: '0 20px', display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <Send size={16} className="icon-inline" /> {t('gm.sendBtn')}
                </button>
              </div>
            </div>
          </div>,
          document.body
      )}

      <ConfirmModal
        isOpen={!!confirmState}
        message={confirmState?.message}
        onConfirm={() => {
          if (confirmState && confirmState.onConfirm) {
            confirmState.onConfirm();
          }
          setConfirmState(null);
        }}
        onCancel={() => setConfirmState(null)}
      />

      <AlertModal
        isOpen={!!alertState}
        message={alertState?.message}
        onClose={() => setAlertState(null)}
      />

      {showSpotifyModal && createPortal(
        <div className="modal-overlay" onClick={() => setShowSpotifyModal(false)}>
          <div className="modal-card cyber-card" style={{ maxWidth: '600px', border: '1px solid var(--neon-green)' }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowSpotifyModal(false)}
              className="icon-btn modal-close-btn"
            >
              <X size={20} />
            </button>
            {renderSpotifyControls(false, true)}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default GMDashboard;
