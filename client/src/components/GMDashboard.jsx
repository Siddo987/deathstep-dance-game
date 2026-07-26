import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { socket } from '../socket.js';
import { ConfirmModal, AlertModal } from './Modal.jsx';
import {
  loginWithSpotify, loginWithSpotifyForAccountLink, searchTracks, playTrack, pausePlayback, logoutSpotify,
  getBestAvailableToken, SPOTIFY_SESSION_EXPIRED_EVENT,
  fetchMySpotifyPlaylists, fetchSpotifyPlaylistTracks,
} from '../spotify.js';
import { fetchMyPlaylists, fetchPlaylist, addTrackToPlaylist, createPlaylist, fetchRoomSpotifyToken } from '../spotifyPlaylists.js';
import { getCookieConsent } from './CookieBanner.jsx';
import { useLanguage } from '../i18n.jsx';
import coupleIcon from './couple_icon.png';
import {
  MessageCircle, Crown, X, PhoneOff, Repeat, Scissors, AlertTriangle, Lightbulb,
  Music2, Skull, Sparkles, EyeOff, Eye, Check, Plus, Minus, LogOut, Flag,
  Send, UserPlus, QrCode, Play, Pause, Search, ChevronRight, Timer, Smartphone,
  ChevronUp, ChevronDown, RotateCcw
} from 'lucide-react';

function GMDashboard({ room, onLeave, myGmName, gmChatMessages, onSendGMChatMessage, currentUser }) {
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
  const [searchDone, setSearchDone] = useState(false); // true once a search has actually returned, so an empty result set can say "no results" instead of looking unsearched
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(1);

  const [gmPlaylists, setGmPlaylists] = useState([]);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  // Which text-type queue entry the search box is currently resolving a real
  // track for (see renderSpotifyControls' queue list) - null means a search
  // hit just gets appended to the queue as usual.
  const [resolvingQueueEntryId, setResolvingQueueEntryId] = useState(null);
  const [addToPlaylistFor, setAddToPlaylistFor] = useState(null); // track uri whose "add to playlist" picker is expanded, or null
  const [addToPlaylistNewName, setAddToPlaylistNewName] = useState('');
  const [addToPlaylistStatus, setAddToPlaylistStatus] = useState('');

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

  // "Ready" means there's something to play right now, or something queued
  // that will auto-play the moment the next round starts (see
  // playNextQueuedTrack, called from handleStartDancing/handleExecuteVote) -
  // not "the GM re-picked fresh for this exact round", since the queue
  // already carries over and auto-advances on its own.
  const hasMusicReady = !!room.nowPlaying || room.songQueue.some(e => e.type === 'spotify');
  const isSpotifyReady = !useSpotify || (hasMusicReady && spotifyPlayer);

  // room.nowPlaying (server-broadcast room state, see server/gameStore.js's
  // songQueue/nowPlaying) - not client-local, so a GM reload never loses it
  // (this used to be client-only selectedTrack/activePlaylist state, which
  // is exactly what made a GM reload mid-DANCING lose the "now playing" box).
  const nowPlayingTrack = room.nowPlaying
    ? { uri: room.nowPlaying.uri, name: room.nowPlaying.name, artist: room.nowPlaying.artist || '', imageUrl: null, suggestedBy: room.nowPlaying.suggestedBy || null }
    : null;

  // "Add this track to a playlist" only ever writes to a DB-backed playlist
  // (server/playlists.js) - local, non-account Spotify playlists (source:
  // 'local' in gmPlaylists) are read-only browsing, nothing to persist to.
  const accountGmPlaylists = gmPlaylists.filter(pl => pl.source !== 'local');

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
    // Only meaningful (and only changeable by the GM) during the lobby - see
    // the segmented control below - but also re-announced on every lobby
    // mount so a fresh room always gets an explicit value instead of relying
    // on whichever tab happens to click the toggle.
    if (room.status === 'lobby') {
      socket.emit('setUseSpotify', { roomId: room.id, useSpotify });
    }
  }, [useSpotify]);

  React.useEffect(() => {
    if (!spotifyAllowed && useSpotify) {
      setUseSpotify(false);
    }
  }, [spotifyAllowed]);

  // Keeps this browser's local choice in sync with the room's broadcast
  // value - matters for a co-GM's browser (which has its own localStorage
  // default) or a reload after the primary GM already chose, so everyone
  // agrees on what room.useSpotify actually is.
  React.useEffect(() => {
    if (typeof room.useSpotify === 'boolean' && room.useSpotify !== useSpotify) {
      setUseSpotify(room.useSpotify);
    }
  }, [room.useSpotify]);

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

  // Privacy mode is a per-game toggle (hide player names on the GM's own
  // screen) - reset it the moment a game concludes, whether that's a
  // natural win/loss or the GM aborting via "End Game", rather than only on
  // the later "back to lobby" click. Otherwise it silently carries into the
  // next game unless the GM remembers to turn it off themselves.
  React.useEffect(() => {
    if (room.status === 'ended') {
      setPrivacyMode(false);
    }
  }, [room.status]);

  // Per-round GM-local UI state (the kill-claim/victim-report/vote proxy
  // dropdowns, the "add to playlist" picker) must not survive into the next
  // round - a stale selection would otherwise resurface pointing at whatever
  // couple happened to share that same id/position in the new round.
  React.useEffect(() => {
    setGmKillClaimSelections({});
    setGmVictimReportSelections({});
    setGmVoteSelections({});
    setAddToPlaylistFor(null);
    setAddToPlaylistNewName('');
    setAddToPlaylistStatus('');
  }, [room.round]);

  // Guards against a stale reference if the entry being resolved got removed
  // (e.g. by a co-GM) out from under the search box.
  React.useEffect(() => {
    if (resolvingQueueEntryId && !room.songQueue.some(e => e.id === resolvingQueueEntryId)) {
      setResolvingQueueEntryId(null);
    }
  }, [room.songQueue, resolvingQueueEntryId]);

  // Two independent sources feed the same picker: a logged-in Deathstep
  // account's DB-backed playlists (source: 'account' - persisted, can be
  // added to), and, with no account needed at all, whatever playlists
  // already exist on the connected Spotify account itself (source:
  // 'local' - read-only, fetched fresh from Spotify each time, nothing
  // stored). Either, both, or neither can be available at once.
  React.useEffect(() => {
    if (!useSpotify) { setGmPlaylists([]); return; }
    let cancelled = false;
    (async () => {
      const lists = [];
      if (currentUser) {
        const result = await fetchMyPlaylists();
        if (!result.error) lists.push(...result.playlists.map(p => ({ ...p, source: 'account' })));
      }
      if (spotifyToken) {
        try {
          const local = await fetchMySpotifyPlaylists();
          lists.push(...local.map(p => ({ ...p, source: 'local' })));
        } catch (e) { /* local Spotify playlists just won't show this time - not fatal */ }
      }
      if (!cancelled) setGmPlaylists(lists);
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id, useSpotify, spotifyToken]);

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
  }, [room?.nowPlaying?.uri, room?.status, room?.round]);

  // Tells the server a track actually started playing, for the per-game
  // "played songs" record shown at game end - fire-and-forget, no callback
  // needed since it's purely additive bookkeeping. Accepts either a Spotify
  // search-result track (`.artists` array) or a playlist track (`.artist`
  // string) and normalizes to the single shape the server expects.
  const reportTrackPlayed = (track) => {
    if (!track?.uri) return;
    const artist = track.artist ?? (track.artists ? track.artists.map(a => a.name).join(', ') : '');
    socket.emit('trackPlayed', { roomId: room.id, track: { uri: track.uri, name: track.name, artist, suggestedBy: track.suggestedBy || null } });
  };

  // Re-runs whichever login flow actually backs this GM's playback (see
  // getPlaybackToken below): the account-linked flow if logged into a
  // Deathstep account (same connection as the Playlists page), otherwise the
  // local browser-only PKCE flow - so "reconnect" always fixes the
  // connection that's actually in use instead of the other one.
  const handleReconnectSpotify = () => {
    if (currentUser) loginWithSpotifyForAccountLink();
    else loginWithSpotify();
  };

  const sessionExpiredAlert = () => ({
    message: t('spotify.sessionExpired'),
    actionLabel: t('spotify.reconnectNow'),
    onAction: handleReconnectSpotify,
  });

  // Shared failure handling for every playTrack() call below - surfaces the
  // two cases a GM can actually act on (no active playback device; the
  // Spotify session expired and getValidToken() couldn't refresh it) with a
  // clear message instead of letting playback silently do nothing, and only
  // falls back to a console log for anything else (network hiccup, etc.).
  const handleSpotifyPlaybackError = (e, fallbackLog) => {
    if (e.message === 'NO_ACTIVE_DEVICE') {
      setAlertState({ message: t('spotify.noDevice') });
    } else if (e.message === 'SPOTIFY_NOT_CONNECTED') {
      setAlertState(sessionExpiredAlert());
    } else {
      console.error(fallbackLog, e);
    }
  };

  // Removes one entry from the server-side queue and makes it the current
  // pick (see server/gameStore.js's playQueueEntry) - own-audio mode has no
  // SDK to hand it to, so it only updates room.nowPlaying for display; a
  // Spotify-mode GM also actually starts playback and reports it played.
  const handlePlayQueueEntry = async (entry) => {
    socket.emit('playQueueEntry', { roomId: room.id, entryId: entry.id });
    if (!useSpotify) return;
    try {
      await playTrack(entry.uri, spotifyPlayerId);
      reportTrackPlayed(entry);
    } catch (e) {
      handleSpotifyPlaybackError(e, 'Failed to play queued track');
    }
  };

  // Plays the first real (non-placeholder) track in the queue - the single
  // place both the round-start handlers and the auto-advance-on-finish
  // effect call. A no-op if the queue is empty or only holds unresolved
  // text placeholders (see resolveQueueTextEntry) - nothing auto-plays
  // until the GM gives one of those a real track.
  const playNextQueuedTrack = async () => {
    const nextEntry = room.songQueue.find(e => e.type === 'spotify');
    if (!nextEntry) return;
    await handlePlayQueueEntry(nextEntry);
  };

  // The actual "auto-advance to the next track" behavior: once the current
  // track nears its end during dancing, move straight to the next queued one.
  React.useEffect(() => {
    if (!hasSongFinished || room.status !== 'dancing') return;
    playNextQueuedTrack();
  }, [hasSongFinished]);

  // Priority: a player's lent Spotify connection (room.spotifyDelegate, see
  // grantSpotifyToRoom) first, since if someone went out of their way to
  // offer it, that's presumably because the GM doesn't have a working
  // connection of their own. Otherwise, getBestAvailableToken already
  // prefers the Deathstep-account-linked connection (server-linked,
  // cross-device - the GM connected once on the Playlists page, or is simply
  // logged into the same Deathstep account elsewhere) over this browser's
  // own local PKCE flow, so no separate currentUser check is needed here.
  const getPlaybackToken = React.useCallback(() => {
    if (room.spotifyDelegate) {
      return fetchRoomSpotifyToken(room.id).then(r => r.accessToken || null);
    }
    return getBestAvailableToken();
  }, [room.id, room.spotifyDelegate]);

  React.useEffect(() => {
    // Reads through getPlaybackToken() (not the raw localStorage value) so a
    // token that's already expired by the time the dashboard loads gets
    // silently refreshed instead of handing the SDK a dead token.
    getPlaybackToken().then(token => {
      if (token) setSpotifyToken(token);
    });
  }, [currentUser?.id]);

  // Proactively keeps the token fresh on a fixed schedule (well inside its
  // ~1h lifetime) instead of only ever refreshing reactively when something
  // happens to need one. With this running, playback/search/the SDK's own
  // getOAuthToken calls should basically never hit the "token's already
  // stale, refresh it right now" path during a normal session at all -
  // there's simply always a recently-refreshed one sitting ready. Doesn't
  // touch spotifyToken (React) state on purpose: the effect below that
  // creates the Web Playback SDK player is keyed on that state and would
  // tear down and recreate the player - interrupting playback - on every
  // change, and the SDK already reads a fresh token per-call via its own
  // getOAuthToken callback regardless of what's in state.
  React.useEffect(() => {
    if (!useSpotify) return;
    const interval = setInterval(() => { getPlaybackToken(); }, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, [useSpotify, getPlaybackToken]);

  // client/src/spotify.js dispatches this the moment a token refresh
  // definitively fails (the stored refresh token is dead, e.g. revoked on
  // Spotify's side) - without this, the GM would only ever notice via a
  // silently-failing play/pause/search click. Tear down the local player
  // state so the UI drops back to the "connect to Spotify" button (the SDK
  // player itself is now holding a dead session and can't recover).
  React.useEffect(() => {
    const handleExpired = () => {
      setSpotifyToken(null);
      setSpotifyPlayer(null);
      setSpotifyPlayerId(null);
      setPlayerStatus({ key: 'spotify.statusInit', detail: '', isError: false });
      setAlertState(sessionExpiredAlert());
    };
    window.addEventListener(SPOTIFY_SESSION_EXPIRED_EVENT, handleExpired);
    return () => window.removeEventListener(SPOTIFY_SESSION_EXPIRED_EVENT, handleExpired);
  }, [t]);

  // getOAuthToken always needs the *current* getPlaybackToken (it changes
  // whenever currentUser/room.spotifyDelegate changes), but the SDK callback
  // below is only ever wired up once per useSpotify mount - a ref keeps it
  // reading the latest one without re-running that setup.
  const getPlaybackTokenRef = React.useRef(getPlaybackToken);
  React.useEffect(() => { getPlaybackTokenRef.current = getPlaybackToken; }, [getPlaybackToken]);

  // Loads Spotify's SDK from their CDN once the GM has opted into the
  // Spotify integration (never load third-party scripts by default), and
  // defines window.onSpotifyWebPlaybackSDKReady in the very same effect -
  // previously that callback was only assigned once spotifyToken became
  // truthy, in a separate effect. Since the SDK calls it the instant the
  // script finishes loading (which can easily happen before the async
  // token fetch resolves), that left a real race: onSpotifyWebPlaybackSDKReady
  // could still be undefined when the script called it, crashing with
  // "AnthemError: onSpotifyWebPlaybackSDKReady is not defined". Defining it
  // unconditionally here (it doesn't actually need a token in hand - the
  // player's getOAuthToken callback fetches one on demand) removes the race,
  // and also stops a second bug this had: re-running per spotifyToken change
  // used to create and connect() a brand new Spotify.Player every time the
  // token refreshed, leaving old ones connected as orphaned duplicate devices.
  React.useEffect(() => {
    if (!useSpotify) return;

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'Deathstep Web Player',
        // Always resolves a live token (including well after whatever token
        // existed when the player was first built has expired) rather than
        // ever closing over a single stale value.
        getOAuthToken: cb => { getPlaybackTokenRef.current().then(cb); },
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

    if (document.getElementById('spotify-sdk-script')) {
      // Script already injected by an earlier mount - the SDK only calls
      // onSpotifyWebPlaybackSDKReady once per page load, so if it's already
      // loaded, invoke it directly now that the callback is (re)assigned.
      if (window.Spotify) window.onSpotifyWebPlaybackSDKReady();
      return;
    }
    const script = document.createElement('script');
    script.id = 'spotify-sdk-script';
    script.src = 'https://sdk.scdn.co/spotify-player.js';
    document.body.appendChild(script);
  }, [useSpotify]);

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

  // Adopting a suggestion always lands it in the queue (server/gameStore.js's
  // confirmSongSuggestion pushes it there itself) rather than immediately
  // hijacking playback - the GM decides when to actually play it, same as
  // everything else queued.
  const handleConfirmSuggestion = (suggestion) => {
    socket.emit('confirmSongSuggestion', { roomId: room.id, suggestionId: suggestion.id }, (response) => {
      // Two co-GMs handling the same suggestion at once: the losing call
      // gets told it's already gone instead of silently doing nothing.
      if (!response?.success) {
        setAlertState({ message: response?.messageKey ? t(`server.${response.messageKey}`) : t('server.suggestionNotFound') });
      }
    });
  };

  const handleDismissSuggestion = (suggestionId) => {
    socket.emit('dismissSongSuggestion', { roomId: room.id, suggestionId }, (response) => {
      if (!response?.success) {
        setAlertState({ message: response?.messageKey ? t(`server.${response.messageKey}`) : t('server.suggestionNotFound') });
      }
    });
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

    if (!willEnd) {
      await playNextQueuedTrack();
    }
  };

  const handleStartDancing = async () => {
    socket.emit('startDancing', { roomId: room.id });
    await playNextQueuedTrack();
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
      setSearchDone(true);
    } catch (e) {
      if (e.message === 'SPOTIFY_NOT_CONNECTED') {
        setAlertState(sessionExpiredAlert());
        return;
      }
      console.error("Failed to search tracks", e);
    }
  };

  // A search hit either resolves the queue placeholder currently being
  // worked on (resolvingQueueEntryId, e.g. a confirmed free-text suggestion
  // - see item 8) or, normally, just gets appended to the queue.
  const handleSearchResultClick = (track) => {
    const normalized = { uri: track.uri, name: track.name, artist: track.artists.map(a => a.name).join(', ') };
    if (resolvingQueueEntryId) {
      socket.emit('resolveQueueTextEntry', { roomId: room.id, entryId: resolvingQueueEntryId, track: normalized });
      setResolvingQueueEntryId(null);
    } else {
      socket.emit('addToSongQueue', { roomId: room.id, track: normalized });
    }
    setSearchResults([]);
    setSearchQuery('');
    setSearchDone(false);
  };

  // Bulk-appends an entire playlist's tracks to the queue - replaces the old
  // "use this playlist for the dance" single-playlist cycling mode.
  const handleAddPlaylistToQueue = async (playlist) => {
    let tracks;
    if (playlist.source === 'local') {
      try {
        const raw = await fetchSpotifyPlaylistTracks(playlist.id);
        tracks = raw.map(t => ({ uri: t.uri, name: t.name, artist: t.artists.map(a => a.name).join(', ') }));
      } catch (e) {
        handleSpotifyPlaybackError(e, 'Failed to load local Spotify playlist');
        return;
      }
    } else {
      const result = await fetchPlaylist(playlist.id);
      if (result.error) return;
      tracks = result.playlist.tracks;
    }
    if (tracks.length === 0) return;
    socket.emit('addPlaylistToSongQueue', { roomId: room.id, tracks });
    setShowPlaylistPicker(false);
  };

  const handleRemoveQueueEntry = (entryId) => {
    socket.emit('removeFromSongQueue', { roomId: room.id, entryId });
    if (resolvingQueueEntryId === entryId) setResolvingQueueEntryId(null);
  };

  const handleMoveQueueEntry = (entryId, direction) => {
    const ids = room.songQueue.map(e => e.id);
    const idx = ids.indexOf(entryId);
    const targetIdx = idx + direction;
    if (idx === -1 || targetIdx < 0 || targetIdx >= ids.length) return;
    [ids[idx], ids[targetIdx]] = [ids[targetIdx], ids[idx]];
    socket.emit('reorderSongQueue', { roomId: room.id, entryIds: ids });
  };

  // Generalized over any track (the now-playing one, or one from the
  // post-game played-songs summary) - addToPlaylistFor tracks which single
  // track's picker is currently expanded, identified by its uri.
  const handleAddTrackToPlaylist = async (playlistId, track) => {
    const result = await addTrackToPlaylist(playlistId, { uri: track.uri, name: track.name, artist: track.artist });
    // On a Spotify-linked playlist the track is only staged, not pushed yet -
    // say so instead of implying it's already on Spotify (confirm/undo happens on the Playlists page).
    const messageKey = result.error ? 'gm.addToPlaylistFailed' : result.track?.syncStatus === 'pending_add' ? 'gm.addToPlaylistPending' : 'gm.addToPlaylistSuccess';
    setAddToPlaylistStatus(t(messageKey));
    setTimeout(() => setAddToPlaylistStatus(''), 2500);
    if (!result.error) setAddToPlaylistFor(null);
  };

  const handleCreatePlaylistWithTrack = async (track) => {
    const name = addToPlaylistNewName.trim();
    if (!name) return;
    const created = await createPlaylist(name);
    if (created.error) return;
    setGmPlaylists(prev => [...prev, created.playlist]);
    setAddToPlaylistNewName('');
    await handleAddTrackToPlaylist(created.playlist.id, track);
  };

  // Post-round (from kill_reveal onward) and post-game summary of every
  // track the server recorded as actually played (server/gameStore.js
  // addPlayedSong), grouped by round - empty whenever the whole game was
  // own-audio mode, since the app never sees what plays externally.
  const renderPlayedSongs = () => {
    if (!room.playedSongs || room.playedSongs.length === 0) return null;
    const byRound = new Map();
    room.playedSongs.forEach(song => {
      if (!byRound.has(song.round)) byRound.set(song.round, []);
      byRound.get(song.round).push(song);
    });
    return (
      <div className="panel panel--success" style={{ textAlign: 'left', marginTop: '20px' }}>
        <div className="panel-title" style={{ color: 'var(--neon-green)' }}>
          <Music2 size={16} className="icon-inline" /> {t('gm.playedSongs')}
        </div>
        {[...byRound.entries()].map(([round, songs]) => (
        <div key={round} style={{ marginBottom: '15px' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '8px', textTransform: 'uppercase' }}>{t('player.round', { n: round })}</div>
          {songs.map(song => {
          const rowKey = `${song.uri}-${song.playedAt}`;
          return (
          <div key={rowKey} style={{ marginBottom: '10px' }}>
            <div className="list-item">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.artist}</div>
                {song.suggestedBy && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('gm.suggestedBy', { name: maskName(song.suggestedBy.name) })}</div>
                )}
              </div>
              {currentUser && (
                <button
                  className="icon-btn"
                  title={t('gm.addToPlaylist')}
                  style={{ flexShrink: 0 }}
                  onClick={() => setAddToPlaylistFor(prev => prev === rowKey ? null : rowKey)}
                >
                  <Plus size={18} style={{ color: 'var(--neon-purple)' }} />
                </button>
              )}
            </div>
            {currentUser && addToPlaylistFor === rowKey && (
              <div style={{ border: '1px solid var(--neon-purple)', borderRadius: 'var(--radius-sm)', padding: '12px' }}>
                {accountGmPlaylists.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                    {accountGmPlaylists.map(pl => (
                      <button
                        key={pl.id}
                        onClick={() => handleAddTrackToPlaylist(pl.id, song)}
                        style={{ textAlign: 'left', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 12px', color: 'var(--text-main)', cursor: 'pointer', fontSize: '0.85rem' }}
                      >
                        {pl.name}
                      </button>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="cyber-input"
                    style={{ marginBottom: 0, flex: 1, padding: '8px 12px', fontSize: '0.85rem' }}
                    placeholder={t('playlists.newNamePlaceholder')}
                    value={addToPlaylistNewName}
                    onChange={(e) => setAddToPlaylistNewName(e.target.value)}
                  />
                  <button className="cyber-button" style={{ width: 'auto', padding: '8px 14px', fontSize: '0.85rem' }} onClick={() => handleCreatePlaylistWithTrack(song)}>
                    <Plus size={14} className="icon-inline" />
                  </button>
                </div>
                {addToPlaylistStatus && (
                  <p style={{ color: 'var(--neon-green)', fontSize: '0.8rem', textAlign: 'center', marginTop: '8px', marginBottom: 0 }}>{addToPlaylistStatus}</p>
                )}
              </div>
            )}
          </div>
          );
          })}
        </div>
        ))}
      </div>
    );
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

  // Marks a player's phone dead mid-game (or reverses that) - see
  // gameStore.setPlayerPhoneStatus. Never offered for a manually-added
  // (from-the-start phoneless) player, identified by their id prefix (see
  // gameStore.addManualPlayer) - toggling "restore" on one of those would be
  // meaningless, since they never had a real device/socket to begin with.
  const isManualPlayer = (player) => player.id.startsWith('manual_');
  const handleSetPlayerPhoneStatus = (playerId, hasNoPhone) => {
    socket.emit('setPlayerPhoneStatus', { roomId: room.id, playerId, hasNoPhone });
  };

  // The GM may revoke a player's lent Spotify connection at any time (e.g.
  // the donor had to leave) - server/index.js's revokeSpotifyFromRoom allows
  // this for any verified GM regardless of clientId.
  const handleRevokeSpotifyDelegate = () => {
    socket.emit('revokeSpotifyFromRoom', { roomId: room.id, clientId: null });
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
        playerIds: [l.id, f.id],
        isManual: false, // came from "randomize" - eligible for the site owner's hidden pairing override (see gameStore.applyPairOverrides)
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

    // Run the freshly-randomized couples past the server before showing them
    // as "pending" - the site owner's hidden pairing override (see
    // gameStore.applyPairOverrides) only ever gets applied server-side, so
    // without this round-trip the pending-couples preview shown here would
    // never reflect it (only the final "Release Pairs" commit would), even
    // though nothing in this preview step is final yet. Falls back to the
    // raw, uncorrected couples if the round-trip fails for any reason, same
    // as if the override simply didn't exist.
    socket.emit('previewPairing', { roomId: room.id, generatedCouples: newCouples }, (response) => {
      setPendingCouples(response?.success ? response.couples : newCouples);
    });

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
        playerActions: {}
      });
    }
  };

  // Applies a switch/spectator choice for one player in the unbalanced-roles
  // popup right away (real socket update, not just staged local state) - the
  // GM sees the player's role actually change immediately, and can change
  // their mind via the row's undo button (action 'none'), which reverts the
  // same way instead of leaving it queued behind a separate confirm step.
  const handlePlayerActionChange = (playerId, action) => {
    const missingRole = randomizerFlow.excessType === 'lead' ? 'follow' : 'lead';
    const newRole = action === 'switch' ? missingRole : action === 'spectator' ? 'spectator' : randomizerFlow.excessType;
    socket.emit('updatePlayerRole', { roomId: room.id, clientId: playerId, newRole });
    setRandomizerFlow(prev => {
      const playerActions = { ...prev.playerActions };
      if (action === 'none') delete playerActions[playerId];
      else playerActions[playerId] = action;
      return { ...prev, playerActions };
    });
  };

  // Closing the popup without finishing pairing shouldn't leave behind the
  // role changes it already applied live - revert everyone touched in this
  // flow back to their original (excess) role before actually closing it.
  const handleCancelRandomizerFlow = () => {
    Object.keys(randomizerFlow.playerActions || {}).forEach(playerId => {
      socket.emit('updatePlayerRole', { roomId: room.id, clientId: playerId, newRole: randomizerFlow.excessType });
    });
    setRandomizerFlow(null);
  };

  const executeMixedSelection = () => {
    const actions = randomizerFlow.playerActions || {};
    const missingRole = randomizerFlow.excessType === 'lead' ? 'follow' : 'lead';
    const excessGroup = randomizerFlow.excessType === 'lead' ? randomizerFlow.leads : randomizerFlow.follows;
    const missingGroupOriginal = randomizerFlow.excessType === 'lead' ? randomizerFlow.follows : randomizerFlow.leads;

    // Role changes were already applied live as each choice was made
    // (handlePlayerActionChange) - just derive the final groups for
    // pairing, no more socket emits needed here.
    const stillExcess = excessGroup.filter(p => !actions[p.id]);
    const switchedIn = excessGroup.filter(p => actions[p.id] === 'switch').map(p => ({ ...p, danceRole: missingRole }));
    const missingGroup = [...missingGroupOriginal, ...switchedIn];

    const effectiveExcess = Math.abs(stillExcess.length - missingGroup.length);
    const effectiveBase = Math.min(stillExcess.length, missingGroup.length);
    const stillNeeded = Math.max(0, Math.ceil((effectiveExcess - effectiveBase) / 3));
    if (stillNeeded > 0) {
      setAlertState({ message: t('gm.randNotEnough') });
      return;
    }

    const leads = randomizerFlow.excessType === 'lead' ? stillExcess : missingGroup;
    const follows = randomizerFlow.excessType === 'lead' ? missingGroup : stillExcess;

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
      { name: names, playerIds: currentGroup, isManual: true } // GM's explicit choice - never touched by the site owner's hidden pairing override
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

    if (getUnpairedPlayers().some(p => p.danceRole !== 'spectator')) {
      setAlertState({ message: t('gm.unpairedPlayersRemain') });
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

  // The queue list itself (upcoming picks, with reorder/play/remove) - used
  // both inline (wherever renderSpotifyControls is shown) and in the
  // "change track" modal, so it's always the same list regardless of where
  // the GM is managing it from.
  const renderSongQueue = (showNowPlaying = true) => (
    <div style={{ marginTop: '15px' }}>
      <h4 style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>{t('gm.songQueue')}</h4>

      {showNowPlaying && room.nowPlaying && (
        <div className="list-item panel--success" style={{ borderColor: 'var(--neon-green)', background: 'rgba(29,185,84,0.2)', marginBottom: '8px' }}>
          <Music2 size={20} className="icon-inline" style={{ color: 'var(--neon-green)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--neon-green)', textTransform: 'uppercase', fontWeight: 'bold' }}>{t('spotify.nowPlaying')}</div>
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{room.nowPlaying.name} — {room.nowPlaying.artist}</div>
            {room.nowPlaying.suggestedBy && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('gm.suggestedBy', { name: maskName(room.nowPlaying.suggestedBy.name) })}</div>
            )}
          </div>
        </div>
      )}

      {room.songQueue.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', fontStyle: 'italic' }}>{t('gm.queueEmpty')}</p>
      ) : (
        <div className="couple-list" style={{ marginTop: 0 }}>
          {room.songQueue.map((entry, idx) => (
            <div key={entry.id} className="list-item">
              <div style={{ flex: 1, minWidth: 0 }}>
                {entry.type === 'text' ? (
                  <>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      <MessageCircle size={14} className="icon-inline" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
                      {entry.text}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--neon-purple)' }}>{t('gm.queueNeedsRealTrack')}</div>
                  </>
                ) : (
                  <>
                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{entry.name}</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{entry.artist}</div>
                  </>
                )}
                {entry.suggestedBy && (
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('gm.suggestedBy', { name: maskName(entry.suggestedBy.name) })}</div>
                )}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '2px', flexShrink: 0 }}>
                <button className="icon-btn" onClick={() => handleMoveQueueEntry(entry.id, -1)} disabled={idx === 0} title={t('gm.queueMoveUp')} style={{ opacity: idx === 0 ? 0.3 : 1 }}>
                  <ChevronUp size={16} />
                </button>
                <button className="icon-btn" onClick={() => handleMoveQueueEntry(entry.id, 1)} disabled={idx === room.songQueue.length - 1} title={t('gm.queueMoveDown')} style={{ opacity: idx === room.songQueue.length - 1 ? 0.3 : 1 }}>
                  <ChevronDown size={16} />
                </button>
                {entry.type === 'spotify' ? (
                  <button className="icon-btn" onClick={() => handlePlayQueueEntry(entry)} title={t('gm.queuePlay')} style={{ color: 'var(--neon-green)' }}>
                    <Play size={16} />
                  </button>
                ) : useSpotify && (
                  <button
                    className="icon-btn"
                    onClick={() => setResolvingQueueEntryId(prev => prev === entry.id ? null : entry.id)}
                    title={t('gm.queueResolve')}
                    style={{ color: resolvingQueueEntryId === entry.id ? 'var(--neon-purple)' : 'var(--neon-blue)' }}
                  >
                    <Search size={16} />
                  </button>
                )}
                <button className="icon-btn" onClick={() => handleRemoveQueueEntry(entry.id)} title={t('gm.queueRemove')}>
                  <X size={16} style={{ color: 'var(--neon-red)' }} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {resolvingQueueEntryId && (
        <p style={{ color: 'var(--neon-purple)', fontSize: '0.85rem', marginTop: '10px', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Search size={14} className="icon-inline" /> {t('gm.queueResolvingHint')}
        </p>
      )}
    </div>
  );

  const renderSpotifyControls = (hideIfConnected = false, isModal = false) => {
    if (!useSpotify) {
      // Own-audio mode never shows Spotify search UI, but confirmed
      // suggestions still land in the queue (see confirmSongSuggestion) and
      // the GM needs to see them to know what to go play manually - so the
      // queue itself still renders (its "play" button just marks an entry
      // as nowPlaying for reference here, with no real SDK playback).
      if (!room.nowPlaying && room.songQueue.length === 0) return null;
      return (
        <div className="panel panel--success">
          {renderSongQueue()}
        </div>
      );
    }
    if (hideIfConnected && spotifyToken) return null;

    return (
      <div className="panel panel--success">
        <h3 style={{ color: 'var(--neon-green)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.84.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.54-1.02.72-1.559.42z" />
          </svg>
          {t('spotify.integration')}
        </h3>

        {!spotifyToken ? (
          <button className="cyber-button" style={{ background: 'var(--neon-green)', color: 'black' }} onClick={() => (currentUser ? loginWithSpotifyForAccountLink() : loginWithSpotify())}>
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
                    onClick={() => (currentUser ? loginWithSpotifyForAccountLink() : loginWithSpotify())}
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
                placeholder={resolvingQueueEntryId ? t('gm.queueResolveSearchPlaceholder') : t('spotify.searchPlaceholder')}
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setSearchDone(false); }}
              />
              <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Search size={16} className="icon-inline" /> {t('spotify.search')}
              </button>
            </form>

            {searchDone && searchResults.length === 0 && (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '15px', fontSize: '0.9rem' }}>{t('spotify.noResults')}</p>
            )}

            {searchResults.length > 0 && (
              <div className="couple-list" style={{ marginTop: 0, marginBottom: '15px' }}>
                {searchResults.map(track => (
                  <div key={track.id}
                    onClick={() => handleSearchResultClick(track)}
                    className="list-item list-item--purple"
                    style={{ cursor: 'pointer' }}
                  >
                    <img src={track.album.images[2]?.url} alt="" style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{track.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{track.artists.map(a => a.name).join(', ')}</div>
                    </div>
                    <Plus size={16} className="icon-inline" style={{ color: 'var(--neon-green)', flexShrink: 0 }} />
                  </div>
                ))}
              </div>
            )}

            {gmPlaylists.length > 0 && (
              <div style={{ marginTop: '15px' }}>
                <div style={{ margin: '15px 0', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ flex: 1, height: '1px', background: 'rgba(136,146,176,0.25)' }} />
                  {t('home.or')}
                  <span style={{ flex: 1, height: '1px', background: 'rgba(136,146,176,0.25)' }} />
                </div>
                <button
                  onClick={() => setShowPlaylistPicker(v => !v)}
                  className="cyber-button"
                  style={{ background: 'transparent', border: '1px solid var(--neon-purple)', color: 'var(--neon-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
                >
                  <Music2 size={16} className="icon-inline" />
                  {t('gm.usePlaylistForDance')}
                </button>
                {showPlaylistPicker && (
                  <div className="couple-list" style={{ marginTop: '10px' }}>
                    {gmPlaylists.map(pl => (
                      <div
                        key={pl.id}
                        onClick={() => handleAddPlaylistToQueue(pl)}
                        className="list-item list-item--purple"
                        style={{ cursor: 'pointer' }}
                      >
                        <Music2 size={20} className="icon-inline" style={{ color: 'var(--neon-purple)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>
                            {pl.name}{pl.source === 'local' && <span style={{ color: 'var(--text-muted)' }}> ({t('playlists.spotifySource')})</span>}
                          </div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('playlists.trackCount', { count: pl.trackCount })}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {renderSongQueue()}
          </div>
        )}
      </div>
    );
  };

  const renderSpotifyPlaybackBar = () => {
    if (!useSpotify || !spotifyToken || !nowPlayingTrack) return null;
    return (
      <div style={{ position: 'relative', marginBottom: '20px', padding: '15px', background: 'rgba(29, 185, 84, 0.1)', border: '1px solid #1db954', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 0, height: '4px', background: '#1db954', width: `${(playbackProgress / playbackDuration) * 100}%`, transition: 'width 1s linear' }}></div>
        {nowPlayingTrack.imageUrl ? (
          <img src={nowPlayingTrack.imageUrl} alt="" style={{ width: '50px', height: '50px', borderRadius: '50%', position: 'relative', zIndex: 2 }} />
        ) : (
          <div style={{ width: '50px', height: '50px', borderRadius: '50%', position: 'relative', zIndex: 2, background: 'rgba(29,185,84,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
            <Music2 size={22} style={{ color: '#1db954' }} />
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 2 }}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white', fontWeight: 'bold' }}>{nowPlayingTrack.name}</div>
          <div style={{ fontSize: '0.8rem', color: '#1db954' }}>{t('spotify.nowPlaying')}</div>
          {nowPlayingTrack.suggestedBy && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('gm.suggestedBy', { name: maskName(nowPlayingTrack.suggestedBy.name) })}</div>
          )}
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
                if (state && state.track_window.current_track.uri === nowPlayingTrack.uri) {
                  spotifyPlayer.resume();
                } else {
                  playTrack(nowPlayingTrack.uri, spotifyPlayerId).catch(e => handleSpotifyPlaybackError(e, 'Failed to resume track'));
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
              {room.nowPlaying && room.status !== 'dancing' && (
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

      {/* SONG SUGGESTIONS - players can suggest any time, independent of phase and of the GM's own audio mode */}
      {room.songSuggestions?.length > 0 && (
        <div className="panel panel--success">
          <div className="panel-title" style={{ color: 'var(--neon-green)' }}>
            <Music2 size={16} className="icon-inline" /> {t('gm.songSuggestions')}
          </div>
          {room.songSuggestions.map(s => (
            <div key={s.id} className="list-item" style={{ marginBottom: '10px' }}>
              {s.type === 'text' ? (
                <MessageCircle size={36} className="icon-inline" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              ) : (
                <img src={s.track.album?.images?.[2]?.url} alt="" style={{ width: '36px', height: '36px', borderRadius: '4px', flexShrink: 0 }} />
              )}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.type === 'text' ? s.text : s.track.name}
                </div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {s.type === 'text' ? t('gm.suggestionTextHint') : s.track.artists?.map(a => a.name).join(', ')} · {t('gm.suggestedBy', { name: maskName(s.playerName) })}
                </div>
              </div>
              <div className="btn-row" style={{ flexShrink: 0 }}>
                <button className="cyber-button" style={{ padding: '5px 15px' }} onClick={() => handleConfirmSuggestion(s)}>{t('gm.adoptSuggestion')}</button>
                <button className="cyber-button" style={{ padding: '5px 15px', background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }} onClick={() => handleDismissSuggestion(s.id)}>{t('gm.deny')}</button>
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

          {room.spotifyDelegate && (
            <div className="panel panel--success" style={{ marginBottom: '15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'white', fontSize: '0.9rem' }}>
                <Music2 size={16} className="icon-inline" style={{ color: 'var(--neon-green)' }} />
                {t('gm.spotifyDelegateActive', { name: maskName(room.spotifyDelegate.name) })}
              </span>
              <button className="cyber-button" style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem', background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }} onClick={handleRevokeSpotifyDelegate}>
                {t('gm.spotifyDelegateRevoke')}
              </button>
            </div>
          )}

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
            <button
              className={getUnpairedPlayers().length < 2 ? "cyber-button disabled" : "cyber-button pulse-animation"}
              onClick={handleRandomPairsClick}
              disabled={getUnpairedPlayers().length < 2}
              style={{ flex: 1, opacity: getUnpairedPlayers().length < 2 ? 0.5 : 1, cursor: getUnpairedPlayers().length < 2 ? 'not-allowed' : 'pointer' }}
            >
              {t('gm.randomPairs')}
            </button>
            <button
              className={(pendingCouples.length === 0 && room.players.length === 0) ? "cyber-button disabled" : "cyber-button"}
              onClick={handleClearPairs}
              disabled={pendingCouples.length === 0 && room.players.length === 0}
              style={{ flex: 1, opacity: (pendingCouples.length === 0 && room.players.length === 0) ? 0.5 : 1, cursor: (pendingCouples.length === 0 && room.players.length === 0) ? 'not-allowed' : 'pointer' }}
            >
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
                  const excessGroup = randomizerFlow.excessType === 'lead' ? randomizerFlow.leads : randomizerFlow.follows;
                  const excessRoleName = randomizerFlow.excessType === 'lead' ? t('gm.leads') : t('gm.follows');
                  const missingRoleName = randomizerFlow.excessType === 'lead' ? t('gm.follows') : t('gm.leads');

                  const switchedCount = excessGroup.filter(p => actions[p.id] === 'switch').length;
                  const spectatorCount = excessGroup.filter(p => actions[p.id] === 'spectator').length;

                  // Recomputed live from the frozen original numbers plus
                  // whatever's already been applied in this popup, so the
                  // status panel and the continue button always reflect the
                  // GM's actual, already-live choices - not just what they
                  // will be once some later "confirm" step runs.
                  const effectiveExcess = randomizerFlow.excessCount - (2 * switchedCount) - spectatorCount;
                  const effectiveBase = randomizerFlow.baseCouplesCount + switchedCount;
                  const stillNeeded = Math.max(0, Math.ceil((effectiveExcess - effectiveBase) / 3));
                  const isResolved = stillNeeded === 0;

                  return (
                    <div>
                      <div className={`panel ${stillNeeded > 0 ? 'panel--danger' : effectiveExcess > 0 ? 'panel--info' : 'panel--success'}`}>
                        {stillNeeded > 0 ? (
                          <p style={{ margin: 0, color: 'white' }}>{t('gm.randStatusMandatory', { count: effectiveExcess, role: excessRoleName, needed: stillNeeded })}</p>
                        ) : effectiveExcess > 0 ? (
                          <p style={{ margin: 0, color: 'white' }}>{t('gm.randStatusOptional', { count: effectiveExcess, role: excessRoleName })}</p>
                        ) : (
                          <p style={{ margin: 0, color: 'white' }}>{t('gm.randStatusResolved')}</p>
                        )}
                      </div>

                      <div className="couple-list" style={{ margin: '15px 0' }}>
                        {excessGroup.map(p => {
                          const action = actions[p.id];
                          return (
                            <div key={p.id} className={`list-item ${action ? 'list-item--active' : ''}`}>
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, fontWeight: action ? 'bold' : 'normal' }}>
                                {maskName(p.name)}
                              </span>
                              {!action ? (
                                <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                  <button
                                    className="cyber-button"
                                    style={{ width: 'auto', padding: '6px 10px', fontSize: '0.8rem', border: '1px solid var(--neon-blue)', color: 'var(--neon-blue)', background: 'transparent' }}
                                    onClick={() => handlePlayerActionChange(p.id, 'switch')}
                                  >
                                    {t('gm.randSwitchTo', { role: missingRoleName })}
                                  </button>
                                  <button
                                    className="cyber-button"
                                    style={{ width: 'auto', padding: '6px 10px', fontSize: '0.8rem', border: '1px solid var(--neon-purple)', color: 'var(--neon-purple)', background: 'transparent' }}
                                    onClick={() => handlePlayerActionChange(p.id, 'spectator')}
                                  >
                                    {t('gm.randSitOut')}
                                  </button>
                                </div>
                              ) : (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                                  <span style={{ fontSize: '0.8rem', color: action === 'switch' ? 'var(--neon-blue)' : 'var(--neon-purple)' }}>
                                    {action === 'switch' ? t('gm.randStatusSwitched', { role: missingRoleName }) : t('gm.randStatusSpectating')}
                                  </span>
                                  <button className="icon-btn" title={t('gm.randUndo')} onClick={() => handlePlayerActionChange(p.id, 'none')}>
                                    <RotateCcw size={16} />
                                  </button>
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                      <div style={{ display: 'flex', gap: '10px', flexDirection: 'column' }}>
                        <button
                          className={isResolved ? "cyber-button pulse-animation" : "cyber-button disabled"}
                          onClick={() => executeMixedSelection()}
                          style={{
                            width: '100%',
                            opacity: isResolved ? 1 : 0.5,
                            cursor: isResolved ? 'pointer' : 'not-allowed',
                            ...(isResolved ? { background: 'rgba(29, 185, 84, 0.2)', border: '1px solid var(--neon-green)', color: 'var(--neon-green)' } : { border: '1px solid var(--text-muted)' })
                          }}
                          disabled={!isResolved}
                        >
                          {t('gm.randContinue')}
                        </button>
                        <button className="cyber-button danger" onClick={handleCancelRandomizerFlow} style={{ width: '100%' }}>{t('common.cancel')}</button>
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
              {room.players.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '10px 0' }}>{t('gm.nobodyJoinedYet')}</p>
              )}
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
              <div style={{ marginTop: '15px' }}>
                <label style={{ color: 'white', fontWeight: 'bold', display: 'block', marginBottom: '8px' }}>{t('gm.votingRight')}</label>
                <select className="cyber-select" value={room.votingRole} onChange={handleSetVotingRole} style={{ width: '100%' }}>
                  <option value="random">{t('gm.votingRandom')}</option>
                  <option value="lead">{t('gm.leadsOnly')}</option>
                  <option value="follow">{t('gm.followsOnly')}</option>
                </select>
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
        const isSpotifyReady = !useSpotify || (hasMusicReady && spotifyPlayer);
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
                    {!hasMusicReady ? t('gm.selectSongFirst') : t('gm.playerInitializing')}
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

              {useSpotify && nowPlayingTrack && (
                <div style={{ marginBottom: '15px' }}>
                  {!hasSongFinished ? (
                    <div className="list-item panel--success" style={{ borderColor: 'var(--neon-green)', background: 'rgba(29,185,84,0.2)' }}>
                      {nowPlayingTrack.imageUrl ? (
                        <img src={nowPlayingTrack.imageUrl} alt="" style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                      ) : (
                        <div style={{ width: '40px', height: '40px', borderRadius: '4px', background: 'rgba(29,185,84,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                          <Music2 size={18} style={{ color: 'var(--neon-green)' }} />
                        </div>
                      )}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.8rem', color: 'var(--neon-green)', textTransform: 'uppercase', fontWeight: 'bold' }}>{t('gm.currentSong')}</div>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{nowPlayingTrack.name}</div>
                        {nowPlayingTrack.suggestedBy && (
                          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('gm.suggestedBy', { name: maskName(nowPlayingTrack.suggestedBy.name) })}</div>
                        )}
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
                              if (state && state.track_window.current_track.uri === nowPlayingTrack.uri) {
                                spotifyPlayer.resume();
                              } else {
                                playTrack(nowPlayingTrack.uri, spotifyPlayerId).catch(e => handleSpotifyPlaybackError(e, 'Failed to resume track'));
                              }
                            }
                          }
                        }}
                      >
                        {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
                      </button>
                      {currentUser && (
                        <button
                          className="icon-btn"
                          title={t('gm.addToPlaylist')}
                          style={{ flexShrink: 0 }}
                          onClick={() => setAddToPlaylistFor(prev => prev === nowPlayingTrack.uri ? null : nowPlayingTrack.uri)}
                        >
                          <Plus size={18} style={{ color: 'var(--neon-purple)' }} />
                        </button>
                      )}
                    </div>
                  ) : (
                    <div className="panel panel--danger" style={{ textAlign: 'center', color: 'var(--neon-red)', fontWeight: 'bold', marginBottom: 0 }}>
                      {t('gm.songOver')}
                    </div>
                  )}

                  {currentUser && addToPlaylistFor === nowPlayingTrack.uri && (
                    <div style={{ marginTop: '10px', border: '1px solid var(--neon-purple)', borderRadius: 'var(--radius-sm)', padding: '12px' }}>
                      {accountGmPlaylists.length > 0 && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                          {accountGmPlaylists.map(pl => (
                            <button
                              key={pl.id}
                              onClick={() => handleAddTrackToPlaylist(pl.id, nowPlayingTrack)}
                              style={{ textAlign: 'left', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 12px', color: 'var(--text-main)', cursor: 'pointer', fontSize: '0.85rem' }}
                            >
                              {pl.name}
                            </button>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <input
                          type="text"
                          className="cyber-input"
                          style={{ marginBottom: 0, flex: 1, padding: '8px 12px', fontSize: '0.85rem' }}
                          placeholder={t('playlists.newNamePlaceholder')}
                          value={addToPlaylistNewName}
                          onChange={(e) => setAddToPlaylistNewName(e.target.value)}
                        />
                        <button className="cyber-button" style={{ width: 'auto', padding: '8px 14px', fontSize: '0.85rem' }} onClick={() => handleCreatePlaylistWithTrack(nowPlayingTrack)}>
                          <Plus size={14} className="icon-inline" />
                        </button>
                      </div>
                      {addToPlaylistStatus && (
                        <p style={{ color: 'var(--neon-green)', fontSize: '0.8rem', textAlign: 'center', marginTop: '8px', marginBottom: 0 }}>{addToPlaylistStatus}</p>
                      )}
                    </div>
                  )}
                </div>
              )}

              <p style={{ textAlign: 'center', color: 'white', margin: 0 }}>{t('gm.everyoneDancing')}</p>
            </div>

            {useSpotify && (
              spotifyToken ? (
                <div className="panel panel--success">
                  {renderSongQueue(false)}
                </div>
              ) : (
                // Previously this whole block just vanished with nothing to
                // click whenever spotifyToken hadn't (re)loaded yet - most
                // visibly right after a GM reload during dancing, since
                // spotifyToken always starts back at null on a fresh mount
                // and getPlaybackToken() failing here (e.g. the account-
                // linked connection actually died) has no other way to
                // surface itself mid-dancing. Always show a way to
                // (re)connect instead of silently showing nothing.
                <div className="panel panel--success" style={{ textAlign: 'center' }}>
                  <button className="cyber-button" style={{ background: 'var(--neon-green)', color: 'black' }} onClick={() => (currentUser ? loginWithSpotifyForAccountLink() : loginWithSpotify())}>
                    {t('spotify.connect')}
                  </button>
                </div>
              )
            )}

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
            {renderPlayedSongs()}
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
          {renderPlayedSongs()}
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
          {renderPlayedSongs()}
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
              {renderPlayedSongs()}
              <button className="cyber-button pulse-animation" style={{ width: '100%', marginTop: '20px' }} onClick={handleResetGame}>
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
            {renderPlayedSongs()}
            <button className="cyber-button pulse-animation" style={{ width: '100%', marginTop: '20px' }} onClick={handleResetGame}>
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
                    {members.some(m => !isManualPlayer(m)) && (
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                        {members.filter(m => !isManualPlayer(m)).map(m => (
                          <button
                            key={m.id}
                            className="cyber-button"
                            style={{ width: 'auto', padding: '6px 10px', fontSize: '0.75rem', background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}
                            onClick={() => handleSetPlayerPhoneStatus(m.id, !m.hasNoPhone)}
                          >
                            <PhoneOff size={12} className="icon-inline" />
                            {m.hasNoPhone ? t('gm.restorePhone', { name: maskName(m.name) }) : t('gm.markPhoneDead', { name: maskName(m.name) })}
                          </button>
                        ))}
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
        actionLabel={alertState?.actionLabel}
        onAction={alertState?.onAction}
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
