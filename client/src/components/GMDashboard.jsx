import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { socket } from '../socket.js';
import { ConfirmModal, AlertModal, HowToPlayModal } from './Modal.jsx';
import {
  loginWithSpotify, loginWithSpotifyForAccountLink, searchTracks, playTrack, logoutSpotify,
  getBestAvailableToken, SPOTIFY_SESSION_EXPIRED_EVENT,
} from '../spotify.js';
import { fetchMyPlaylists, fetchPlaylist, addTrackToPlaylist, createPlaylist, fetchRoomSpotifyToken, fetchRoomSpotifyPlaylists, fetchRoomSpotifyPlaylistTracks, fetchRoomDeathstepPlaylists, fetchRoomDeathstepPlaylistTracks, fetchRandomFallbackSong, disconnectSpotify } from '../spotifyPlaylists.js';
import { fetchKillerRatio } from '../admin.js';
import { getCookieConsent } from './CookieBanner.jsx';
import { useLanguage } from '../i18n.jsx';
import coupleIcon from './couple_icon.png';
import {
  MessageCircle, Crown, X, PhoneOff, Repeat, Scissors, AlertTriangle, Lightbulb,
  Music2, Skull, Sparkles, EyeOff, Eye, Check, Plus, Minus, LogOut, Flag,
  Send, UserPlus, QrCode, Play, Pause, Search, ChevronRight, Timer, Smartphone,
  ChevronUp, ChevronDown, RotateCcw, Info, HelpCircle
} from 'lucide-react';

function GMDashboard({ room, onLeave, myGmName, clientId, onSessionSecretUpdated, gmChatMessages, onSendGMChatMessage, currentUser }) {
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
  const [showHowTo, setShowHowTo] = useState(false);
  const [privacyMode, setPrivacyMode] = useState(() => {
    return localStorage.getItem('deathstep_privacy_mode') === 'true';
  });

  // gmClientId itself is never sent to any client (see gameStore.
  // sanitizeRoomForGM's comment - it's the value reconnectToRoom trusts to
  // grant full GM control, so it must never be broadcast). This dashboard is
  // only ever rendered for a confirmed GM-type socket to begin with, so "not
  // listed as a co-GM" is enough to conclude "must be the main GM" without
  // needing that value at all.
  const myCoGmEntry = room.coGms?.find(g => g.id === clientId) || null;
  const isMainGM = !myCoGmEntry;

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
  // Mirrors the raw SDK player the moment it's constructed, unlike
  // spotifyPlayer (React state) which is only ever set once the 'ready'
  // event fires - if the player's very first connect() attempt fails auth
  // (e.g. no token yet), spotifyPlayer stays null forever even though the
  // player object itself still exists and can be told to retry. See the
  // room.spotifyDelegate effect below for why that retry matters.
  const playerInstanceRef = React.useRef(null);
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);
  const [showMusicModal, setShowMusicModal] = useState(false);
  // Set whenever the GM tries to advance past a point that requires a ready
  // song (kill-reveal's skip-to-next-round shortcut, vote-reveal's continue)
  // while none is ready - opens the music modal instead of just disabling
  // the button, so picking a song (or bypassing, same link as everywhere
  // else this lock applies) happens right there instead of leaving the GM to
  // go hunt down the music panel separately. Holds the action to run once a
  // song becomes ready (or the bypass is used) - see the effect below.
  const [pendingSongRequiredAction, setPendingSongRequiredAction] = useState(null);
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
  // The room's current delegate's own Spotify playlists (see
  // server/index.js's room-scoped /spotify-playlists route) - unlike
  // gmPlaylists above (only ever the GM's own DB-backed playlists), these are
  // fetched live from Spotify since they live under the delegate's account
  // (or no account at all), which the GM has no other way to see at all.
  // source: 'delegate' distinguishes these from gmPlaylists' DB rows when the
  // two lists are merged for the queue picker (see queuePickerPlaylists).
  const [delegatePlaylists, setDelegatePlaylists] = useState([]);
  // The delegate's own Deathstep-app playlists (server/playlists.js's DB
  // table), not fetched from Spotify - covers app-only playlists (never
  // linked to a real Spotify playlist) that delegatePlaylists' live Spotify
  // fetch can never see, since they don't exist on Spotify's side at all.
  // source: 'delegateApp' distinguishes these the same way 'delegate' does.
  const [delegateAppPlaylists, setDelegateAppPlaylists] = useState([]);
  const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
  // Which text-type queue entry the search box is currently resolving a real
  // track for (see renderMusicPanel's queue list) - null means a search
  // hit just gets appended to the queue as usual.
  const [resolvingQueueEntryId, setResolvingQueueEntryId] = useState(null);
  const [addToPlaylistFor, setAddToPlaylistFor] = useState(null); // track uri whose "add to playlist" picker is expanded, or null
  const [addToPlaylistNewName, setAddToPlaylistNewName] = useState('');
  // Success (green) is shown next to "AKTUELLER SONG" instead of inside the
  // picker itself - the picker collapses (addToPlaylistFor -> null) the
  // moment a track is successfully added, so a message rendered inside it
  // would never actually be visible. A failure leaves the picker open (nothing
  // to collapse into), so its error (red) is shown right there instead.
  const [addToPlaylistStatus, setAddToPlaylistStatus] = useState('');
  const [addToPlaylistError, setAddToPlaylistError] = useState('');
  // `${playlistId}:${trackUri}` pairs the server has told us already contain
  // that track - grey the playlist out instead of letting the GM hit the
  // same "already in playlist" failure by clicking it again.
  const [alreadyInPlaylistIds, setAlreadyInPlaylistIds] = useState([]);

  // New states
  const [bypassRoleView, setBypassRoleView] = useState(false);
  const [bypassPaired, setBypassPaired] = useState(false);
  const [bypassSongReady, setBypassSongReady] = useState(false);
  // Collapses already-confirmed players out of the paired-phase list once
  // they've confirmed (couple/role) - only the still-waiting ones (the
  // actionable part of that screen) stay visible by default.
  const [showConfirmedPlayers, setShowConfirmedPlayers] = useState(false);
  const [showRoleViewedCouples, setShowRoleViewedCouples] = useState(false);

  // Manual (phoneless) player form
  const [manualPlayerName, setManualPlayerName] = useState('');
  const [manualDanceRole, setManualDanceRole] = useState('lead');
  const [manualIsFlexible, setManualIsFlexible] = useState(false);

  // Killer setting. The actual suggested/max values are derived live below
  // (totalPairedPlayers/killerRatioDivisor, half-of-players cap) - this only
  // holds the GM's own manual choice, seeded once a suggestion is available
  // (see the killerCountInitializedRef effect) so it doesn't fight further
  // manual stepper clicks on every re-render.
  const [killerCount, setKillerCount] = useState(1);
  const [killerRatioDivisor, setKillerRatioDivisor] = useState(8);
  const [killMode, setKillMode] = useState('classic');
  const [deadPlayersKeepDancing, setDeadPlayersKeepDancing] = useState(false);
  // Special roles (see SPECIAL_ROLE_KEYS in server/gameStore.js) - only
  // 'puzzle' is wired up with real behavior so far, the rest of the plan's
  // 5 roles get their own toggle here as they're built.
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [specialRoles, setSpecialRoles] = useState({ puzzle: false, martyr: false });
  const [martyrWinsOnVote, setMartyrWinsOnVote] = useState(false);

  // Dev-adjustable (see Dev Dashboard / server/admin.js's dev_settings) -
  // public read, no admin_users gate needed since every GM's dashboard uses
  // this, not just developer accounts.
  React.useEffect(() => {
    fetchKillerRatio().then(r => { if (!r.error && r.divisor) setKillerRatioDivisor(r.divisor); });
  }, []);

  // Game Settings (killer count/mode) now lives in the lobby phase, before
  // pairing happens - so room.couples is usually still empty here. Falls
  // back to a plain-pairs estimate off room.players (every joined player
  // paired 2-and-2) until real couples exist, then switches to the exact
  // figures once they do (couples can be 2 or 3 people - see the odd-excess
  // trio handling in the pairing flow - so "how many players" isn't just
  // couples.length*2 once real ones exist).
  const totalPairedPlayers = room.couples.length > 0
    ? room.couples.reduce((sum, c) => sum + c.playerIds.length, 0)
    : room.players.length;
  const suggestedKillerCount = Math.max(1, Math.round(totalPairedPlayers / killerRatioDivisor));
  // Hard rule (also enforced server-side in gameStore.startGame, which is
  // authoritative): killers must stay a strict minority of individual
  // players, not just couples - capping by couple-count alone could let a
  // majority of *people* end up killers if the couples chosen happen to be
  // the larger ones. Computed greedily (smallest couples first) to find the
  // actual highest couple-count achievable without crossing that headcount
  // line, so the stepper's max matches what the server will really allow.
  const maxKillerCouples = (() => {
    const maxKillerPlayers = Math.ceil(totalPairedPlayers / 2) - 1;
    const sizes = room.couples.length > 0
      ? room.couples.map(c => c.playerIds.length).sort((a, b) => a - b)
      : Array(Math.floor(room.players.length / 2)).fill(2);
    let count = 0, used = 0;
    for (const size of sizes) {
      if (used + size > maxKillerPlayers) break;
      used += size;
      count++;
    }
    return count;
  })();

  const killerCountInitializedRef = React.useRef(false);
  React.useEffect(() => {
    if (killerCountInitializedRef.current) return;
    if (room.players.length === 0) return; // wait until someone's actually joined
    killerCountInitializedRef.current = true;
    setKillerCount(Math.max(1, Math.min(maxKillerCouples, suggestedKillerCount)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.players.length, killerRatioDivisor]);

  // Which couples' voting-phase boxes are expanded to show their full
  // controls (meta line, GM-vote-on-behalf dropdown, kick button) - default
  // collapsed to just a name + status row, since with many couples showing
  // all of that for every single one at once was the actual source of the
  // "unübersichtlich" complaint, not any one box's own layout (already
  // reworked once - see renderTruncatedNames' voting-phase usage below).
  const [expandedVoteCoupleIds, setExpandedVoteCoupleIds] = useState(() => new Set());
  const toggleVoteCoupleExpanded = (coupleId) => setExpandedVoteCoupleIds(prev => {
    const next = new Set(prev);
    if (next.has(coupleId)) next.delete(coupleId); else next.add(coupleId);
    return next;
  });

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
  //
  // room.nowPlaying only counts while actually 'dancing' - it deliberately
  // stays populated after the round moves on (kill_reveal/voting/vote_reveal/
  // silent_report), purely so the last-played track still has something to
  // show (see server/gameStore.js's resetRoom design note) - but that leftover
  // value must never look like "a song is ready for the round that hasn't
  // started yet". Counting it unconditionally was the actual bug behind
  // "skip to next round starts with no song": the entry that had been
  // playing was already consumed out of songQueue the moment it started, so
  // once dancing ended with an empty queue, this stayed true purely off the
  // stale nowPlaying and silently skipped the song-required popup entirely.
  const hasMusicReady = (room.status === 'dancing' && !!room.nowPlaying) || room.songQueue.some(e => e.type === 'spotify');
  // !playerStatus.isError catches states the SDK's own 'ready' event can't
  // (e.g. NO_ACTIVE_DEVICE - see handleSpotifyPlaybackError - where the SDK
  // player itself reported ready, but Spotify's backend didn't actually have
  // the device available yet) - without this, spotifyPlayer being truthy
  // alone made canStart/canProceedSong true and hid the "not ready" panel
  // even while a real, GM-actionable problem was showing right below it.
  const isSpotifyReady = !useSpotify || (hasMusicReady && spotifyPlayer && !playerStatus.isError);

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
    // 'voting' itself no longer checks this (the song lock now sits in
    // 'vote_reveal' instead - see gameStore.executeVote/proceedFromVoteReveal
    // and GMDashboard's VOTE REVEAL phase block), so it's dropped here too.
    if (room.status !== 'vote_reveal' && room.status !== 'role_reveal' && room.status !== 'kill_reveal') setBypassSongReady(false);
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

  // Ensure music is paused if we leave the dancing phase - but not when the
  // whole game just ended, since the GM may well want the song to keep
  // playing for the after-party instead of being cut off by "End Game Now".
  React.useEffect(() => {
    if (room.status !== 'dancing' && room.status !== 'ended' && spotifyPlayer) {
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
    setAddToPlaylistFor(null);
    setAddToPlaylistNewName('');
    setAddToPlaylistStatus('');
    setAddToPlaylistError('');
  }, [room.round]);

  // Guards against a stale reference if the entry being resolved got removed
  // (e.g. by a co-GM) out from under the search box.
  React.useEffect(() => {
    if (resolvingQueueEntryId && !room.songQueue.some(e => e.id === resolvingQueueEntryId)) {
      setResolvingQueueEntryId(null);
    }
  }, [room.songQueue, resolvingQueueEntryId]);

  // Only a logged-in Deathstep account's own DB-backed playlists (server/
  // playlists.js) show up here - a live-browsed "whatever's on your actual
  // Spotify account" list used to be mixed in too, but during a game that's
  // redundant with the DB-backed Playlists page (which can now hold any
  // playlist via a pasted link, no Spotify connection needed) and confusing
  // to see change on every fetch, so in-game pickers only show playlists the
  // GM actually saved.
  React.useEffect(() => {
    if (!useSpotify || !currentUser) { setGmPlaylists([]); return; }
    let cancelled = false;
    (async () => {
      const result = await fetchMyPlaylists();
      if (!cancelled && !result.error) setGmPlaylists(result.playlists);
    })();
    return () => { cancelled = true; };
  }, [currentUser?.id, useSpotify]);

  // A player lending their Spotify connection to the room (see
  // room.spotifyDelegate) should make THEIR playlists usable for the dance
  // too, not just playback - otherwise the share only ever benefited the GM.
  // Keyed on the stable playerId (not the delegate object reference, which is
  // fresh on every room broadcast) so this only re-fetches on an actual
  // grant/revoke, not every broadcast - same reasoning as the spotifyToken
  // delegate effect above.
  React.useEffect(() => {
    if (!useSpotify || !room.spotifyDelegate) { setDelegatePlaylists([]); setDelegateAppPlaylists([]); return; }
    let cancelled = false;
    (async () => {
      const result = await fetchRoomSpotifyPlaylists(room.id);
      if (!cancelled && !result.error) {
        setDelegatePlaylists(result.playlists.map(pl => ({ ...pl, source: 'delegate' })));
      }
    })();
    (async () => {
      const result = await fetchRoomDeathstepPlaylists(room.id);
      if (!cancelled && !result.error) {
        setDelegateAppPlaylists(result.playlists.map(pl => ({ ...pl, source: 'delegateApp' })));
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.id, room.spotifyDelegate?.playerId, useSpotify]);

  // The queue picker ("add to dance") offers both the GM's own saved
  // playlists and the room's current delegate's playlists (their live
  // Spotify ones, and their Deathstep-app-only ones) - unlike
  // accountGmPlaylists below (used for "save this track to one of MY
  // playlists"), which must stay scoped to the GM's own account only, since
  // there's no feature here to write into someone else's Spotify playlist.
  const queuePickerPlaylists = [...gmPlaylists, ...delegatePlaylists, ...delegateAppPlaylists];

  // Whether the GM's OWN browser has a working, non-delegated Spotify
  // connection right now - mirrored onto the room (see
  // gameStore.setGmSpotifyConnected) so players can tell a share offer would
  // just be refused before even trying. Deliberately excludes a
  // delegate-sourced token (spotifyToken is still set while a delegate is
  // active) - only reports a connection this GM made themselves.
  const gmOwnSpotifyConnected = useSpotify && !room.spotifyDelegate && !!spotifyToken;
  const lastReportedGmSpotifyConnected = React.useRef(null);
  React.useEffect(() => {
    if (lastReportedGmSpotifyConnected.current === gmOwnSpotifyConnected) return;
    lastReportedGmSpotifyConnected.current = gmOwnSpotifyConnected;
    socket.emit('setGmSpotifyConnected', { roomId: room.id, connected: gmOwnSpotifyConnected });
  }, [gmOwnSpotifyConnected, room.id]);

  // Reacts to a delegate appearing or disappearing mid-session (not just at
  // mount) - without this, the GM previously had to reload the page for a
  // freshly-accepted share to actually start working, since spotifyToken was
  // otherwise only ever fetched once, at mount.
  // - Becoming active: (re)fetch through getPlaybackToken(), which now
  //   resolves through the new delegate, and explicitly retry the SDK
  //   player's connect() with it. Without this, a player instance whose very
  //   first connect() attempt failed auth (e.g. the GM had no token at all
  //   yet, before anyone shared one) would just sit on that stale
  //   'spotify.statusAuthError' status forever - the SDK doesn't retry on
  //   its own, and getOAuthToken is only ever re-invoked by the SDK's own
  //   schedule, not the moment React state changes. That left the "Retry
  //   Auth" banner showing right after a share was accepted, even though the
  //   delegate's token is perfectly valid, until a full page reload rebuilt
  //   the player from scratch.
  // - Becoming inactive: deliberately does NOT fall back to fetching the GM's
  //   own account's token, even if one exists - a share ending should fully
  //   reset the GM's playback session (disconnect the SDK player, clear the
  //   token) and require an explicit reconnect, not silently keep some other
  //   connection alive. Only fires on an actual transition (not simply never
  //   having had a delegate to begin with).
  const hadSpotifyDelegateRef = React.useRef(!!room.spotifyDelegate);
  React.useEffect(() => {
    const hadDelegate = hadSpotifyDelegateRef.current;
    hadSpotifyDelegateRef.current = !!room.spotifyDelegate;

    if (room.spotifyDelegate) {
      getPlaybackToken().then(token => {
        if (!token) return;
        setSpotifyToken(token);
        setPlayerStatus({ key: 'spotify.statusInit', detail: '', isError: false });
        playerInstanceRef.current?.connect();
      });
      return;
    }
    if (!hadDelegate) return;
    playerInstanceRef.current?.disconnect();
    playerInstanceRef.current = null;
    setSpotifyPlayer(null);
    setSpotifyPlayerId(null);
    setSpotifyToken(null);
    setPlayerStatus({ key: 'spotify.statusInit', detail: '', isError: false });
    // room.spotifyDelegate is a fresh object reference on every room
    // broadcast even when unchanged - depend on the stable playerId instead,
    // so this only re-runs on an actual grant/revoke, not every broadcast.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.spotifyDelegate?.playerId]);

  React.useEffect(() => {
    if (!spotifyPlayer || !isPlaying) return;
    const interval = setInterval(() => {
      spotifyPlayer.getCurrentState().then(state => {
        if (!state) return;
        setPlaybackProgress(state.position);
        setPlaybackDuration(state.duration);
        localStorage.setItem('deathstep_playback_state', JSON.stringify({
          position: state.position,
          duration: state.duration,
          uri: state.track_window.current_track.uri,
          timestamp: Date.now()
        }));
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [spotifyPlayer, isPlaying]);

  // Only ever treat a track as "finished" while actually dancing - leaving
  // the phase early triggers the auto-pause effect above, whose resulting
  // (async) player_state_changed can still land after room.status has
  // already moved on, and would otherwise flip this true off a paused-not-
  // finished position and wrongly show "song over" in the next phase.
  React.useEffect(() => {
    if (room.status !== 'dancing') return;
    if (playbackDuration > 0 && playbackProgress >= playbackDuration - 1500) {
      setHasSongFinished(true);
    }
  }, [playbackProgress, playbackDuration, room.status]);

  React.useEffect(() => {
    setHasSongFinished(false);
  }, [room?.nowPlaying?.uri, room?.status, room?.round]);

  // A connected token that never actually reaches the SDK's 'ready' event
  // (blocked script, dead device, etc.) used to leave the GM stuck on
  // "Player wird initialisiert..." forever with no feedback at all - flip to
  // an actionable error (with the same retry button real errors get) if
  // initializing takes unreasonably long.
  React.useEffect(() => {
    if (!useSpotify || !spotifyToken || spotifyPlayer) return;
    const timeout = setTimeout(() => {
      setPlayerStatus(prev => prev.key === 'spotify.statusInit' ? { key: 'spotify.statusTimeout', detail: '', isError: true } : prev);
    }, 12000);
    return () => clearTimeout(timeout);
  }, [useSpotify, spotifyToken, spotifyPlayer]);

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

  // Retries whichever connection actually backs this GM's playback right
  // now. While a player's lent connection (room.spotifyDelegate) is active,
  // that means re-fetching its token and handing it straight to the
  // already-created SDK player - launching the GM's own Spotify login here
  // instead would be reconnecting an entirely different account than the
  // one that's actually broken. Otherwise falls back to the account-linked
  // flow if logged into a Deathstep account (same connection as the
  // Playlists page), or the local browser-only PKCE flow.
  const handleReconnectSpotify = () => {
    if (room.spotifyDelegate) {
      getPlaybackToken().then(token => {
        if (!token) return;
        setSpotifyToken(token);
        setPlayerStatus({ key: 'spotify.statusInit', detail: '', isError: false });
        playerInstanceRef.current?.connect();
      });
      return;
    }
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
  //
  // NO_ACTIVE_DEVICE used to only ever show as a one-off alert popup at the
  // exact moment a play attempt failed - the GM had no way to see this
  // coming beforehand, and the popup itself had no fix-it action. Routed
  // through playerStatus instead (same mechanism as every other connection
  // problem - statusError/statusAuthError/statusPremium/statusTimeout), it
  // now shows up directly in the persistent status panel (wherever
  // isSpotifyReady is checked - see its `!playerStatus.isError` clause
  // below) alongside the existing Retry button, instead of needing a failed
  // click first.
  const handleSpotifyPlaybackError = (e, fallbackLog) => {
    if (e.message === 'NO_ACTIVE_DEVICE') {
      setPlayerStatus({ key: 'spotify.statusNoDevice', detail: '', isError: true });
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
      const token = await getPlaybackToken();
      await playTrack(entry.uri, token, spotifyPlayerId);
      reportTrackPlayed(entry);
    } catch (e) {
      handleSpotifyPlaybackError(e, 'Failed to play queued track');
    }
  };

  // Plays the first real (non-placeholder) track in the queue - called by
  // the round-start handlers (handleStartDancing/handleExecuteVote) so a
  // round always opens with whatever's already queued. A no-op if the queue
  // is empty or only holds unresolved text placeholders (see
  // resolveQueueTextEntry) - nothing auto-plays until the GM gives one of
  // those a real track. Deliberately NOT triggered by a song simply ending
  // mid-round - the GM decides when the next track starts (see gm.songOver
  // and the queue's manual Play button), matching the explicit request that
  // finishing a song must never by itself start another one.
  const playNextQueuedTrack = async () => {
    const nextEntry = room.songQueue.find(e => e.type === 'spotify');
    if (!nextEntry) return;
    await handlePlayQueueEntry(nextEntry);
  };

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

  // Same staleness problem as getPlaybackTokenRef above, for the 'ready'
  // listener's auto-resume-on-reload check further down: that listener is
  // wired up once per useSpotify mount and would otherwise only ever see
  // whatever room.status was at that moment, frozen, for the lifetime of the
  // player - a real bug in practice, since 'ready' doesn't only fire on a
  // genuine page reload. It also fires on every reconnect (the Retry button,
  // or a delegate share becoming active), and without this check such a
  // reconnect happening within 15s of the room having left the dancing phase
  // would auto-resume the *previous* round's track regardless of what phase
  // the game is actually in now - directly undermining the auto-pause-on-
  // leaving-dancing effect above.
  const roomStatusRef = React.useRef(room.status);
  React.useEffect(() => { roomStatusRef.current = room.status; }, [room.status]);

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
      playerInstanceRef.current = player;

      player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        setSpotifyPlayerId(device_id);
        setSpotifyPlayer(player);
        setPlayerStatus({ key: 'spotify.statusReady', detail: '', isError: false });

        // Check if we should auto-resume - only while actually still in the
        // dancing phase (see roomStatusRef above). A reconnect that lands
        // after the round already moved on must never resurrect the old
        // track just because the timing happened to line up.
        const savedPlayback = localStorage.getItem('deathstep_playback_state');
        if (savedPlayback && roomStatusRef.current === 'dancing') {
          try {
            const pb = JSON.parse(savedPlayback);
            const elapsed = Date.now() - pb.timestamp;
            // Only resume if the timestamp is less than 15s old (meaning it was a quick reload while playing)
            if (elapsed < 15000) {
              const newPosition = pb.position + elapsed;
              // The song had already reached (or would by now have reached)
              // its end - handing Spotify a position at/past the track's
              // duration doesn't just do nothing, it starts the same track
              // over from 0 (nothing else is queued in the play call for it
              // to advance into instead), which is exactly the "reload
              // restarts the song from the beginning" bug. Treat this the
              // same as any other natural end-of-song instead: reflect it as
              // finished, don't call playTrack at all.
              if (pb.duration && newPosition >= pb.duration - 1000) {
                setPlaybackProgress(pb.duration);
                setPlaybackDuration(pb.duration);
                setHasSongFinished(true);
              } else {
                getPlaybackTokenRef.current().then(token => playTrack(pb.uri, token, device_id, newPosition)).catch(e => console.error(e));
              }
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
    } else {
      const script = document.createElement('script');
      script.id = 'spotify-sdk-script';
      script.src = 'https://sdk.scdn.co/spotify-player.js';
      document.body.appendChild(script);
    }

    // Without this, leaving the room entirely (e.g. ending a game, then
    // leaving to create/join a different one) unmounts this component but
    // never tears down the SDK player - it's a real audio device that keeps
    // playing whatever was last queued, orphaned, until the GM's next game
    // happens to issue its own play() call. Since this device IS the audio
    // output (Web Playback SDK renders audio directly in this tab), the only
    // way to guarantee "no sound once you're not managing a room anymore" is
    // to disconnect it here, not merely rely on room.status-driven pausing.
    return () => {
      playerInstanceRef.current?.disconnect();
      playerInstanceRef.current = null;
    };
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
    socket.emit('startGame', { roomId: room.id, killerCount, killMode, deadPlayersKeepDancing, specialRoles, martyrWinsOnVote });
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

  // A suggested track's cover art, if any is known: a flat `imageUrl` (search-
  // mode suggestions - see PlayerScreen.jsx's handleSuggestTrack, sourced from
  // server/spotify.js's searchTracksWithToken) or the raw Spotify shape
  // (`album.images[2]`, the smallest of the three sizes Spotify returns) for
  // anything built from a raw Spotify API track object directly. A playlist-
  // mode suggestion (PlayerScreen.jsx's handleSuggestPlaylistTrack, sourced
  // from a DB-backed playlist track) has neither - playlist_tracks never
  // stored cover art - so this returns null and the caller falls back to a
  // generic icon instead of a broken <img>.
  const suggestionImageUrl = (track) => track?.imageUrl || track?.album?.images?.[2]?.url || null;

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

  // No confirm dialog: pendingVictimIds is GM-only until handleRevealKill
  // actually publishes it (see sanitizeRoomForPlayer), and marking/unmarking
  // here is freely reversible right up to that point.
  const handleReportKill = (victimCoupleId) => {
    socket.emit('reportKill', { roomId: room.id, victimId: victimCoupleId });
  };

  const handleExecuteVote = async (suspectCoupleId) => {
    const aliveCouples = room.couples.filter(c => c.status === 'alive' && c.id !== suspectCoupleId);
    const killersAlive = aliveCouples.some(c => c.role === 'killer');
    const willEnd = !killersAlive || aliveCouples.length <= 2;
    // A real vote (room.status === 'voting') now lands in 'vote_reveal' first
    // (see gameStore.executeVote) instead of 'dancing' directly - the next
    // round doesn't actually start until the GM continues from there (see
    // handleProceedFromVoteReveal), so playNextQueuedTrack must wait until
    // then too, or it would consume/start the queued track during the reveal
    // screen, before the round it belongs to has even begun. The kill-reveal
    // skip shortcut (room.status === 'kill_reveal') still goes straight to
    // 'dancing', same as before, so it still plays immediately here.
    const wasVoting = room.status === 'voting';

    socket.emit('executeVote', { roomId: room.id, suspectId: suspectCoupleId });

    if (!willEnd && !wasVoting) {
      await playNextQueuedTrack();
    }
  };

  const handleStartDancing = async () => {
    socket.emit('startDancing', { roomId: room.id });
    await playNextQueuedTrack();
  };

  // "Lied-Sperre umgehen" - the GM proceeds past the song-ready lock without
  // (or before) actually picking a track. Always queues a fresh random pick
  // - the bypass itself still always unblocks the GM immediately after,
  // exactly as before, in case both fallback sources are empty or unreachable.
  //
  // Deliberately NOT gated on hasMusicReady (whether something's already
  // queued/playing) - it used to be, which was meant to avoid double-queuing
  // when nothing was actually needed, but hasMusicReady can be true for a
  // reason that has nothing to do with THIS bypass being clicked (e.g. a
  // stale leftover queue entry from a previous round, or isSpotifyReady
  // being false for an unrelated reason like the player itself not being
  // ready even though something's technically queued) - skipping the pick in
  // that case meant an explicit "give me a random song" click could silently
  // do nothing and leave whatever was already sitting there, which is where
  // "bypassing always ends up with the same song" came from. The GM
  // explicitly asking to bypass should always get a fresh pick.
  //
  // This is deliberately the ONLY place either fallback source ever gets
  // queued - previously the GM's-own-playlist option (autoRandomSong) ran as
  // a standing background effect that fired the moment the queue was empty
  // and playlist data had loaded, regardless of whether the GM had actually
  // tried to proceed yet (could even fire while still in the lobby). Now
  // both sources only ever act here, as a direct consequence of the GM
  // explicitly choosing to proceed without a manually picked song - matching
  // the explicit request that nothing gets queued before that point.
  // Preference order when autoRandomSong is on: the GM's own connected
  // playlists first (that's what they opted into), falling back to the
  // dev-curated fallback_songs list (server/db.js) if that pick fails for
  // any reason (no playlists loaded yet, empty playlist, fetch error). The
  // bypass link itself only ever renders once per phase-visit (it disappears
  // the moment bypassSongReady flips true - see its call sites), so this can
  // never fire twice in a row and pile up duplicate queue entries.
  // Waits for the server's ack (see server/index.js's addToSongQueue handler)
  // instead of firing-and-forgetting - handleBypassSongReady below must not
  // flip bypassSongReady until the queue update has actually round-tripped,
  // or an action auto-continuing off that flag (runOnceSongReady, for the
  // kill-reveal/vote-reveal flows) can run before this client's own room
  // state has the new track in it, finding an empty queue and starting the
  // round with nothing playing - exactly what used to happen here.
  const addToSongQueueAndWait = (track) => new Promise(resolve => {
    socket.emit('addToSongQueue', { roomId: room.id, track }, () => resolve());
  });

  const handleBypassSongReady = async () => {
    let queued = false;
    if (autoRandomSong && queuePickerPlaylists.length > 0) {
      const playlist = queuePickerPlaylists[Math.floor(Math.random() * queuePickerPlaylists.length)];
      const tracks = await loadPlaylistTracks(playlist);
      if (tracks.length > 0) {
        const track = tracks[Math.floor(Math.random() * tracks.length)];
        await addToSongQueueAndWait({ uri: track.uri, name: track.name, artist: track.artist });
        queued = true;
      }
    }
    if (!queued) {
      const result = await fetchRandomFallbackSong();
      if (!result.error && result.track) {
        await addToSongQueueAndWait(result.track);
      }
    }
    setBypassSongReady(true);
  };

  const handleRevealKill = () => {
    setConfirmState({
      message: t('gm.revealKillConfirm') + (isPlaying ? '\n' + t('gm.revealKillMusicWarning') : ''),
      onConfirm: () => {
        socket.emit('revealKill', { roomId: room.id });
        // Deliberately not pausing here directly via the REST API - besides
        // being redundant with the "leave dancing" auto-pause effect (which
        // already fires once room.status moves to kill_reveal), pausing
        // through that separate REST control channel instead of the SDK
        // player's own pause() was the actual cause of a real bug: Spotify's
        // Connect state sync would then report the paused position back to
        // the SDK looking like the track had ended, wrongly tripping the
        // "song over" detection for a song that was only paused early.
      }
    });
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    try {
      const token = await getPlaybackToken();
      const results = await searchTracks(searchQuery, token);
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

  // Which playlist (from the picker) is currently showing its
  // whole/random/specific choice, and (for "specific") the loaded track list
  // to pick one from - null in both cases when no picker is expanded.
  const [playlistAddChoice, setPlaylistAddChoice] = useState(null);
  const [specificTrackPicker, setSpecificTrackPicker] = useState(null); // { playlist, tracks } | null

  const loadPlaylistTracks = async (playlist) => {
    if (playlist.source === 'delegate') {
      const result = await fetchRoomSpotifyPlaylistTracks(room.id, playlist.id);
      if (result.error) return [];
      // Spotify tracks have no DB row id - the specific-track picker below
      // keys/renders by `.id`, so use the uri (already unique per track).
      return result.tracks.map(t => ({ ...t, id: t.uri }));
    }
    if (playlist.source === 'delegateApp') {
      const result = await fetchRoomDeathstepPlaylistTracks(room.id, playlist.id);
      if (result.error) return [];
      return result.tracks;
    }
    const result = await fetchPlaylist(playlist.id);
    if (result.error) return [];
    return result.playlist.tracks;
  };

  const handleAddWholePlaylistToQueue = async (playlist) => {
    const tracks = await loadPlaylistTracks(playlist);
    if (tracks.length === 0) return;
    socket.emit('addPlaylistToSongQueue', { roomId: room.id, tracks });
    setPlaylistAddChoice(null);
    setShowPlaylistPicker(false);
  };

  const handleAddRandomTrackFromPlaylist = async (playlist) => {
    const tracks = await loadPlaylistTracks(playlist);
    if (tracks.length === 0) return;
    const track = tracks[Math.floor(Math.random() * tracks.length)];
    socket.emit('addToSongQueue', { roomId: room.id, track: { uri: track.uri, name: track.name, artist: track.artist } });
    setPlaylistAddChoice(null);
    setShowPlaylistPicker(false);
  };

  // GM-local preference: once nothing is queued or playing, automatically
  // pull a random track from one of the playlists offered above instead of
  // leaving the GM to search/pick by hand every time. A manually-built queue
  // (search results, playlist picks, player suggestions) is always consumed
  // first - this only ever fires to fill a queue that's otherwise empty.
  const [autoRandomSong, setAutoRandomSong] = useState(() => localStorage.getItem('deathstep_auto_random_song') === 'true');
  React.useEffect(() => {
    localStorage.setItem('deathstep_auto_random_song', autoRandomSong);
  }, [autoRandomSong]);

  const handleShowSpecificTrackPicker = async (playlist) => {
    const tracks = await loadPlaylistTracks(playlist);
    setSpecificTrackPicker({ playlist, tracks });
  };

  const handlePickSpecificTrack = (track) => {
    socket.emit('addToSongQueue', { roomId: room.id, track: { uri: track.uri, name: track.name, artist: track.artist } });
    setSpecificTrackPicker(null);
    setPlaylistAddChoice(null);
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
    setAddToPlaylistError('');
    let result;
    try {
      result = await addTrackToPlaylist(playlistId, { uri: track.uri, name: track.name, artist: track.artist });
    } catch (err) {
      // A thrown request (network failure, not a server-returned {error})
      // used to just vanish as an unhandled rejection - the picker sat there
      // looking unresponsive with no feedback at all. Same visible failure
      // as a server-returned error from here on.
      setAddToPlaylistError(t('gm.addToPlaylistFailed'));
      return;
    }
    if (result.error === 'track_already_in_playlist') {
      // Grey the playlist out instead of showing a generic failure message -
      // there's nothing actionable about "already there" worth interrupting for.
      setAlreadyInPlaylistIds(prev => [...prev, `${playlistId}:${track.uri}`]);
      return;
    }
    if (result.error) {
      // Left in place (not collapsed) - addToPlaylistFor is untouched here,
      // same as the already-in-playlist case above, so the GM can just retry
      // without having to reopen the picker from scratch.
      setAddToPlaylistError(t('gm.addToPlaylistFailed'));
      return;
    }

    // On a Spotify-linked playlist the track is only staged, not pushed yet -
    // say so instead of implying it's already on Spotify (confirm/undo happens on the Playlists page).
    const messageKey = result.track?.syncStatus === 'pending_add' ? 'gm.addToPlaylistPending' : 'gm.addToPlaylistSuccess';
    setAddToPlaylistStatus(t(messageKey));
    setTimeout(() => setAddToPlaylistStatus(''), 2500);
    setAddToPlaylistFor(null);

    // gmPlaylists (the queue picker's playlist list) is only ever fetched
    // once per mount - without refreshing it here, this playlist's
    // trackCount badge would keep showing its pre-add count (e.g. "0 Titel")
    // even though the track really is in it now (just not necessarily pushed
    // to Spotify yet, which is a separate, unrelated fact from whether it's
    // counted at all - the count reflects this app's own playlist, not Spotify's).
    const refreshed = await fetchMyPlaylists();
    if (!refreshed.error) setGmPlaylists(refreshed.playlists);
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

  const handleProceedToVoting = () => {
    socket.emit('proceedToVoting', { roomId: room.id });
  };

  // Named actions runOnceSongReady/its effect can dispatch to - looked up
  // fresh (by key) at the moment they actually run rather than captured as a
  // closure ahead of time. This used to take the action as a plain function,
  // stored verbatim in pendingSongRequiredAction state the instant the GM
  // clicked "skip"/"continue" - i.e. captured before the GM had picked a
  // song. Since state doesn't get "re-created" on later renders, the effect
  // below went on calling that exact stale closure (closing over the old,
  // still-empty room.songQueue/handleExecuteVote from that click) even after
  // the GM picked a track and the room updated - so playNextQueuedTrack ran
  // against a queue that, as far as that stale closure knew, was still
  // empty, and nothing ever played. Dispatching by key instead means the
  // call always uses whichever render is currently active - the fresh one,
  // with the just-picked track already in room.songQueue.
  const songRequiredActions = {
    skipToNextRound: () => handleExecuteVote(null),
    // Mirrors handleStartDancing/handleExecuteVote's own round-start pattern
    // - the round-advance event first, then hand off whatever's queued, now
    // that the round it belongs to has actually begun (see handleExecuteVote's
    // wasVoting comment for why this was deferred out of there to here).
    proceedFromVoteReveal: async () => {
      socket.emit('proceedFromVoteReveal', { roomId: room.id });
      await playNextQueuedTrack();
    },
  };

  // Runs the named action right away if a song is already ready (or already
  // bypassed), otherwise opens the music modal in "required" mode
  // (pendingSongRequiredAction) and defers it until the effect below sees the
  // lock clear - used by kill-reveal's skip-to-next-round shortcut, the one
  // remaining place that can advance straight into a dancing round from a
  // single click with no prior warning. Vote-reveal's continue button
  // deliberately does NOT go through this anymore - unlike kill-reveal's
  // shortcut it already has its own inline "not ready" panel + disabled
  // button sitting right on the page (see the VOTE REVEAL PHASE block), so
  // popping a modal on top would just be a second copy of the same message.
  const runOnceSongReady = (actionKey) => {
    if (isSpotifyReady || bypassSongReady) {
      songRequiredActions[actionKey]();
      return;
    }
    setPendingSongRequiredAction(actionKey);
    setShowMusicModal(true);
  };

  // Fires the moment the lock clears while a song-required action is
  // pending - either the GM picked a song from the modal just opened for
  // them, or used the bypass link inside it (same handleBypassSongReady as
  // everywhere else this lock applies). Reads songRequiredActions from
  // *this* render (guaranteed to be the render that saw isSpotifyReady flip
  // true, so its songRequiredActions closes over the up-to-date room).
  React.useEffect(() => {
    if (!pendingSongRequiredAction) return;
    if (isSpotifyReady || bypassSongReady) {
      const actionKey = pendingSongRequiredAction;
      setPendingSongRequiredAction(null);
      setShowMusicModal(false);
      songRequiredActions[actionKey]();
    }
  }, [isSpotifyReady, bypassSongReady, pendingSongRequiredAction]);

  const handleSkipToNextRound = () => {
    runOnceSongReady('skipToNextRound');
  };

  // No runOnceSongReady/modal here - the VOTE REVEAL PHASE button that calls
  // this is itself disabled until isSpotifyReady/bypassSongReady, with the
  // "not ready" panel + bypass link inline right above it, so this only ever
  // runs once a song is genuinely ready.
  const handleProceedFromVoteReveal = () => {
    songRequiredActions.proceedFromVoteReveal();
  };

  const handleResetGame = () => {
    if (spotifyPlayer) {
      spotifyPlayer.pause().catch(e => console.error("Failed to pause", e));
    }
    socket.emit('resetGame', { roomId: room.id });
    setPendingCouples([]);
    setCurrentGroup([]);
    setRandomizerFlow(null);
  };

  const handleEndGame = () => {
    setConfirmState({
      message: t('gm.endGameConfirm'),
      onConfirm: () => {
        // Deliberately doesn't pause the Spotify player - ending the game
        // shouldn't cut off whatever's currently playing (see the auto-pause
        // effect's 'ended' exception above).
        socket.emit('endGame', { roomId: room.id });
      }
    });
  };

  const handleChangeRole = (clientId, newRole) => {
    socket.emit('updatePlayerRole', { roomId: room.id, clientId, newRole });
  };

  // replaceExisting is only ever true when this is a re-submission from the
  // "name taken" prompt below (the GM explicitly chose to replace) - the
  // first attempt for any given name always goes through without it.
  const handleAddManualPlayer = (replaceExisting = false) => {
    const name = manualPlayerName.trim();
    if (!name) return;
    socket.emit('addManualPlayer', { roomId: room.id, playerName: name, danceRole: manualDanceRole, isFlexible: manualIsFlexible, replaceExisting }, (response) => {
      if (response.success) {
        setManualPlayerName('');
        setManualIsFlexible(false);
      } else if (response.messageKey === 'nameTaken') {
        // Give the GM an actual way forward instead of just an error: either
        // replace the existing player under this name (kicks them, same as
        // handleKickPlayer, then adds this manual entry in their place) or
        // dismiss and edit manualPlayerName - the input is left untouched
        // either way, so a rename is just a normal edit + resubmit.
        setAlertState({
          message: t('gm.nameTakenReplacePrompt', { name }),
          actionLabel: t('gm.replaceExistingPlayer'),
          onAction: () => handleAddManualPlayer(true),
        });
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

  const handleRemoveCoGM = (gmId, gmName, isSelf) => {
    setConfirmState({
      message: t(isSelf ? 'gm.stepDownConfirm' : 'gm.removeCoGmConfirm', { name: maskName(gmName) }),
      onConfirm: () => socket.emit('removeCoGM', { roomId: room.id, gmId })
    });
  };

  // Main-GM-only (server re-checks this) - steps down in favor of an
  // existing co-GM, who becomes the new main GM; this GM becomes a co-GM
  // themselves rather than losing GM status. The main GM has no stored
  // display name anywhere else (see gm.mainGmName's generic client-side
  // label), so the account's own display name (or that same generic label,
  // if not logged in) is sent along to use as this GM's new co-GM name.
  const handleHandoverGM = (targetCoGmId, targetName) => {
    setConfirmState({
      message: t('gm.handoverConfirm', { name: maskName(targetName) }),
      onConfirm: () => socket.emit('handoverGM', {
        roomId: room.id,
        targetCoGmId,
        outgoingName: currentUser?.displayName || t('gm.mainGmName'),
      }, (response) => {
        if (!response?.success) {
          setAlertState({ message: t(`server.${response?.messageKey || 'notAuthorized'}`) });
          return;
        }
        // This GM becomes a co-GM (see gameStore.handoverGM) - sanitizeRoomForGM
        // strips a co-GM's sessionSecret from the broadcast every socket
        // receives, so this ack callback is the only channel back to this
        // specific connection for it (see server/index.js's handoverGM handler).
        onSessionSecretUpdated?.(response.sessionSecret);
      })
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
  // this for any verified GM, resolved server-side from the socket itself.
  const handleRevokeSpotifyDelegate = () => {
    socket.emit('revokeSpotifyFromRoom', { roomId: room.id });
  };

  // Accepting/denying a player's offer to share their Spotify connection
  // (see server/index.js's resolveSpotifyShareRequest) - a share never takes
  // effect on its own, the GM always has to explicitly choose to use it.
  const handleResolveSpotifyShareRequest = (accept) => {
    socket.emit('resolveSpotifyShareRequest', { roomId: room.id, accept });
  };

  // Fully disconnects the GM's OWN Spotify connection (not a delegate - that
  // has its own separate revoke) - both the live browser/SDK session and,
  // for a logged-in account, the persisted account-wide link, so nothing
  // silently keeps working after this beyond what a fresh connect restores.
  // Disconnects via playerInstanceRef (not the spotifyPlayer state, which is
  // only ever set once the 'ready' event fires) - a player stuck in the
  // auth-error state from a bad token never fires 'ready', so relying on
  // state here left its device connected to Spotify with no way to close it
  // short of a page reload, even though the button claims to disconnect it.
  const handleDisconnectSpotify = async () => {
    playerInstanceRef.current?.disconnect();
    playerInstanceRef.current = null;
    setSpotifyPlayer(null);
    setSpotifyPlayerId(null);
    setSpotifyToken(null);
    setPlayerStatus({ key: 'spotify.statusInit', detail: '', isError: false });
    if (currentUser) await disconnectSpotify();
    else logoutSpotify();
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

  // Single source of truth for the unbalanced-roles popup's live state - the
  // popup itself (status panel + continue button, recomputed on every
  // render) and executeMixedSelection (the actual submit) both call this so
  // they can never disagree about whether the current switch/spectator
  // choices are actually enough. Recomputes the current lead/follow counts
  // from scratch every time, instead of tracking a running signed delta
  // against the frozen starting numbers - a signed delta silently goes
  // negative (and used to report "balanced!") the moment the GM sits out or
  // switches more people than the original excess actually required, which
  // hides a real (flipped-to-the-other-role) imbalance instead of catching
  // it - see the flipped/excessSide handling below.
  const getRandomizerStatus = (flow) => {
    const actions = flow.playerActions || {};
    const excessGroup = flow.excessType === 'lead' ? flow.leads : flow.follows;
    const missingGroupOriginal = flow.excessType === 'lead' ? flow.follows : flow.leads;
    const missingRole = flow.excessType === 'lead' ? 'follow' : 'lead';

    const stillExcess = excessGroup.filter(p => !actions[p.id]);
    const switchedIn = excessGroup.filter(p => actions[p.id] === 'switch');
    const spectatorCount = excessGroup.filter(p => actions[p.id] === 'spectator').length;
    const missingGroup = [...missingGroupOriginal, ...switchedIn];

    const excess = Math.abs(stillExcess.length - missingGroup.length);
    const base = Math.min(stillExcess.length, missingGroup.length);
    const stillNeeded = Math.max(0, Math.ceil((excess - base) / 3));
    // Which role is ACTUALLY in excess right now - can differ from
    // flow.excessType if the GM sat out/switched more people than strictly
    // needed and flipped the imbalance to the other role.
    const excessSide = stillExcess.length === missingGroup.length
      ? null
      : (stillExcess.length > missingGroup.length ? flow.excessType : missingRole);

    const flipped = excessSide !== null && excessSide !== flow.excessType;
    const exactlyBalanced = excess === 0;

    return {
      stillExcess,
      missingGroup,
      switchedCount: switchedIn.length,
      spectatorCount,
      excess,
      base,
      stillNeeded,
      isResolved: stillNeeded === 0,
      excessSide,
      flipped,
      exactlyBalanced,
      // Exact balance has zero slack left (any further switch/sit-out only
      // ever creates a new imbalance, never improves anything - there's
      // nothing left to improve) and a flip is already the wrong direction -
      // both mean acting on a still-untouched row from here is actively
      // counter-productive, not just unnecessary.
      actionsWouldHurt: flipped || exactlyBalanced,
    };
  };

  // Builds the continue button's label from the same status this popup's
  // panel is already showing, so the button always describes exactly what
  // pressing it will do in this specific scenario - a plain "Weiter" would
  // hide that a role switch is being finalized or a 3-person group is about
  // to form, and that gap is exactly what made the old fixed-signed-delta
  // math (see getRandomizerStatus above) easy to lose track of.
  const getRandomizerContinueLabel = (flow, status) => {
    if (!status.isResolved) return t('gm.randStillNeeded', { needed: status.stillNeeded });

    const parts = [];
    if (status.switchedCount === 1) {
      const actions = flow.playerActions || {};
      const excessGroup = flow.excessType === 'lead' ? flow.leads : flow.follows;
      const switchedPlayer = excessGroup.find(p => actions[p.id] === 'switch');
      parts.push(t('gm.randFragSwitchOne', { name: switchedPlayer ? maskName(switchedPlayer.name) : '' }));
    } else if (status.switchedCount > 1) {
      parts.push(t('gm.randFragSwitchMany', { count: status.switchedCount }));
    }
    if (status.excess === 1) {
      parts.push(t('gm.randFragTrioOne'));
    } else if (status.excess > 1) {
      parts.push(t('gm.randFragTrioMany', { count: status.excess }));
    } else if (parts.length > 0) {
      // No trio needed, but a switch already earned a mention above - name
      // the pairing step too instead of leaving the label sound unfinished
      // ("Rolle von X wechseln" alone). Skipped when a trio IS mentioned,
      // since forming it already implies the rest of the pairing happens
      // right along with it.
      parts.push(t('gm.randFragFormPairs'));
    }

    if (parts.length === 0) return t('gm.randContinue'); // plain fallback - nothing but sit-outs were needed
    const joined = parts.join(` ${t('gm.randFragAnd')} `);
    return joined.charAt(0).toUpperCase() + joined.slice(1);
  };

  // Spells out the GM's actual clean options FROM THE CURRENT STATE, instead
  // of leaving them to reverse-engineer it from the row buttons themselves -
  // there are always up to 3 independent ways to reach exact balance from a
  // given remaining excess E: switch as many as cleanly possible (floor(E/2) -
  // a whole E/2 with nothing left over when E is even; one fewer, with
  // exactly 1 person left over, when E is odd), sit out E people (always
  // clean, any parity), or - only once stillNeeded is already 0 - do nothing
  // further and let E people become 3rd wheels. All three are recomputed
  // fresh on every render, so they always describe "from here", accounting
  // for whatever's already been chosen. Nothing is shown once flipped (a
  // distinct, undo-based recovery - see gm.randFlippedNote) or once already
  // exactly balanced (nothing left to add).
  const getRandomizerOptions = (status) => {
    if (status.flipped || status.excess === 0) return [];
    const options = [];
    const half = Math.floor(status.excess / 2);
    if (status.excess % 2 === 0) {
      options.push(t('gm.randOptionSwitch', { count: half }));
    } else if (half > 0) {
      // Odd excess: switching floor(E/2) people is still the option that
      // gets the most people into a normal pair - it's strictly better than
      // sitting all E out. Exactly 1 person is always left over afterwards;
      // simulate that resulting state (switching grows `base` by `half`,
      // same base/excess/stillNeeded relationship as getRandomizerStatus
      // above) to say correctly whether that last person can freely join a
      // couple as a 3rd wheel, or still has to sit out.
      const remainderBase = status.base + half;
      const remainderStillNeeded = Math.max(0, Math.ceil((1 - remainderBase) / 3));
      options.push(
        remainderStillNeeded === 0
          ? t('gm.randOptionSwitchThenTrio', { count: half })
          : t('gm.randOptionSwitchThenSpectate', { count: half })
      );
    }
    options.push(t('gm.randOptionSpectate', { count: status.excess }));
    if (status.stillNeeded === 0) {
      options.push(t('gm.randOptionTrio', { count: status.excess }));
    }
    return options;
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
    // Same calculation the popup's own status panel and continue button are
    // already showing (see getRandomizerStatus above) - reusing it here
    // instead of a separately-derived check is what guarantees this can
    // never reject a state the button just claimed was ready to go (or vice
    // versa). stillNeeded > 0 should therefore never actually happen (the
    // button is disabled in that case) - the alert stays only as a defensive
    // fallback in case this is ever reachable some other way.
    const status = getRandomizerStatus(randomizerFlow);
    if (status.stillNeeded > 0) {
      setAlertState({ message: t('gm.randNotEnough') });
      return;
    }

    const missingRole = randomizerFlow.excessType === 'lead' ? 'follow' : 'lead';
    const stillExcess = status.stillExcess;
    const missingGroup = status.missingGroup.map(p =>
      p.danceRole === missingRole ? p : { ...p, danceRole: missingRole }
    );

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

    socket.emit('releasePairs', { roomId: room.id, generatedCouples: pendingCouples });
  };

  // --- Helper views ---

  const getVoteCount = (suspectCoupleId) => {
    if (!room.votes) return 0;
    return Object.values(room.votes).filter(id => id === suspectCoupleId).length;
  };

  // Only interrupts with a confirm dialog when the GM's click actually
  // overrides or second-guesses the vote (contradicts the majority, breaks a
  // tie, or kicks nobody despite a clear majority suspect) - an unambiguous
  // result (the strict-majority couple, or "kick nobody" when there's no
  // single majority to override) executes immediately.
  const handleExecuteVoteSafe = (suspectCoupleId) => {
    const aliveCouples = room.couples ? room.couples.filter(c => c.status === 'alive') : [];
    const voteCounts = aliveCouples.map(c => ({ id: c.id, votes: getVoteCount(c.id) }));
    const maxVotes = Math.max(...voteCounts.map(v => v.votes), 0);
    const topCouples = voteCounts.filter(v => v.votes === maxVotes && maxVotes > 0);

    if (suspectCoupleId === null) {
      if (topCouples.length !== 1) {
        handleExecuteVote(null);
        return;
      }
      setConfirmState({
        message: t('gm.voteWarnMajority', { name: maskName(aliveCouples.find(c => c.id === topCouples[0].id)?.name), count: maxVotes }),
        onConfirm: () => handleExecuteVote(null)
      });
      return;
    }

    if (maxVotes > 0 && topCouples.length === 1 && getVoteCount(suspectCoupleId) === maxVotes) {
      handleExecuteVote(suspectCoupleId);
      return;
    }

    const message = getVoteCount(suspectCoupleId) < maxVotes || maxVotes === 0
      ? t('gm.voteWarnNotMost', { count: getVoteCount(suspectCoupleId), max: maxVotes })
      : t('gm.voteTieBreak', { count: maxVotes });

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

  // Shared "save this track to one of my own playlists" mini-widget -
  // reused by both the dancing-phase now-playing box and the general music
  // panel's queue view below, so a GM can save a track from either place.
  // Playlists already told to contain this track (see handleAddTrackToPlaylist)
  // render disabled/greyed-out instead of being clickable into the same error again.
  const renderAddToPlaylistPicker = (track) => {
    if (!currentUser || addToPlaylistFor !== track.uri) return null;
    return (
      <div style={{ marginTop: '10px', border: '1px solid var(--neon-purple)', borderRadius: 'var(--radius-sm)', padding: '12px' }}>
        {accountGmPlaylists.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
            {accountGmPlaylists.map(pl => {
              const alreadyIn = alreadyInPlaylistIds.includes(`${pl.id}:${track.uri}`);
              return (
                <button
                  key={pl.id}
                  disabled={alreadyIn}
                  onClick={() => handleAddTrackToPlaylist(pl.id, track)}
                  style={{ textAlign: 'left', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 12px', color: alreadyIn ? 'var(--text-muted)' : 'var(--text-main)', cursor: alreadyIn ? 'not-allowed' : 'pointer', fontSize: '0.85rem', opacity: alreadyIn ? 0.5 : 1 }}
                >
                  {pl.name}{alreadyIn ? ` (${t('gm.alreadyInPlaylist')})` : ''}
                </button>
              );
            })}
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
          <button className="cyber-button" style={{ width: 'auto', padding: '8px 14px', fontSize: '0.85rem' }} onClick={() => handleCreatePlaylistWithTrack(track)}>
            <Plus size={14} className="icon-inline" />
          </button>
        </div>
        {addToPlaylistError && (
          <p style={{ color: 'var(--neon-red)', fontSize: '0.8rem', textAlign: 'center', marginTop: '8px', marginBottom: 0 }}>{addToPlaylistError}</p>
        )}
      </div>
    );
  };

  // Success confirmation for handleAddTrackToPlaylist - rendered next to
  // "AKTUELLER SONG" itself (both call sites below), not inside
  // renderAddToPlaylistPicker above: that picker collapses the instant a add
  // succeeds (addToPlaylistFor -> null), so a message placed inside it would
  // never actually be seen.
  const renderAddToPlaylistStatus = () => addToPlaylistStatus && (
    <p style={{ color: 'var(--neon-green)', fontSize: '0.8rem', textAlign: 'center', margin: '8px 0 0' }}>{addToPlaylistStatus}</p>
  );

  // The queue list itself (upcoming picks, with reorder/play/remove) - used
  // both in renderMusicPanel and in the
  // "change track" modal, so it's always the same list regardless of where
  // the GM is managing it from.
  const renderSongQueue = (showNowPlaying = true) => (
    <div style={{ marginTop: '15px' }}>
      <h4 style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>{t('gm.songQueue')}</h4>

      {/* Only ever shown while a song is actually the live pick for this
          round (room.status === 'dancing') - once the round moves on
          (voting/report/kill_reveal/etc.) or the game ends, a finished song
          has nothing left to say here and just disappears from this list
          rather than lingering as "last played". */}
      {showNowPlaying && room.nowPlaying && room.status === 'dancing' && (useSpotify && hasSongFinished ? (
        <div className="panel panel--danger" style={{ textAlign: 'center', color: 'var(--neon-red)', fontWeight: 'bold', marginBottom: '8px' }}>
          {t('gm.songOver')}
        </div>
      ) : (
        <div className="list-item panel--success" style={{ borderColor: 'var(--neon-green)', background: 'rgba(29,185,84,0.2)', marginBottom: '8px' }}>
          <Music2 size={20} className="icon-inline" style={{ color: 'var(--neon-green)', flexShrink: 0 }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '0.75rem', color: 'var(--neon-green)', textTransform: 'uppercase', fontWeight: 'bold' }}>{t('spotify.nowPlaying')}</div>
            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{room.nowPlaying.name} — {room.nowPlaying.artist}</div>
            {room.nowPlaying.suggestedBy && (
              <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>{t('gm.suggestedBy', { name: maskName(room.nowPlaying.suggestedBy.name) })}</div>
            )}
          </div>
          {currentUser && (
            <button
              className="icon-btn"
              title={t('gm.addToPlaylist')}
              style={{ flexShrink: 0 }}
              onClick={() => { setAddToPlaylistError(''); setAddToPlaylistFor(prev => prev === room.nowPlaying.uri ? null : room.nowPlaying.uri); }}
            >
              <Plus size={18} style={{ color: 'var(--neon-purple)' }} />
            </button>
          )}
        </div>
      ))}
      {showNowPlaying && room.nowPlaying && room.status === 'dancing' && renderAddToPlaylistPicker(room.nowPlaying)}
      {showNowPlaying && room.nowPlaying && room.status === 'dancing' && renderAddToPlaylistStatus()}

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
                {entry.type === 'spotify' ? (() => {
                  const notReady = room.status !== 'dancing' || (useSpotify && !spotifyPlayer);
                  return (
                    <button
                      className="icon-btn"
                      onClick={() => handlePlayQueueEntry(entry)}
                      disabled={notReady}
                      title={room.status !== 'dancing' ? t('gm.queuePlayOnlyDuringDancing') : (useSpotify && !spotifyPlayer) ? t('gm.playerInitializing') : t('gm.queuePlay')}
                      style={{ color: notReady ? 'var(--text-muted)' : 'var(--neon-green)', opacity: notReady ? 0.4 : 1, cursor: notReady ? 'not-allowed' : 'pointer' }}
                    >
                      <Play size={16} />
                    </button>
                  );
                })() : useSpotify && (
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

  // Connection-only: connect/reconnect/disconnect, negative-status only (a
  // working connection just quietly works, nothing to announce), and
  // managing an active share. Search/playlists/queue live in
  // renderMusicPanel instead - see the header's separate Spotify/Music
  // buttons.
  const renderSpotifyConnectionBox = (hideIfConnected = false) => {
    if (!useSpotify) return null;

    const showStatus = spotifyToken && playerStatus.key !== 'spotify.statusInit' && playerStatus.key !== 'spotify.statusReady';
    // Never hide a real problem just because a token exists - a stuck/errored
    // player is exactly the case a GM needs to actually see and act on.
    if (hideIfConnected && !showStatus && (spotifyToken || room.spotifyDelegate || room.songQueue.length > 0)) return null;

    return (
      <div className="panel panel--success">
        <h3 style={{ color: 'var(--neon-green)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.84.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.54-1.02.72-1.559.42z" />
          </svg>
          {t('spotify.integration')}
        </h3>

        {room.spotifyDelegate && (
          <div style={{ marginBottom: '15px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'white', fontSize: '0.9rem' }}>
                <Music2 size={16} className="icon-inline" style={{ color: 'var(--neon-green)' }} />
                {t('gm.spotifyDelegateActive', { name: maskName(room.spotifyDelegate.name) })}
              </span>
              <button className="cyber-button" style={{ width: 'auto', padding: '6px 12px', fontSize: '0.8rem', background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }} onClick={handleRevokeSpotifyDelegate}>
                {t('gm.spotifyDelegateRevoke')}
              </button>
            </div>
            {/* Escape hatch to the GM's own account instead of the shared one -
                revokes first (waiting for the server's ack, not just firing
                the emit and immediately navigating away) so getPlaybackToken()
                (which always prefers an active delegate) actually switches
                over instead of the new login just sitting unused behind a
                still-active share - a bare emit() right before
                window.location.href races the outgoing packet against the
                page unload with no guarantee it's flushed first. */}
            <button
              onClick={() => socket.emit('revokeSpotifyFromRoom', { roomId: room.id }, () => {
                (currentUser ? loginWithSpotifyForAccountLink() : loginWithSpotify());
              })}
              style={{ background: 'transparent', border: 'none', padding: 0, marginTop: '8px', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', fontSize: '0.8rem' }}
            >
              {t('gm.spotifyDelegateUseOwn')}
            </button>
          </div>
        )}

        {!spotifyToken ? (
          <>
            <button className="cyber-button" style={{ background: 'var(--neon-green)', color: 'black' }} onClick={() => (currentUser ? loginWithSpotifyForAccountLink() : loginWithSpotify())}>
              {t('spotify.connect')}
            </button>
            <p className="info-note"><Info size={13} /> {t('spotify.inviteOnlyNotice')}</p>
          </>
        ) : (
          <>
            {showStatus && (
              <div style={{ color: 'var(--text-muted)', marginBottom: '15px' }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px' }}>
                  <strong style={{ color: 'var(--neon-red)' }}>{t(playerStatus.key)}{playerStatus.detail ? ` ${playerStatus.detail}` : ''}</strong>
                  {playerStatus.isError && (
                    <button
                      className="cyber-button"
                      style={{ padding: '4px 8px', fontSize: '0.7rem', background: 'var(--neon-green)', color: 'black', minWidth: 'auto', margin: 0 }}
                      onClick={handleReconnectSpotify}
                    >
                      {t('spotify.retryAuth')}
                    </button>
                  )}
                </div>
              </div>
            )}
            {!room.spotifyDelegate && (
              <button className="cyber-button" style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }} onClick={handleDisconnectSpotify}>
                {t('spotify.disconnect')}
              </button>
            )}
          </>
        )}
      </div>
    );
  };

  // Search/playlists/queue - reachable via the header's Music button
  // regardless of phase, so managing upcoming tracks never needs to clutter
  // the main phase screen.
  const renderMusicPanel = () => {
    if (!useSpotify) {
      // Own-audio mode never shows Spotify search UI, but confirmed
      // suggestions still land in the queue (see confirmSongSuggestion) and
      // the GM needs to see them to know what to go play manually.
      if (!room.nowPlaying && room.songQueue.length === 0) {
        return <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic' }}>{t('gm.queueEmpty')}</p>;
      }
      return renderSongQueue();
    }

    if (!spotifyToken) {
      return <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>{t('gm.connectFirstForMusic')}</p>;
    }

    return (
      <div>
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

        {queuePickerPlaylists.length > 0 && (
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
            <label className="check-row" style={{ marginTop: '20px', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={autoRandomSong} onChange={(e) => setAutoRandomSong(e.target.checked)} />
              <span style={{ color: 'white' }}>{t('gm.autoRandomSong')}</span>
            </label>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '2px' }}>{t('gm.autoRandomSongHint')}</p>
            {showPlaylistPicker && (
              <div className="couple-list" style={{ marginTop: '10px' }}>
                {queuePickerPlaylists.map(pl => {
                  // Only ever true for entries sourced from delegatePlaylists/
                  // delegateAppPlaylists above, which in turn only exist while
                  // room.spotifyDelegate is set - so this list can only ever
                  // actually mix two different owners while a delegate share
                  // is active. Colored/labeled distinctly from the GM's own
                  // (still the default purple, unlabeled) so a GM with both
                  // kinds in view at once can tell them apart at a glance -
                  // read-only either way, this list only ever adds to the
                  // room's song queue (handleAddWholePlaylistToQueue etc.),
                  // never writes back to the playlist itself (see
                  // accountGmPlaylists above for the one picker that can).
                  const isDelegateOwned = pl.source === 'delegate' || pl.source === 'delegateApp';
                  const accentColor = isDelegateOwned ? 'var(--neon-blue)' : 'var(--neon-purple)';
                  return (
                    <div key={pl.id}>
                      <div
                        onClick={() => setPlaylistAddChoice(prev => (prev?.id === pl.id ? null : pl))}
                        className={`list-item ${isDelegateOwned ? 'list-item--active' : 'list-item--purple'}`}
                        style={{ cursor: 'pointer' }}
                      >
                        {pl.imageUrl ? (
                          <img src={pl.imageUrl} alt="" style={{ width: '20px', height: '20px', borderRadius: '4px', flexShrink: 0, objectFit: 'cover' }} />
                        ) : (
                          <Music2 size={20} className="icon-inline" style={{ color: accentColor, flexShrink: 0 }} />
                        )}
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{pl.name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                            {t('playlists.trackCount', { count: pl.trackCount })}
                            {/* Ownership only spelled out once there's actually
                                something to distinguish it from - a solo GM
                                with no delegate ever active sees the plain,
                                unlabeled list this always used to be. */}
                            {isDelegateOwned && ` · ${t('gm.playlistViaDelegate', { name: maskName(room.spotifyDelegate?.name || '') })}`}
                            {!isDelegateOwned && !!room.spotifyDelegate && ` · ${t('gm.playlistOwnLabel')}`}
                          </div>
                        </div>
                      </div>
                      {playlistAddChoice?.id === pl.id && (
                        <div style={{ padding: '10px', border: `1px solid ${accentColor}`, borderTop: 'none', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                          <button className="cyber-button" style={{ margin: 0, background: 'transparent', border: `1px solid ${accentColor}`, color: accentColor }} onClick={() => handleAddWholePlaylistToQueue(pl)}>
                            {t('gm.playlistAddWhole')}
                          </button>
                          <button className="cyber-button" style={{ margin: 0, background: 'transparent', border: `1px solid ${accentColor}`, color: accentColor }} onClick={() => handleAddRandomTrackFromPlaylist(pl)}>
                            {t('gm.playlistAddRandom')}
                          </button>
                          <button className="cyber-button" style={{ margin: 0, background: 'transparent', border: `1px solid ${accentColor}`, color: accentColor }} onClick={() => handleShowSpecificTrackPicker(pl)}>
                            {t('gm.playlistAddSpecific')}
                          </button>
                          {specificTrackPicker?.playlist.id === pl.id && (
                            <div className="couple-list" style={{ marginTop: '6px', maxHeight: '200px', overflowY: 'auto' }}>
                              {specificTrackPicker.tracks.length === 0 ? (
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('playlists.noTracks')}</p>
                              ) : specificTrackPicker.tracks.map(track => (
                                <div key={track.id} onClick={() => handlePickSpecificTrack(track)} className={`list-item ${isDelegateOwned ? 'list-item--active' : 'list-item--purple'}`} style={{ cursor: 'pointer' }}>
                                  <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{track.name}</div>
                                    <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{track.artist}</div>
                                  </div>
                                  <Plus size={14} className="icon-inline" style={{ color: 'var(--neon-green)', flexShrink: 0 }} />
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {renderSongQueue()}
      </div>
    );
  };

  return (
    <div className="cyber-card" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '10px 14px', marginBottom: '20px', marginTop: '20px' }}>
        <h2 style={{ color: 'var(--neon-purple)', margin: 0 }}>{t('gm.title')}</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '8px' }}>
          {/* The room code only matters for getting players in - once the
              lobby's closed it's just clutter up here (still visible to
              anyone who needs it via the "Manage team"/invite views). */}
          {room.status === 'lobby' && (
            <div className="gm-code-chip">
              <span>{t('gm.ballroomCode')}</span>
              <strong>{room.id}</strong>
            </div>
          )}

          {!isMainGM && (
            <div className="badge badge--purple" title={t('gm.youAreCoGm')}>
              <Crown size={14} className="icon-inline" /> {t('gm.coGmBadge')}
            </div>
          )}

          {/* Reduced to a bare icon (no label) so it reads as a quick toggle
              rather than a status readout - clicking it turns privacy mode
              back off directly, the same action as the "Privatsphäre aus"
              item buried in the kebab menu below. */}
          {privacyMode && (
            <button
              onClick={() => setPrivacyMode(false)}
              className="kebab-menu-btn"
              title={`${t('gm.privacyModeTitle')} - ${t('gm.privacyOff')}`}
              style={{ color: 'var(--neon-red)', background: 'rgba(255, 42, 85, 0.15)' }}
            >
              <EyeOff size={18} />
            </button>
          )}

          {/* Action toolbar - grouped so it reads as one control cluster rather
              than loose floating icons; the settings/kebab menu is visually
              separated from the live-status toggles (music/chat) by a divider
              since it opens a menu instead of a modal. Less-frequent, non-
              live-status actions (Spotify integration, couples view, team
              management) live inside that menu instead of getting their own
              top-level icon. Part of the same top-right cluster as the badges
              above (not its own row below the title) so everything GM-status-
              related lives in one place. */}
      <div className="icon-toolbar" style={{ zIndex: 100 }} ref={menuRef}>
        {(useSpotify || room.nowPlaying || room.songQueue.length > 0) && (() => {
          // Actually playing right now takes priority (white) over the
          // "still needs a song" warning (red, pulsing) - a track already
          // spinning obviously means one doesn't need to be added. Anything
          // in between (something's queued/ready but not playing this
          // instant, e.g. mid-lobby with next round's pick already made)
          // keeps the existing quieter green "ready" hint.
          const isActuallyPlaying = room.status === 'dancing' && isPlaying;
          const needsSong = !isActuallyPlaying && !hasMusicReady;
          return (
            <button
              className={`kebab-menu-btn ${needsSong ? 'pulse-animation' : ''}`}
              onClick={() => setShowMusicModal(true)}
              title={t('gm.musicPanelTitle')}
              style={{ color: isActuallyPlaying ? 'white' : needsSong ? 'var(--neon-red)' : (room.nowPlaying ? 'var(--neon-green)' : undefined) }}
            >
              <Music2 size={20} />
            </button>
          );
        })()}
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
        <div className="icon-toolbar-divider" />
        <button
          className="kebab-menu-btn"
          onClick={() => setShowMenu(!showMenu)}
          title={t('gm.menuTitle')}
        >
          <div className="kebab-dot"></div>
          <div className="kebab-dot"></div>
          <div className="kebab-dot"></div>
        </button>
        {showMenu && (
          <div className="dropdown-menu">
            <button className="dropdown-item" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => { setShowHowTo(true); setShowMenu(false); }}>
              <HelpCircle size={16} className="icon-inline" /> {t('howto.linkLabel')}
            </button>
            {useSpotify && (
              <button className="dropdown-item" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => { setShowSpotifyModal(true); setShowMenu(false); }}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" className="icon-inline" style={{ color: (spotifyToken || room.spotifyDelegate) ? 'var(--neon-green)' : undefined }}>
                  <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.84.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.54-1.02.72-1.559.42z" />
                </svg>
                {t('spotify.integration')}
              </button>
            )}
            {room.status !== 'lobby' && (
              <button className="dropdown-item" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => { setShowCouplesModal(true); setShowMenu(false); }}>
                <img src={coupleIcon} alt={t('gm.couplesAlt')} style={{ width: '16px', height: '16px' }} className="icon-inline" /> {t('gm.viewCouplesTitle')}
              </button>
            )}
            <button className="dropdown-item" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => { setShowTeamModal(true); setShowMenu(false); }}>
              <Crown size={16} className="icon-inline" /> {t('gm.manageTeam')}
            </button>
            <button className="dropdown-item" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => { setPrivacyMode(!privacyMode); setShowMenu(false); }}>
              {privacyMode ? <Eye size={16} className="icon-inline" /> : <EyeOff size={16} className="icon-inline" />}
              {privacyMode ? t('gm.privacyOff') : t('gm.privacyOn')}
            </button>
            {room.status !== 'lobby' && room.status !== 'ended' && (
              <button className="dropdown-item danger" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => { setShowMenu(false); handleEndGame(); }}>
                <Flag size={16} className="icon-inline" /> {t('gm.endGameNow')}
              </button>
            )}
            <button className="dropdown-item danger" style={{ display: 'flex', alignItems: 'center', gap: '10px' }} onClick={() => {
              setShowMenu(false);
              setConfirmState({
                // A co-GM leaving only ever removes their own co-GM seat
                // server-side (see index.js's leaveRoom) - the room keeps
                // running for everyone else, unlike the main GM leaving,
                // which ends it for the whole room. Different message/
                // label so a co-GM isn't told everyone will be removed
                // when that isn't what's about to happen.
                message: t(isMainGM ? 'gm.closeBallroomConfirm' : 'gm.leaveCoGmConfirm'), onConfirm: () => {
                  localStorage.removeItem('deathstep_selected_track');
                  if (spotifyPlayer) {
                    spotifyPlayer.pause().catch(e => console.error("Failed to pause on exit", e));
                  }
                  setPrivacyMode(false);
                  onLeave();
                }
              });
            }}>
              <LogOut size={16} className="icon-inline" /> {isMainGM ? t('gm.closeBallroom') : t('common.leave')}
            </button>
          </div>
        )}
      </div>
      {/* end of .icon-toolbar */}
        </div>
        {/* end of the title row's right-hand cluster (code chip/badges/privacy toggle/icon toolbar) */}
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

      {/* PENDING SPOTIFY SHARE REQUEST - a player's offer to lend their Spotify connection never takes effect until explicitly accepted here */}
      {room.pendingSpotifyShareRequest && (
        <div className="panel panel--success">
          <div className="panel-title" style={{ color: 'var(--neon-green)' }}>
            <Music2 size={16} className="icon-inline" /> {t('gm.spotifyShareRequested')}
          </div>
          <div className="list-item" style={{ marginBottom: '10px' }}>
            <span style={{ color: 'white' }}>{t('gm.spotifyShareRequestedBy', { name: maskName(room.pendingSpotifyShareRequest.name) })}</span>
            <div className="btn-row" style={{ flexShrink: 0 }}>
              <button className="cyber-button" style={{ padding: '5px 15px' }} onClick={() => handleResolveSpotifyShareRequest(true)}>{t('gm.accept')}</button>
              <button className="cyber-button" style={{ padding: '5px 15px', background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }} onClick={() => handleResolveSpotifyShareRequest(false)}>{t('gm.deny')}</button>
            </div>
          </div>
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
              ) : (suggestionImageUrl(s.track) ? (
                <img src={suggestionImageUrl(s.track)} alt="" style={{ width: '36px', height: '36px', borderRadius: '4px', flexShrink: 0, objectFit: 'cover' }} />
              ) : (
                // No cover art available (e.g. a playlist-picked track - see
                // suggestionImageUrl's comment) - a bare <img> with no src
                // renders as a broken-image icon, so fall back to the same
                // generic note icon the text-suggestion branch above uses.
                <Music2 size={36} className="icon-inline" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />
              ))}
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

          {renderSpotifyConnectionBox(true)}

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
              <strong style={{ color: 'var(--text-main)' }}>{t('gm.addPhonelessTitle')}</strong>
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
              <button className="cyber-button" onClick={() => handleAddManualPlayer()} disabled={!manualPlayerName.trim()} style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <UserPlus size={16} className="icon-inline" /> {t('gm.add')}
              </button>
            </div>
          </div>

          <div className="panel panel--purple" style={{ marginBottom: '20px' }}>
            <h4 style={{ color: 'var(--neon-purple)', marginBottom: '15px' }}>{t('gm.gameSettings')}</h4>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
              <label style={{ color: 'white', fontWeight: 'bold' }}>{t('gm.killerCount')}</label>
              <div className="stepper">
                <button className="stepper-btn" onClick={() => setKillerCount(Math.max(1, killerCount - 1))} disabled={killerCount <= 1} style={{ opacity: killerCount <= 1 ? 0.3 : 1, cursor: killerCount <= 1 ? 'not-allowed' : 'pointer' }}><Minus size={18} /></button>
                <span className="stepper-value">{killerCount}</span>
                <button className="stepper-btn" onClick={() => setKillerCount(Math.min(Math.max(1, maxKillerCouples), killerCount + 1))} disabled={killerCount >= Math.max(1, maxKillerCouples)} style={{ opacity: killerCount >= Math.max(1, maxKillerCouples) ? 0.3 : 1, cursor: killerCount >= Math.max(1, maxKillerCouples) ? 'not-allowed' : 'pointer' }}><Plus size={18} /></button>
              </div>
            </div>
            {killerCount !== suggestedKillerCount && (
              <p style={{ color: 'var(--neon-blue)', fontSize: '0.9rem', margin: '10px 0 0 0', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: '6px' }}>
                <Lightbulb size={14} className="icon-inline" />
                {suggestedKillerCount === 1
                  ? t('gm.killerRecSuggestedOne', { total: totalPairedPlayers })
                  : t('gm.killerRecSuggestedMany', { total: totalPairedPlayers, count: suggestedKillerCount })}
              </p>
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
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '15px', cursor: 'pointer' }}>
              <input type="checkbox" checked={deadPlayersKeepDancing} onChange={(e) => setDeadPlayersKeepDancing(e.target.checked)} />
              <span style={{ color: 'white', fontWeight: 'bold' }}>{t('gm.deadPlayersKeepDancing')}</span>
            </label>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0 24px', fontStyle: 'italic' }}>
              {t('gm.deadPlayersKeepDancingHint')}
            </p>

            <button
              onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
              style={{ background: 'transparent', border: 'none', padding: 0, marginTop: '18px', color: 'var(--neon-purple)', fontSize: '0.9rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
            >
              {showAdvancedSettings ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {t('gm.advancedSettings')}
            </button>
            {showAdvancedSettings && (
              <div style={{ marginTop: '12px', paddingTop: '12px', borderTop: '1px solid var(--border-color, rgba(255,255,255,0.1))' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!specialRoles.puzzle}
                    onChange={(e) => setSpecialRoles({ ...specialRoles, puzzle: e.target.checked })}
                  />
                  <span style={{ color: 'white', fontWeight: 'bold' }}>{t('gm.specialRolePuzzle')}</span>
                </label>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0 24px', fontStyle: 'italic' }}>
                  {t('gm.specialRolePuzzleHint')}
                </p>

                <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginTop: '14px' }}>
                  <input
                    type="checkbox"
                    checked={!!specialRoles.martyr}
                    onChange={(e) => setSpecialRoles({ ...specialRoles, martyr: e.target.checked })}
                  />
                  <span style={{ color: 'white', fontWeight: 'bold' }}>{t('gm.specialRoleMartyr')}</span>
                </label>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '4px 0 0 24px', fontStyle: 'italic' }}>
                  {t('gm.specialRoleMartyrHint')}
                </p>
                {specialRoles.martyr && (
                  <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', marginTop: '10px', marginLeft: '24px' }}>
                    <input
                      type="checkbox"
                      checked={martyrWinsOnVote}
                      onChange={(e) => setMartyrWinsOnVote(e.target.checked)}
                    />
                    <span style={{ color: 'white' }}>{t('gm.martyrWinsOnVote')}</span>
                  </label>
                )}
              </div>
            )}
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
              className={pendingCouples.length === 0 ? "cyber-button disabled" : "cyber-button"}
              onClick={handleClearPairs}
              disabled={pendingCouples.length === 0}
              style={{ flex: 1, opacity: pendingCouples.length === 0 ? 0.5 : 1, cursor: pendingCouples.length === 0 ? 'not-allowed' : 'pointer' }}
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
                  const roleLabel = (role) => role === 'lead' ? t('gm.leads') : t('gm.follows');

                  // Single source of truth (see getRandomizerStatus above) -
                  // the same calculation the continue button and
                  // executeMixedSelection use, so what's shown here can never
                  // disagree with what actually happens on submit.
                  const status = getRandomizerStatus(randomizerFlow);
                  const currentExcessRoleName = status.excessSide ? roleLabel(status.excessSide) : excessRoleName;
                  const options = getRandomizerOptions(status);

                  return (
                    <div>
                      {/* Just the raw fact (count + role, and the hard
                          minimum if any) - never prescribes HOW to fix it.
                          That used to be duplicated (and, for a lone leftover
                          person, contradicted) by the options list right
                          below, which is the one place that actually knows
                          which actions are still valid from here. */}
                      <div className={`panel ${status.stillNeeded > 0 ? 'panel--danger' : status.excess > 0 ? 'panel--info' : 'panel--success'}`}>
                        {status.stillNeeded > 0 ? (
                          <p style={{ margin: 0, color: 'white' }}>{t('gm.randStatusMandatory', { count: status.excess, role: currentExcessRoleName, needed: status.stillNeeded })}</p>
                        ) : status.excess > 0 ? (
                          <p style={{ margin: 0, color: 'white' }}>{t('gm.randStatusOptional', { count: status.excess, role: currentExcessRoleName })}</p>
                        ) : (
                          <p style={{ margin: 0, color: 'white' }}>{t('gm.randStatusResolved')}</p>
                        )}
                      </div>

                      {status.flipped && (
                        <p style={{ color: 'var(--neon-red)', fontSize: '0.85rem', margin: '4px 0 0', fontStyle: 'italic' }}>
                          {t('gm.randFlippedNote')}
                        </p>
                      )}

                      {/* Spells out every clean way to reach exact balance
                          from wherever the GM currently stands, instead of
                          leaving them to infer it from the row buttons - see
                          getRandomizerOptions above. Empty once flipped (its
                          own note above already covers that) or once already
                          exactly balanced (nothing left to add). */}
                      {options.length > 0 && (
                        <div style={{ margin: '10px 0 0', padding: '10px 14px', background: 'rgba(0,240,255,0.06)', border: '1px solid rgba(0,240,255,0.3)', borderRadius: 'var(--radius-sm)' }}>
                          <div style={{ color: 'var(--neon-blue)', fontSize: '0.8rem', fontWeight: 'bold', marginBottom: '6px' }}>{t('gm.randOptionsHeading')}</div>
                          <ul style={{ margin: 0, paddingLeft: '18px', color: 'var(--text-muted)', fontSize: '0.85rem', lineHeight: 1.6 }}>
                            {options.map((option, i) => <li key={i}>{option}</li>)}
                          </ul>
                        </div>
                      )}

                      <div className="couple-list" style={{ margin: '15px 0' }}>
                        {excessGroup.map(p => {
                          const action = actions[p.id];
                          return (
                            <div key={p.id} className={`list-item ${action ? 'list-item--active' : ''}`}>
                              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, fontWeight: action ? 'bold' : 'normal' }}>
                                {maskName(p.name)}
                              </span>
                              {!action ? (
                                status.actionsWouldHurt ? (
                                  // Either flipped (any further action from
                                  // this group only widens it) or already
                                  // exactly balanced (any further action can
                                  // only break that) - see
                                  // status.actionsWouldHurt in getRandomizerStatus.
                                  // The way back from a flip is undoing an
                                  // already-applied action below; exact
                                  // balance simply has nothing left to do.
                                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)', fontStyle: 'italic', flexShrink: 0 }}>
                                    {t('gm.randNoActionNeeded')}
                                  </span>
                                ) : (
                                  <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                                    {status.excess !== 1 && (
                                      <button
                                        className="cyber-button"
                                        style={{ width: 'auto', padding: '6px 10px', fontSize: '0.8rem', border: '1px solid var(--neon-blue)', color: 'var(--neon-blue)', background: 'transparent' }}
                                        onClick={() => handlePlayerActionChange(p.id, 'switch')}
                                      >
                                        {t('gm.randSwitchTo', { role: missingRoleName })}
                                      </button>
                                    )}
                                    <button
                                      className="cyber-button"
                                      style={{ width: 'auto', padding: '6px 10px', fontSize: '0.8rem', border: '1px solid var(--neon-purple)', color: 'var(--neon-purple)', background: 'transparent' }}
                                      onClick={() => handlePlayerActionChange(p.id, 'spectator')}
                                    >
                                      {t('gm.randSitOut')}
                                    </button>
                                  </div>
                                )
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
                          className={status.isResolved ? "cyber-button pulse-animation" : "cyber-button disabled"}
                          onClick={() => executeMixedSelection()}
                          style={{
                            width: '100%',
                            opacity: status.isResolved ? 1 : 0.5,
                            cursor: status.isResolved ? 'pointer' : 'not-allowed',
                            ...(status.isResolved ? { background: 'rgba(29, 185, 84, 0.2)', border: '1px solid var(--neon-green)', color: 'var(--neon-green)' } : { border: '1px solid var(--text-muted)' })
                          }}
                          disabled={!status.isResolved}
                        >
                          {getRandomizerContinueLabel(randomizerFlow, status)}
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
                        style={{ color: 'var(--neon-blue)', paddingTop: '8px', paddingBottom: '8px', paddingLeft: '8px', minHeight: '40px', fontSize: '0.95rem' }}
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
              {pendingCouples.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center', padding: '10px 0' }}>{t('gm.noCouplesYet')}</p>
              )}
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

          <button
            className={pendingCouples.length === 0 || randomizerFlow ? "cyber-button disabled" : "cyber-button pulse-animation"}
            onClick={handleReleasePairs}
            disabled={pendingCouples.length === 0 || randomizerFlow}
            style={{ width: '100%', opacity: pendingCouples.length === 0 || randomizerFlow ? 0.5 : 1, cursor: pendingCouples.length === 0 || randomizerFlow ? 'not-allowed' : 'pointer' }}
          >
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
            {renderSpotifyConnectionBox(true)}

            <h3 style={{ color: 'var(--neon-purple)', marginBottom: '5px' }}>{t('gm.waitingConfirmations')}</h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '15px', fontSize: '0.9rem' }}>{t('gm.waitingConfirmationsBody')}</p>
            {(() => {
              const renderPlayerRow = (p) => {
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
              };
              const waitingPlayers = pairedPlayers.filter(p => !p.isConfirmed);
              const confirmedPlayers = pairedPlayers.filter(p => p.isConfirmed);
              return (
                <>
                  <div className="couple-list" style={{ marginBottom: confirmedPlayers.length > 0 ? '10px' : '20px' }}>
                    {waitingPlayers.map(renderPlayerRow)}
                  </div>
                  {confirmedPlayers.length > 0 && (
                    <>
                      <button
                        onClick={() => setShowConfirmedPlayers(v => !v)}
                        className="collapse-toggle"
                        style={{ marginBottom: '10px' }}
                      >
                        {showConfirmedPlayers ? <ChevronUp size={14} className="icon-inline" /> : <ChevronDown size={14} className="icon-inline" />}
                        {t('gm.confirmedPlayersToggle', { count: confirmedPlayers.length })}
                      </button>
                      {showConfirmedPlayers && (
                        <div className="couple-list" style={{ marginTop: 0, marginBottom: '20px' }}>
                          {confirmedPlayers.map(renderPlayerRow)}
                        </div>
                      )}
                    </>
                  )}
                </>
              );
            })()}

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
        const canProceedSong = isSpotifyReady || bypassSongReady;
        const canStart = (allCouplesViewedRole || bypassRoleView) && canProceedSong;

        return (
          <div className="phase-enter" style={{ marginBottom: '20px' }}>
            {renderSpotifyConnectionBox(true)}

            <div style={{ textAlign: 'center' }}>
              <h3 style={{ color: 'var(--neon-blue)', marginBottom: '15px' }}>{t('gm.rolesRevealed')}</h3>

              {!isSpotifyReady && (
                <div className="panel panel--danger">
                  <strong style={{ color: 'var(--neon-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><AlertTriangle size={16} className="icon-inline" /> {t('gm.musicNotReady')}</strong><br />
                  <span style={{ color: 'white' }}>
                    {!hasMusicReady ? t('gm.selectSongFirst') : `${t(playerStatus.key)}${playerStatus.detail ? ` ${playerStatus.detail}` : ''}`}
                  </span>
                  {hasMusicReady && playerStatus.isError && (
                    <div>
                      <button
                        onClick={handleReconnectSpotify}
                        className="cyber-button"
                        style={{ marginTop: '10px', width: 'auto', padding: '6px 14px', fontSize: '0.85rem', background: 'var(--neon-green)', color: 'black' }}
                      >
                        {t('spotify.retryAuth')}
                      </button>
                    </div>
                  )}
                  {!bypassSongReady && (
                    <div>
                      <button
                        onClick={handleBypassSongReady}
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

              {(() => {
                const renderCoupleRow = (couple, hasViewed) => {
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
                };
                const withViewed = aliveCouples.map(couple => ({
                  couple,
                  hasViewed: couple.playerIds.some(id => {
                    const player = room.players.find(p => p.id === id);
                    return player && player.hasViewedRole;
                  })
                }));
                const waiting = withViewed.filter(x => !x.hasViewed);
                const viewed = withViewed.filter(x => x.hasViewed);
                return (
                  <>
                    <div className="couple-list" style={{ marginBottom: viewed.length > 0 ? '10px' : '20px', textAlign: 'left' }}>
                      {waiting.map(x => renderCoupleRow(x.couple, x.hasViewed))}
                    </div>
                    {viewed.length > 0 && (
                      <>
                        <button
                          onClick={() => setShowRoleViewedCouples(v => !v)}
                          className="collapse-toggle"
                          style={{ marginBottom: '10px' }}
                        >
                          {showRoleViewedCouples ? <ChevronUp size={14} className="icon-inline" /> : <ChevronDown size={14} className="icon-inline" />}
                          {t('gm.confirmedPlayersToggle', { count: viewed.length })}
                        </button>
                        {showRoleViewedCouples && (
                          <div className="couple-list" style={{ marginTop: 0, marginBottom: '20px', textAlign: 'left' }}>
                            {viewed.map(x => renderCoupleRow(x.couple, x.hasViewed))}
                          </div>
                        )}
                      </>
                    )}
                  </>
                );
              })()}

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
                    <div className="list-item panel--success" style={{ position: 'relative', borderColor: 'var(--neon-green)', background: 'rgba(29,185,84,0.2)', overflow: 'hidden' }}>
                      <div style={{ position: 'absolute', bottom: 0, left: 0, height: '3px', background: 'var(--neon-green)', width: `${Math.min(100, (playbackProgress / playbackDuration) * 100)}%`, transition: 'width 1s linear' }}></div>
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
                                getPlaybackToken().then(token => playTrack(nowPlayingTrack.uri, token, spotifyPlayerId)).catch(e => handleSpotifyPlaybackError(e, 'Failed to resume track'));
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
                          onClick={() => { setAddToPlaylistError(''); setAddToPlaylistFor(prev => prev === nowPlayingTrack.uri ? null : nowPlayingTrack.uri); }}
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

                  {renderAddToPlaylistPicker(nowPlayingTrack)}
                  {renderAddToPlaylistStatus()}
                </div>
              )}

              {/* Once the song's over there's nothing left to secretly dance/kill
                  to - repeating "everyone's dancing, killers can eliminate now"
                  right above the already-shown "Song vorbei" panel is actively
                  misleading about what's still possible this instant. */}
              {!hasSongFinished && (
                <p style={{ textAlign: 'center', color: 'white', margin: 0 }}>{t('gm.everyoneDancing')}</p>
              )}
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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', color: 'var(--text-muted)', marginBottom: '5px' }}>
                  <strong>{t('gm.markKilled')}</strong>
                  <span style={{ color: 'var(--neon-purple)', flexShrink: 0 }}>{t('gm.markedCount', { marked: markedCount, total: aliveKillerCount })}</span>
                </div>

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
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', color: 'var(--text-muted)', marginBottom: '5px' }}>
                  <strong>{t('gm.markKilled')}</strong>
                  <span style={{ color: 'var(--neon-purple)', flexShrink: 0 }}>{t('gm.markedCount', { marked: markedCount, total: aliveKillerCount })}</span>
                </div>

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
                  {t('gm.revealKillBtnSilent')}
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* KILL REVEAL PHASE */}
      {room.status === 'kill_reveal' && (() => {
        const victimCouples = (room.victimIds || []).map(id => room.couples.find(c => c.id === id)).filter(Boolean);
        // No longer disabled while no song is ready - clicking it now opens
        // the music modal in "required" mode instead (see runOnceSongReady/
        // handleSkipToNextRound), same bypass link as everywhere else this
        // lock applies, just reached through a popup instead of a dead button.
        return (
          <div className="phase-enter" style={{ marginBottom: '20px', textAlign: 'center' }}>
            <h3 style={{ color: 'var(--neon-purple)', marginBottom: '15px' }}>{t('gm.killRevealed')}</h3>
            {victimCouples.length > 0 ? (
              <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Skull size={20} className="icon-inline" /> <strong>{t('player.wereEliminated', { names: victimCouples.map(c => maskName(c.name)).join(' & ') })}</strong>
              </p>
            ) : (
              <p style={{ color: 'var(--neon-blue)', fontSize: '1.2rem', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Sparkles size={20} className="icon-inline" /> {t('gm.nobodyEliminated')}
              </p>
            )}
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '20px' }}>{t('gm.killRevealedBody')}</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <button className="cyber-button pulse-animation" onClick={handleProceedToVoting} style={{ width: '100%', fontSize: '1.2rem', padding: '15px' }}>
                {t('gm.proceedVoting')}
              </button>
              <button
                className="cyber-button"
                onClick={handleSkipToNextRound}
                style={{ width: '100%', background: 'transparent', color: 'var(--text-muted)' }}
              >
                {t('gm.skipToNextRound')}
              </button>
            </div>
          </div>
        );
      })()}

      {/* VOTING PHASE */}
      {room.status === 'voting' && (() => {
        return (
        <div className="phase-enter" style={{ marginBottom: '20px' }}>
          <h3 style={{ color: 'var(--neon-purple)', marginBottom: '5px' }}>{t('gm.votingPhase')}</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '10px', fontSize: '0.9rem' }}>{t('gm.votingPhaseBody')}</p>
          {room.votingEndTime && (
            <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
              <Timer size={14} className="icon-inline" />
              {gmVotingTimeLeft > 0
                ? t('gm.votingTimeLeft', { seconds: gmVotingTimeLeft })
                : t('gm.votingTimeUp')}
            </p>
          )}
          <div className="couple-list">
            {aliveCouples.map(couple => {
              const hasVoted = Object.keys(room.votes || {}).includes(couple.id);
              const needsGmVote = !hasVoted && isCoupleFullyPhoneless(couple);
              const suspectOptions = aliveCouples.filter(c => c.id !== couple.id);
              const votingPlayer = couple.votingPlayerId ? room.players.find(p => p.id === couple.votingPlayerId) : null;
              const isExpanded = expandedVoteCoupleIds.has(couple.id);
              return (
                // Collapsed to just a name + status row by default - with
                // several couples, showing every box's full meta line, GM-
                // override controls and a full-width kick button all at once
                // (the previous version of this) was itself the source of
                // the "unübersichtlich" complaint, independent of any one
                // box's own internal spacing (already reworked once). Tap a
                // row to reveal its controls; collapsed rows already show
                // everything needed to scan who's voted at a glance.
                <div key={couple.id} className="panel panel--purple" style={{ display: 'flex', flexDirection: 'column', gap: isExpanded ? '10px' : 0, marginBottom: 0, minWidth: 0 }}>
                  <div
                    onClick={() => toggleVoteCoupleExpanded(couple.id)}
                    style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', minWidth: 0, cursor: 'pointer' }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, flex: 1 }}>
                      {isExpanded ? <ChevronUp size={16} className="icon-inline" style={{ color: 'var(--text-muted)', flexShrink: 0 }} /> : <ChevronDown size={16} className="icon-inline" style={{ color: 'var(--text-muted)', flexShrink: 0 }} />}
                      {renderTruncatedNames(couple.name)}
                      {/* Phone/no-phone status inline as a bare icon (detail
                          in the title tooltip) rather than its own labelled
                          line - it's just one more at-a-glance fact about the
                          couple, same weight as the badges to the right. */}
                      {votingPlayer ? (
                        <Smartphone size={14} className="icon-inline" style={{ color: 'var(--text-muted)', flexShrink: 0 }} title={`${t('gm.votingByLabel')} ${maskName(votingPlayer.name)}`} />
                      ) : (
                        <PhoneOff size={14} className="icon-inline" style={{ color: 'var(--text-muted)', flexShrink: 0 }} title={t('gm.nobodyAssigned')} />
                      )}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                      <span className={`badge ${hasVoted ? 'badge--blue' : 'badge--muted'}`}>
                        {hasVoted ? t('gm.voted') : t('gm.waitingBadge')}
                      </span>
                      <span className="badge badge--purple">{getVoteCount(couple.id)} {t('gm.votes')}</span>
                    </div>
                  </div>
                  {isExpanded && (
                    <>
                      {needsGmVote && (
                        <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', paddingTop: '10px', borderTop: '1px solid rgba(181, 43, 255, 0.2)' }}>
                          {/* Picking an option casts the vote immediately -
                              no separate confirm button. value is hardcoded
                              back to "" every render so the select always
                              shows the placeholder again right after (the
                              row's needsGmVote also flips false and this
                              whole block disappears once the vote lands). */}
                          <select
                            className="cyber-select"
                            style={{ flex: '1 1 150px' }}
                            value=""
                            onChange={(e) => { if (e.target.value) handleGmCastVote(couple.id, e.target.value); }}
                          >
                            <option value="">{t('gm.chooseSuspect')}</option>
                            {suspectOptions.map(s => (
                              <option key={s.id} value={s.id}>{maskName(s.name)}</option>
                            ))}
                          </select>
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
                        className="cyber-button danger"
                        style={{ padding: '8px', fontSize: '0.9rem', marginTop: needsGmVote ? 0 : '4px' }}
                        onClick={() => handleExecuteVoteSafe(couple.id)}
                      >
                        {t('gm.kickNextRound')}
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
          <button
            className="cyber-button"
            style={{ marginTop: '15px' }}
            onClick={() => handleExecuteVoteSafe(null)}
          >
            {t('gm.tieKickNobody')}
          </button>
        </div>
        );
      })()}

      {/* VOTE REVEAL PHASE - between 'voting' and the next 'dancing' round;
          see gameStore.executeVote's 'voting' branch. The song-ready lock
          that used to sit in the voting phase above lives here now: casting/
          concluding the vote itself never needed a song, only actually
          starting the next round does. Shown inline (same pattern as the
          ROLE REVEAL PHASE's danger panel above) rather than as a popup that
          pops itself open - the GM should see "music not ready" and the
          bypass link sitting right here on the page, not have to trigger an
          action first to discover it. */}
      {room.status === 'vote_reveal' && (() => {
        const votedOutCouple = room.voteResult?.votedOutCoupleId
          ? room.couples.find(c => c.id === room.voteResult.votedOutCoupleId)
          : null;
        const canProceedSong = isSpotifyReady || bypassSongReady;
        return (
          <div className="phase-enter" style={{ marginBottom: '20px', textAlign: 'center' }}>
            <h3 style={{ color: 'var(--neon-purple)', marginBottom: '15px' }}>{t('gm.voteRevealTitle')}</h3>
            {votedOutCouple ? (
              <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Skull size={20} className="icon-inline" /> <strong>{t('gm.wasVotedOut', { name: maskName(votedOutCouple.name) })}</strong>
              </p>
            ) : (
              <p style={{ color: 'var(--neon-blue)', fontSize: '1.2rem', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Sparkles size={20} className="icon-inline" /> {t('gm.nobodyVotedOut')}
              </p>
            )}

            {!isSpotifyReady && (
              <div className="panel panel--danger" style={{ marginBottom: '15px' }}>
                <strong style={{ color: 'var(--neon-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><AlertTriangle size={16} className="icon-inline" /> {t('gm.musicNotReady')}</strong><br />
                <span style={{ color: 'white' }}>
                  {!hasMusicReady ? t('gm.selectSongNextRound') : `${t(playerStatus.key)}${playerStatus.detail ? ` ${playerStatus.detail}` : ''}`}
                </span>
                {hasMusicReady && playerStatus.isError && (
                  <div>
                    <button
                      onClick={handleReconnectSpotify}
                      className="cyber-button"
                      style={{ marginTop: '10px', width: 'auto', padding: '6px 14px', fontSize: '0.85rem', background: 'var(--neon-green)', color: 'black' }}
                    >
                      {t('spotify.retryAuth')}
                    </button>
                  </div>
                )}
                {!bypassSongReady && (
                  <div>
                    <button
                      onClick={handleBypassSongReady}
                      style={{ marginTop: '10px', background: 'transparent', border: 'none', color: 'var(--neon-red)', textDecoration: 'underline', cursor: 'pointer' }}
                    >
                      {t('gm.bypassSongReady')}
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              className={canProceedSong ? "cyber-button pulse-animation" : "cyber-button disabled"}
              onClick={handleProceedFromVoteReveal}
              disabled={!canProceedSong}
              style={{ width: '100%', fontSize: '1.2rem', padding: '15px', opacity: canProceedSong ? 1 : 0.5, cursor: canProceedSong ? 'pointer' : 'not-allowed' }}
            >
              {t('gm.continueToNextRound')}
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
            <h3 style={{ marginBottom: '10px', color: 'var(--neon-purple)', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Crown size={20} className="icon-inline" /> {t('gm.manageTeamTitle')}
            </h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '20px', fontStyle: 'italic' }}>
              {isMainGM ? t('gm.youAreMainGm') : t('gm.youAreCoGm')}
            </p>

            <h4 style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>{t('gm.currentCoGms')} ({room.coGms?.length || 0})</h4>
            <div className="couple-list" style={{ marginBottom: '25px' }}>
              {(room.coGms || []).length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('gm.noCoGms')}</p>
              )}
              {(room.coGms || []).map(gm => {
                const isSelf = gm.id === clientId;
                const canRemove = isMainGM || isSelf;
                return (
                  <div key={gm.id} className="list-item list-item--purple">
                    <span style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      <Crown size={15} className="icon-inline" /> {maskName(gm.name)}{isSelf ? ` (${t('gm.you')})` : ''}
                    </span>
                    <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                      {isMainGM && (
                        <button
                          onClick={() => handleHandoverGM(gm.id, gm.name)}
                          className="icon-btn"
                          title={t('gm.handoverBtn')}
                        >
                          <Repeat size={16} />
                        </button>
                      )}
                      {canRemove && (
                        <button
                          onClick={() => handleRemoveCoGM(gm.id, gm.name, isSelf)}
                          className="icon-btn danger"
                          title={isSelf ? t('gm.stepDownTitle') : t('gm.revokeGmTitle')}
                        >
                          <X size={18} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            <h4 style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>{t('gm.promoteHeader')}</h4>
            {!isMainGM ? (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('gm.promoteMainGmOnly')}</p>
            ) : room.status !== 'lobby' ? (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('gm.promoteLobbyOnly')}</p>
            ) : (
              <div className="couple-list">
                {room.players.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('gm.noPlayers')}</p>
                )}
                {/* Only players who actually have a phone can be promoted (see
                    handlePromoteToGM/PhoneOff above) - a hasNoPhone player was
                    previously still listed here, just greyed out with a "no
                    phone" badge instead of a promote button; that clutters the
                    list with entries nobody can ever act on, so they're
                    filtered out entirely instead. */}
                {room.players.length > 0 && room.players.every(p => p.hasNoPhone) && (
                  <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('gm.noPromotablePlayers')}</p>
                )}
                {room.players.filter(p => !p.hasNoPhone).map(p => (
                  <div key={p.id} className="list-item">
                    <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{maskName(p.name)}</span>
                    <button
                      className="cyber-button"
                      style={{ padding: '10px 14px', minHeight: '40px', fontSize: '0.85rem', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '6px' }}
                      onClick={() => handlePromoteToGM(p.id, p.name)}
                    >
                      <Crown size={14} className="icon-inline" /> {t('gm.promoteBtn', { name: maskName(p.name) })}
                    </button>
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

      <HowToPlayModal isOpen={showHowTo} onClose={() => setShowHowTo(false)} />

      {showSpotifyModal && createPortal(
        <div className="modal-overlay" onClick={() => setShowSpotifyModal(false)}>
          {/* .modal-card normally stretches to fill the overlay (up to
              max-width) since most modals here have enough content to want
              that - this one's content (an icon, a title, one button) is far
              narrower, so width: 'fit-content' overrides that stretch to
              shrink-wrap the card to what's actually in it instead of
              leaving a wide empty gap between the button and the X.
              .modal-close-btn (top/right: 12px) sits inside .cyber-card's
              own 24px padding, which every OTHER modal absorbs harmlessly
              because they open with a plain heading there - this one's
              content is renderSpotifyConnectionBox's own bordered
              panel--success box starting immediately at the content edge,
              so at the default 24px padding the close button's 40px circle
              physically overlapped its top-right corner once the card no
              longer had extra unused width to hide that in. Bumping just
              this card's top/right padding clears the button's footprint
              (12px inset + 40px circle ≈ 52px from the edge) instead. */}
          <div className="modal-card cyber-card" style={{ width: 'fit-content', maxWidth: '500px', border: '1px solid var(--neon-green)', paddingTop: '56px', paddingRight: '56px' }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => setShowSpotifyModal(false)}
              className="icon-btn modal-close-btn"
            >
              <X size={20} />
            </button>
            {renderSpotifyConnectionBox(false)}
          </div>
        </div>,
        document.body
      )}

      {showMusicModal && createPortal(
        <div className="modal-overlay" onClick={() => { setShowMusicModal(false); setPendingSongRequiredAction(null); }}>
          <div className="modal-card cyber-card" style={{ maxWidth: '600px', border: '1px solid var(--neon-purple)' }} onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => { setShowMusicModal(false); setPendingSongRequiredAction(null); }}
              className="icon-btn modal-close-btn"
            >
              <X size={20} />
            </button>
            <h3 style={{ color: 'var(--neon-purple)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Music2 size={20} className="icon-inline" /> {t('gm.musicPanelTitle')}
            </h3>
            {/* Only shown when this modal was opened because an action needed
                a ready song (see runOnceSongReady) - same lock/bypass
                messaging used inline everywhere else it applies. Picking a
                song below (or the bypass link here) resolves it automatically
                via the effect next to runOnceSongReady - no separate confirm
                needed in here. */}
            {pendingSongRequiredAction && !isSpotifyReady && (
              <div className="panel panel--danger" style={{ textAlign: 'center', marginBottom: '15px' }}>
                <strong style={{ color: 'var(--neon-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><AlertTriangle size={16} className="icon-inline" /> {t('gm.musicNotReady')}</strong><br />
                <span style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>{t('gm.selectSongNextRound')}</span>
                {!bypassSongReady && (
                  <div>
                    <button
                      onClick={handleBypassSongReady}
                      style={{ marginTop: '10px', background: 'transparent', border: 'none', color: 'var(--neon-red)', textDecoration: 'underline', cursor: 'pointer' }}
                    >
                      {t('gm.bypassSongReady')}
                    </button>
                  </div>
                )}
              </div>
            )}
            {renderMusicPanel()}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}

export default GMDashboard;
