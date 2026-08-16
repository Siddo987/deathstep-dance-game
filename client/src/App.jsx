import React, { useState, useEffect, useRef, Suspense, lazy } from 'react';
import { socket } from './socket.js';
import Home from './components/Home.jsx';
import CookieBanner from './components/CookieBanner.jsx';
import { AlertModal, ConfirmModal } from './components/Modal.jsx';
import { AuthModal } from './components/Auth.jsx';
import { fetchMe, logout as logoutRequest } from './auth.js';
import { useLanguage } from './i18n.jsx';
import { usePathname, navigate } from './router.jsx';

// A dynamic import() rejects if the chunk fails to load - by far the most
// common real-world cause is a tab that's been open since before the last
// deploy, whose already-loaded index.html still references a chunk hash
// that got replaced/removed by the newer build. Reloading fetches the
// current index.html (and therefore the current, correct hashes), which
// fixes that case outright - retried at most once per page load (the
// sessionStorage flag), so a chunk that's still unreachable after a reload
// (a real network/server problem, not a stale-hash problem) fails through to
// ErrorBoundary (see main.jsx) instead of reloading forever.
const CHUNK_RELOAD_FLAG = 'deathstep_chunk_reload_attempted';

function lazyWithRetry(importFn) {
  return lazy(async () => {
    try {
      const module = await importFn();
      // A later chunk load (a different lazy route, possibly long after
      // whatever the flag below was set for) succeeding means this tab is
      // caught up again - clear it so a *future* failure still gets its own
      // one-time reload instead of silently skipping straight to
      // ErrorBoundary just because some earlier, unrelated failure already
      // used up the retry once this session.
      try { sessionStorage.removeItem(CHUNK_RELOAD_FLAG); } catch (e) { /* sessionStorage unavailable */ }
      return module;
    } catch (err) {
      // A dynamic import() rejects if the chunk fails to load - by far the
      // most common real-world cause is a tab that's been open since before
      // the last deploy, whose already-loaded index.html still references a
      // chunk hash that got replaced/removed by the newer build. Reloading
      // fetches the current index.html (and therefore the current, correct
      // hashes), which fixes that case outright - retried at most once per
      // failure episode, so a chunk that's still unreachable after a reload
      // (a real network/server problem, not a stale-hash problem) fails
      // through to ErrorBoundary (see main.jsx) instead of reloading forever.
      let alreadyRetried = true;
      try { alreadyRetried = !!sessionStorage.getItem(CHUNK_RELOAD_FLAG); } catch (e) { /* sessionStorage unavailable */ }
      if (!alreadyRetried) {
        try { sessionStorage.setItem(CHUNK_RELOAD_FLAG, '1'); } catch (e) { /* sessionStorage unavailable */ }
        window.location.reload();
        return new Promise(() => {}); // reload takes over; never resolves
      }
      throw err;
    }
  });
}

// Code-split everything below Home - each of these is only ever needed on
// one specific route/view, but before this they were all bundled (and
// downloaded+parsed by every visitor, on every page, including the plain
// homepage) into a single ~930KB JS chunk. GMDashboard alone is 4000+ lines.
// Home/CookieBanner/Modal/Auth above stay eager since they're on screen (or
// about to be) for essentially every visit.
const GMDashboard = lazyWithRetry(() => import('./components/GMDashboard.jsx'));
const PlayerScreen = lazyWithRetry(() => import('./components/PlayerScreen.jsx'));
const Feedback = lazyWithRetry(() => import('./components/Feedback.jsx'));
const Datenschutz = lazyWithRetry(() => import('./components/Datenschutz.jsx'));
const Impressum = lazyWithRetry(() => import('./components/Impressum.jsx'));
const Stats = lazyWithRetry(() => import('./components/Stats.jsx'));
const Settings = lazyWithRetry(() => import('./components/Settings.jsx'));
const ResetPassword = lazyWithRetry(() => import('./components/ResetPassword.jsx'));
const Leaderboard = lazyWithRetry(() => import('./components/Leaderboard.jsx'));
const Playlists = lazyWithRetry(() => import('./components/Playlists.jsx'));
const AchievementsDashboard = lazyWithRetry(() => import('./components/AchievementsDashboard.jsx'));
const DevDashboard = lazyWithRetry(() => import('./components/DevDashboard.jsx'));
const Roadmap = lazyWithRetry(() => import('./components/Roadmap.jsx'));

// Minimal, near-invisible fallback for the Suspense boundaries below - these
// lazy chunks are small and fast on a real connection, so this is only ever
// visible for a beat; no need for a full spinner component/animation here.
const RouteLoading = () => <div className="route-loading" aria-hidden="true" />;

// Server responses/events carry a messageKey (+ optional messageParams) that is
// looked up in the locale files under 'server.<key>'. Alerts are stored as
// { key, params, success } and translated at render time, so switching the
// language mid-session updates any visible message too.
const serverAlert = (payload, fallbackKey) => ({
  key: payload?.messageKey ? `server.${payload.messageKey}` : fallbackKey,
  params: payload?.messageParams,
});

// Guards the Spotify OAuth callback effect below against handling the same
// ?code= more than once - see the comment at its usage site. Module-level
// (not component state) so it persists across a remount within the same
// page load, not just across re-renders of one mount.
let handledOAuthCode = null;

function App() {
  const { t } = useLanguage();
  // The 11 flat standalone pages below (/feedback, /settings, /stats, ...)
  // branch on this instead of reading window.location.pathname directly, so
  // that navigate()ing between them (see router.jsx) actually re-renders
  // this component into the new branch instead of just silently changing the
  // URL underneath a still-mounted old page. The main '/'-vs-'/game' view
  // switch further down deliberately doesn't use this (see its own comment) -
  // it's a one-way mirror of internal state into the URL, never the other
  // direction, so it has no need to react to pathname changes itself.
  //
  // Each of those 11 branches' root <div key={pathname}> matters, not just
  // decoration: every branch renders the exact same tag/className at the
  // exact same position in the tree, so without a key that changes per route,
  // React would read a Settings->Stats navigation as "the same DOM node, new
  // children" and patch in place - leaving it mounted the whole time instead
  // of unmounting/remounting it. That would silently kill two things: the
  // .phase-enter fade/slide-in animation (a CSS animation only plays on
  // insertion, not on an already-mounted node's children changing) and each
  // page's own component-local state actually resetting between visits.
  const pathname = usePathname();
  const [alertMessage, setAlertMessage] = useState(null); // { key, params, success }
  // Only trust a restored 'gm'/'player' view if there's actually a room id to
  // reconnect to - without this check, a browser whose deathstep_view was
  // left stale/mismatched (e.g. deathstep_room_id got cleared some other way
  // without view following) would permanently open on a blank screen: 'gm'/
  // 'player' render nothing until `room` is populated (see the view===/room
  // checks in the JSX below), and nothing ever un-sticks that since there's
  // no room id to reconnect with. Defaulting to 'home' here is always safe -
  // a *legitimate* saved session still has both keys set together.
  const [view, setView] = useState(() => {
    const savedView = localStorage.getItem('deathstep_view');
    const savedRoomId = localStorage.getItem('deathstep_room_id');
    return (savedView && savedRoomId) ? savedView : 'home';
  }); // home, gm, player
  // Whether the in-game screen (GM/Player dashboard) should actually be
  // rendered right now, as opposed to the home/start screen - kept separate
  // from `view` above so an active game (view === 'gm'/'player' + room
  // loaded, reconnected silently in the background on every page load) no
  // longer forces the game screen open by itself. The root "/" must always
  // land on the start screen; only "/game" (or explicitly rejoining via the
  // start screen's "Spiel wieder beitreten" button, see hasActiveGame below)
  // shows the dashboard. Read once at mount, same pattern as `view` above -
  // nothing here ever listens for pathname changes afterwards. Deliberately
  // not wired through router.jsx's usePathname like the 11 standalone pages
  // below are: this pair is never reached by clicking a Link (nothing ever
  // links to "/game"), only by the replaceState mirroring effect further
  // down and by a fresh/bookmarked load, so there's nothing for it to react
  // to that this initializer doesn't already cover.
  const [inGameView, setInGameView] = useState(() => window.location.pathname === '/game');
  const [room, setRoom] = useState(null);
  const [playerRole, setPlayerRole] = useState(null);
  const [isEliminated, setIsEliminated] = useState(false);
  const [rejoinPending, setRejoinPending] = useState(false);
  const [rejoinPrompt, setRejoinPrompt] = useState(null); // { roomId, playerName }
  const [gmChatMessages, setGmChatMessages] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  // fetchMe() is async, so currentUser reads as null for a moment even for an
  // already-logged-in visitor - without this flag, every login-gated page
  // (Stats/Settings/Playlists below) would render its "please log in" state
  // first and then flash to the real content once the check resolves.
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [clientId, setClientId] = useState(() => {
    let id = localStorage.getItem('deathstep_client_id');
    if (!id) {
      id = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('deathstep_client_id', id);
    }
    return id;
  });
  // clientId above is visible to everyone else in the room (couples/kick-
  // target references need it), so it can't prove a joinRoom/reconnectToRoom
  // call claiming it is really this browser's own session - this is the
  // actual proof, issued by the server on join/reconnect/promotion and never
  // broadcast to anyone else (see gameStore.js's addPlayer). Persisted the
  // same way as clientId so it survives a reload.
  const sessionSecretRef = useRef(localStorage.getItem('deathstep_session_secret') || null);
  const setSessionSecret = (secret) => {
    if (!secret) return;
    sessionSecretRef.current = secret;
    localStorage.setItem('deathstep_session_secret', secret);
  };

  const isLeavingRef = useRef(false);

  // Reflects the current view in the URL - actually being in a game (as GM
  // or player) lives at /game, everything else (the create/join screen) is
  // the root "/". No router: this is the only path the app itself ever
  // navigates between, so a plain pathname check plus replaceState is
  // enough - the server's catch-all route already serves index.html for any
  // unmatched path (including a fresh/bookmarked /game), and the other
  // standalone pages below (/feedback, /stats, etc.) return before this
  // component's main view logic ever runs, so this only ever fires while
  // actually on '/' or '/game'.
  useEffect(() => {
    const isGameRoute = window.location.pathname === '/' || window.location.pathname === '/game';
    if (!isGameRoute) return;
    // Gated on `room` and `inGameView`, not just `view` - view alone can be a
    // restored-but-not-yet-confirmed guess (see its initializer above and the
    // reconnectToRoom flow), and inGameView is what actually decides whether
    // the dashboard or the start screen is on screen right now (see
    // showGameScreen below) - the URL should always follow what's visibly
    // rendered, not just what's silently reconnected in the background.
    const target = inGameView && (view === 'gm' || view === 'player') && room ? '/game' : '/';
    if (window.location.pathname !== target) {
      window.history.replaceState({}, '', target);
    }
  }, [view, room, inGameView]);

  useEffect(() => {
    fetchMe().then((user) => {
      setCurrentUser(user);
      setAuthChecked(true);
    });
  }, []);

  // Captures an invite link's ?ref=<userId> (see Stats.jsx, where a logged-in
  // user gets their own shareable link) so it survives navigating to "Login/
  // Register" and filling out the form - Auth.jsx reads it back out at
  // register time and clears it on success. Never overwrites an already-
  // stored code with a later, unrelated page load that has none.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) localStorage.setItem('deathstep_ref_code', ref);
  }, []);

  // The server derives which account a socket belongs to from the login
  // cookie present at connect time (see server/index.js's
  // authenticatedUserId) - it never trusts a client-supplied userId, so a
  // socket that connected while logged out stays "anonymous" server-side
  // even after this tab logs in, until it reconnects. Reconnect right away
  // on every login/logout so a room created/joined immediately after either
  // one is correctly attributed (or not) without needing a page reload.
  const handleAuthenticated = (user) => {
    setCurrentUser(user);
    socket.disconnect();
    socket.connect();
  };

  const handleLogout = () => {
    logoutRequest();
    setCurrentUser(null);
    socket.disconnect();
    socket.connect();
  };

  useEffect(() => {
    // Force re-login once to get the new 'streaming' scope
    if (!localStorage.getItem('spotify_scope_fix_2')) {
      localStorage.removeItem('spotify_access_token');
      localStorage.setItem('spotify_scope_fix_2', 'true');
    }
    // Force re-login once more to get the new playlist-read-* scope (see
    // client/src/spotify.js's SCOPES) - refreshing an existing token only
    // ever preserves whatever scope it originally consented to, so a full
    // logout (not just clearing the access token) is needed to actually
    // pick up newly-added scopes; the user just goes through Spotify's
    // consent screen again next time they connect.
    if (!localStorage.getItem('spotify_scope_fix_3')) {
      localStorage.removeItem('spotify_access_token');
      localStorage.removeItem('spotify_refresh_token');
      localStorage.removeItem('spotify_token_expires_at');
      localStorage.removeItem('spotify_code_verifier');
      localStorage.setItem('spotify_scope_fix_3', 'true');
    }

    socket.connect();

    const handleRoomUpdated = (updatedRoom) => {
      setRoom(updatedRoom);

      if (updatedRoom.couples) {
        const myCouple = updatedRoom.couples.find(c => c.playerIds && c.playerIds.includes(clientId));
        if (myCouple) {
          if (myCouple.status === 'eliminated') {
            setIsEliminated(true);
          } else {
            setIsEliminated(false);
          }
          if (updatedRoom.status !== 'lobby' && updatedRoom.status !== 'paired') {
            setPlayerRole(myCouple.role);
          }
        }
      }
    };

    socket.on('connect', () => {
      const savedRoomId = localStorage.getItem('deathstep_room_id');
      if (savedRoomId && view !== 'home') {
        socket.emit('reconnectToRoom', { roomId: savedRoomId, clientId, isGM: view === 'gm', sessionSecret: sessionSecretRef.current }, (response) => {
          if (response.success) {
            handleRoomUpdated(response.room);
            setSessionSecret(response.sessionSecret);
            if (response.gmChatHistory) {
              setGmChatMessages(response.gmChatHistory);
            }
          } else {
            handleLeaveRoom(false); // Room gone, or this session was replaced by an approved rejoin
            if (response.messageKey) {
              setAlertMessage(serverAlert(response));
            }
          }
        });
      }
    });

    socket.on('roomUpdated', handleRoomUpdated);

    socket.on('roleAssigned', ({ role }) => {
      setPlayerRole(role);
      setIsEliminated(false); // Reset on game start
    });

    socket.on('roomDestroyed', () => {
      if (isLeavingRef.current) return;
      handleLeaveRoom(false);
      if (view !== 'gm') {
        setAlertMessage({ key: 'alert.roomClosed' });
      }
    });

    socket.on('rejoinApproved', ({ room: approvedRoom, clientId: approvedClientId, sessionSecret }) => {
      if (approvedClientId && approvedClientId !== clientId) {
        localStorage.setItem('deathstep_client_id', approvedClientId);
        setClientId(approvedClientId);
      }
      setSessionSecret(sessionSecret);
      setRejoinPending(false);
      setRoom(approvedRoom);
      localStorage.setItem('deathstep_room_id', approvedRoom.id);
      localStorage.setItem('deathstep_view', 'player');
      setView('player');
      setInGameView(true);
    });

    socket.on('rejoinDenied', (payload) => {
      setRejoinPending(false);
      setAlertMessage(serverAlert(payload, 'server.rejoinDenied'));
    });

    socket.on('sessionReplaced', () => {
      handleLeaveRoom(false);
      setAlertMessage({ key: 'alert.sessionReplaced' });
    });

    socket.on('removedFromGame', (payload) => {
      if (isLeavingRef.current) return;
      handleLeaveRoom(false);
      setAlertMessage(serverAlert(payload, 'server.removedGeneric'));
    });

    // Unlike removedFromGame, this player is staying in the room (as a
    // spectator, or paired down from a 3-person group) - just tell them why
    // their partner situation changed, roomUpdated (right behind this on
    // the same socket) already carries the actual new state.
    socket.on('partnerLeftNotice', (payload) => {
      setAlertMessage(serverAlert(payload));
    });

    socket.on('songSuggestionHandled', (payload) => {
      setAlertMessage({ ...serverAlert(payload), success: payload?.messageKey === 'suggestionConfirmed' });
    });

    socket.on('promotedToGM', ({ room: newRoom, gmChatHistory, sessionSecret }) => {
      isLeavingRef.current = false;
      setRoom(newRoom);
      setSessionSecret(sessionSecret);
      setGmChatMessages(gmChatHistory || []);
      localStorage.setItem('deathstep_room_id', newRoom.id);
      localStorage.setItem('deathstep_view', 'gm');
      setView('gm');
      setInGameView(true);
      setAlertMessage({ key: 'alert.promoted' });
    });

    // A co-GM's rights were revoked (by the main GM, or themselves - see
    // GMDashboard.jsx's handleRemoveCoGM) - they stay in the room as a
    // regular player rather than being removed (see removedFromGame above),
    // so this switches the view instead of leaving.
    socket.on('demotedToPlayer', ({ room: newRoom, sessionSecret }) => {
      setRoom(newRoom);
      setSessionSecret(sessionSecret);
      localStorage.setItem('deathstep_view', 'player');
      setView('player');
      setAlertMessage({ key: 'alert.demoted' });
    });

    // The main GM handed the round over to this co-GM (see
    // GMDashboard.jsx's handleHandoverGM) - already still viewing 'gm', so
    // no view change needed, just an update and a heads-up. sessionSecret is
    // the room's freshly rotated primary-GM secret (see gameStore.
    // handoverGM/server/index.js's handoverGM handler) - must be stored the
    // same way joinRoom/reconnectToRoom's does, since every future
    // reconnectToRoom call as this now-primary GM needs to prove it.
    socket.on('becameMainGM', ({ room: newRoom, sessionSecret: newSessionSecret }) => {
      setRoom(newRoom);
      setSessionSecret(newSessionSecret);
      setAlertMessage({ key: 'alert.becameMainGM' });
    });

    socket.on('gmChatMessage', (message) => {
      setGmChatMessages(prev => [...prev, message]);
    });

    return () => {
      socket.off('roomUpdated', handleRoomUpdated);
      socket.off('roleAssigned');
      socket.off('roomDestroyed');
      socket.off('rejoinApproved');
      socket.off('rejoinDenied');
      socket.off('sessionReplaced');
      socket.off('removedFromGame');
      socket.off('partnerLeftNotice');
      socket.off('songSuggestionHandled');
      socket.off('promotedToGM');
      socket.off('demotedToPlayer');
      socket.off('becameMainGM');
      socket.off('gmChatMessage');
    };
  }, [view, clientId]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (!code) return;

    // Spotify's authorization codes are single-use - if this effect ever ran
    // twice for the same code (e.g. a remount before the first run's
    // history.replaceState had cleared ?code= from the URL), a second
    // exchange attempt would race the first and get "invalid_grant" from
    // Spotify no matter how correct its own request was, since the code was
    // already redeemed by whichever attempt won. Marking the code as handled
    // synchronously, before the dynamic import below even starts, closes
    // that window - handledOAuthCode is module-level (not component state)
    // so it survives across remounts within the same page load.
    if (handledOAuthCode === code) return;
    handledOAuthCode = code;

    import('./spotify.js').then(({ isSpotifyLinkMode, clearSpotifyLinkMode, getTokenForAccountLink, getToken }) => {
      if (isSpotifyLinkMode()) {
        // Account-level link (Settings/Playlists) - result is persisted
        // server-side, not this browser's localStorage. Distinguished from
        // the GM local-playback flow below via a flag set before the redirect.
        clearSpotifyLinkMode();
        getTokenForAccountLink(code).then(({ connected, error }) => {
          window.history.replaceState({}, document.title, window.location.pathname);
          const key = connected
            ? 'alert.spotifyConnected'
            : (error === 'spotify_already_linked' ? 'alert.spotifyAlreadyLinked'
              : (error === 'spotify_rate_limited' ? 'alert.spotifyRateLimited' : 'alert.spotifyFailed'));
          setAlertMessage({ key, success: connected });
        });
        return;
      }

      getToken(code).then((token) => {
        // Cleared unconditionally, same as the link-mode branch above - a
        // failed exchange still means this ?code= is spent (or was already
        // invalid), so leaving it in the URL only sets up a guaranteed second
        // failure (Spotify authorization codes are single-use) on the next
        // plain page reload, once handledOAuthCode's module-level guard has
        // reset with the fresh page load.
        window.history.replaceState({}, document.title, window.location.pathname);
        if (token) {
          setAlertMessage({ key: 'alert.spotifyConnected', success: true });
        } else {
          setAlertMessage({ key: 'alert.spotifyFailed' });
        }
      });
    });
  }, []);

  const handleLeaveRoom = (emitToServer = true) => {
    isLeavingRef.current = true;
    if (emitToServer) {
      const savedRoomId = localStorage.getItem('deathstep_room_id');
      if (savedRoomId) {
        socket.emit('leaveRoom', { roomId: savedRoomId, clientId, isGM: view === 'gm' });
      }
    }
    localStorage.removeItem('deathstep_room_id');
    localStorage.setItem('deathstep_view', 'home');
    setRoom(null);
    setPlayerRole(null);
    setIsEliminated(false);
    setRejoinPending(false);
    setGmChatMessages([]);
    setView('home');
    setInGameView(false);
  };

  const handleCreateRoom = () => {
    isLeavingRef.current = false;
    localStorage.setItem('deathstep_privacy_mode', 'false');
    socket.emit('createRoom', { clientId }, (response) => {
      if (response.success) {
        setRoom(response.room);
        setSessionSecret(response.sessionSecret);
        setGmChatMessages(response.gmChatHistory || []);
        localStorage.setItem('deathstep_room_id', response.room.id);
        localStorage.setItem('deathstep_view', 'gm');
        setView('gm');
        setInGameView(true);
      }
    });
  };

  const handleSendGMChatMessage = (text) => {
    if (!room) return;
    socket.emit('sendGMChatMessage', { roomId: room.id, senderName: myGmName, text });
  };

  const handleJoinRoom = (roomId, playerName, danceRole, isFlexible) => {
    isLeavingRef.current = false;
    socket.emit('joinRoom', { roomId, playerName, danceRole, isFlexible, clientId, sessionSecret: sessionSecretRef.current }, (response) => {
      if (response.success) {
        setRoom(response.room);
        setSessionSecret(response.sessionSecret);
        localStorage.setItem('deathstep_room_id', response.room.id);
        localStorage.setItem('deathstep_view', 'player');
        setView('player');
        setInGameView(true);
      } else if (response.nameTaken) {
        setRejoinPrompt({ roomId, playerName });
      } else {
        setAlertMessage(serverAlert(response, 'alert.joinFailed'));
      }
    });
  };

  const handleRequestRejoin = (roomId, playerName) => {
    isLeavingRef.current = false;
    socket.emit('requestRejoin', { roomId, playerName, clientId, sessionSecret: sessionSecretRef.current }, (response) => {
      if (response.success) {
        setRoom(response.room);
        setSessionSecret(response.sessionSecret);
        localStorage.setItem('deathstep_room_id', response.room.id);
        localStorage.setItem('deathstep_view', 'player');
        setView('player');
        setInGameView(true);
      } else if (response.pending) {
        setRejoinPending(true);
      } else {
        setAlertMessage(serverAlert(response, 'alert.rejoinFailed'));
      }
    });
  };

  const myGmName = room?.coGms?.find(g => g.id === clientId)?.name || t('gm.mainGmName');

  // A room reconnected silently in the background (see the socket 'connect'
  // handler above, which fires on every page load/reconnect regardless of
  // inGameView) counts as "active" the moment it's confirmed - this is what
  // powers the start screen's "Spiel wieder beitreten" button, and gates
  // whether inGameView is even allowed to actually show the dashboard.
  const hasActiveGame = (view === 'gm' || view === 'player') && !!room;
  const showGameScreen = inGameView && hasActiveGame;

  if (pathname === '/feedback') {
    return (
      <div className="app-container phase-enter" key={pathname}>
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Suspense fallback={<RouteLoading />}><Feedback /></Suspense>
        <CookieBanner />
      </div>
    );
  }

  if (pathname === '/datenschutz') {
    return (
      <div className="app-container phase-enter" key={pathname}>
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Suspense fallback={<RouteLoading />}><Datenschutz /></Suspense>
        <CookieBanner />
      </div>
    );
  }

  if (pathname === '/impressum') {
    return (
      <div className="app-container phase-enter" key={pathname}>
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Suspense fallback={<RouteLoading />}><Impressum /></Suspense>
        <CookieBanner />
      </div>
    );
  }

  if (pathname === '/stats') {
    return (
      <div className="app-container phase-enter" key={pathname}>
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Suspense fallback={<RouteLoading />}>
          <Stats currentUser={currentUser} authLoading={!authChecked} onLoginClick={() => setIsAuthModalOpen(true)} />
        </Suspense>
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} onAuthenticated={handleAuthenticated} />
        <CookieBanner />
      </div>
    );
  }

  if (pathname === '/dev') {
    return (
      <div className="app-container phase-enter" key={pathname}>
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Suspense fallback={<RouteLoading />}>
          <DevDashboard currentUser={currentUser} authLoading={!authChecked} />
        </Suspense>
        <CookieBanner />
      </div>
    );
  }

  if (pathname === '/settings') {
    return (
      <div className="app-container phase-enter" key={pathname}>
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Suspense fallback={<RouteLoading />}>
          <Settings currentUser={currentUser} authLoading={!authChecked} onUserUpdated={setCurrentUser} onLoginClick={() => setIsAuthModalOpen(true)} />
        </Suspense>
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} onAuthenticated={handleAuthenticated} />
        <CookieBanner />
      </div>
    );
  }

  if (pathname === '/reset-password') {
    return (
      <div className="app-container phase-enter" key={pathname}>
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Suspense fallback={<RouteLoading />}>
          <ResetPassword onAuthenticated={handleAuthenticated} />
        </Suspense>
        <CookieBanner />
      </div>
    );
  }

  if (pathname === '/leaderboard') {
    return (
      <div className="app-container phase-enter" key={pathname}>
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Suspense fallback={<RouteLoading />}>
          <Leaderboard currentUser={currentUser} onLoginClick={() => setIsAuthModalOpen(true)} />
        </Suspense>
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} onAuthenticated={handleAuthenticated} />
        <CookieBanner />
      </div>
    );
  }

  if (pathname === '/playlists') {
    return (
      <div className="app-container phase-enter" key={pathname}>
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Suspense fallback={<RouteLoading />}>
          <Playlists currentUser={currentUser} authLoading={!authChecked} onLoginClick={() => setIsAuthModalOpen(true)} />
        </Suspense>
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} onAuthenticated={handleAuthenticated} />
        <CookieBanner />
      </div>
    );
  }

  if (pathname === '/roadmap') {
    return (
      <div className="app-container phase-enter" key={pathname}>
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Suspense fallback={<RouteLoading />}><Roadmap /></Suspense>
        <CookieBanner />
      </div>
    );
  }

  if (pathname === '/achievements') {
    return (
      <div className="app-container phase-enter" key={pathname}>
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Suspense fallback={<RouteLoading />}>
          <AchievementsDashboard currentUser={currentUser} authLoading={!authChecked} onLoginClick={() => setIsAuthModalOpen(true)} />
        </Suspense>
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} onAuthenticated={handleAuthenticated} />
        <CookieBanner />
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="header">
        <h1 className="glitch-text">Deathstep</h1>
      </div>

      {!showGameScreen && rejoinPending && (
        <div className="cyber-card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: '20px', color: 'var(--neon-purple)' }}>{t('app.rejoinRequestedTitle')}</h2>
          <p style={{ color: 'var(--text-muted)' }}>{t('app.rejoinRequestedWait')}</p>
        </div>
      )}

      {!showGameScreen && !rejoinPending && (
        <Home
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          currentUser={currentUser}
          authLoading={!authChecked}
          onLoginClick={() => setIsAuthModalOpen(true)}
          onLogout={handleLogout}
          hasActiveGame={hasActiveGame}
          onRejoinGame={() => setInGameView(true)}
        />
      )}

      {showGameScreen && view === 'gm' && (
        <Suspense fallback={<RouteLoading />}>
          <GMDashboard
            room={room}
            onLeave={() => handleLeaveRoom(true)}
            myGmName={myGmName}
            clientId={clientId}
            onSessionSecretUpdated={setSessionSecret}
            gmChatMessages={gmChatMessages}
            onSendGMChatMessage={handleSendGMChatMessage}
            currentUser={currentUser}
          />
        </Suspense>
      )}

      {showGameScreen && view === 'player' && (
        <Suspense fallback={<RouteLoading />}>
          <PlayerScreen
            room={room}
            role={playerRole}
            isEliminated={isEliminated}
            clientId={clientId}
            currentUser={currentUser}
            onLeave={() => handleLeaveRoom(true)}
          />
        </Suspense>
      )}

      <AlertModal
        isOpen={!!alertMessage}
        message={alertMessage ? t(alertMessage.key, alertMessage.params) : null}
        isSuccess={!!alertMessage?.success}
        onClose={() => setAlertMessage(null)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        onAuthenticated={handleAuthenticated}
      />

      <ConfirmModal
        isOpen={!!rejoinPrompt}
        message={t('alert.nameTakenPrompt')}
        onConfirm={() => {
          if (rejoinPrompt) handleRequestRejoin(rejoinPrompt.roomId, rejoinPrompt.playerName);
        }}
        onCancel={() => setRejoinPrompt(null)}
      />

      <CookieBanner />
    </div>
  );
}

export default App;
