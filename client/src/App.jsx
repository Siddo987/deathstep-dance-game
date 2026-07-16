import React, { useState, useEffect, useRef } from 'react';
import { socket } from './socket.js';
import Home from './components/Home.jsx';
import GMDashboard from './components/GMDashboard.jsx';
import PlayerScreen from './components/PlayerScreen.jsx';
import Feedback from './components/Feedback.jsx';
import Datenschutz from './components/Datenschutz.jsx';
import Impressum from './components/Impressum.jsx';
import Stats from './components/Stats.jsx';
import Settings from './components/Settings.jsx';
import Leaderboard from './components/Leaderboard.jsx';
import Playlists from './components/Playlists.jsx';
import CookieBanner from './components/CookieBanner.jsx';
import { AlertModal, ConfirmModal } from './components/Modal.jsx';
import { AuthModal } from './components/Auth.jsx';
import { fetchMe, logout as logoutRequest } from './auth.js';
import { useLanguage } from './i18n.jsx';

// Server responses/events carry a messageKey (+ optional messageParams) that is
// looked up in the locale files under 'server.<key>'. Alerts are stored as
// { key, params, success } and translated at render time, so switching the
// language mid-session updates any visible message too.
const serverAlert = (payload, fallbackKey) => ({
  key: payload?.messageKey ? `server.${payload.messageKey}` : fallbackKey,
  params: payload?.messageParams,
});

function App() {
  const { t } = useLanguage();
  const [alertMessage, setAlertMessage] = useState(null); // { key, params, success }
  const [view, setView] = useState(() => localStorage.getItem('deathstep_view') || 'home'); // home, gm, player
  const [room, setRoom] = useState(null);
  const [playerRole, setPlayerRole] = useState(null);
  const [isEliminated, setIsEliminated] = useState(false);
  const [rejoinPending, setRejoinPending] = useState(false);
  const [rejoinPrompt, setRejoinPrompt] = useState(null); // { roomId, playerName }
  const [gmChatMessages, setGmChatMessages] = useState([]);
  const [currentUser, setCurrentUser] = useState(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [clientId, setClientId] = useState(() => {
    let id = localStorage.getItem('deathstep_client_id');
    if (!id) {
      id = Math.random().toString(36).substring(2, 15);
      localStorage.setItem('deathstep_client_id', id);
    }
    return id;
  });

  const isLeavingRef = useRef(false);

  useEffect(() => {
    fetchMe().then(setCurrentUser);
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
        socket.emit('reconnectToRoom', { roomId: savedRoomId, clientId, isGM: view === 'gm' }, (response) => {
          if (response.success) {
            handleRoomUpdated(response.room);
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

    socket.on('rejoinApproved', ({ room: approvedRoom, clientId: approvedClientId }) => {
      if (approvedClientId && approvedClientId !== clientId) {
        localStorage.setItem('deathstep_client_id', approvedClientId);
        setClientId(approvedClientId);
      }
      setRejoinPending(false);
      setRoom(approvedRoom);
      localStorage.setItem('deathstep_room_id', approvedRoom.id);
      localStorage.setItem('deathstep_view', 'player');
      setView('player');
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

    socket.on('songSuggestionHandled', (payload) => {
      setAlertMessage({ ...serverAlert(payload), success: payload?.messageKey === 'suggestionConfirmed' });
    });

    socket.on('promotedToGM', ({ room: newRoom, gmChatHistory }) => {
      isLeavingRef.current = false;
      setRoom(newRoom);
      setGmChatMessages(gmChatHistory || []);
      localStorage.setItem('deathstep_room_id', newRoom.id);
      localStorage.setItem('deathstep_view', 'gm');
      setView('gm');
      setAlertMessage({ key: 'alert.promoted' });
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
      socket.off('songSuggestionHandled');
      socket.off('promotedToGM');
      socket.off('gmChatMessage');
    };
  }, [view, clientId]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (!code) return;

    import('./spotify.js').then(({ isSpotifyLinkMode, clearSpotifyLinkMode, getTokenForAccountLink, getToken }) => {
      if (isSpotifyLinkMode()) {
        // Account-level link (Settings/Playlists) - result is persisted
        // server-side, not this browser's localStorage. Distinguished from
        // the GM local-playback flow below via a flag set before the redirect.
        clearSpotifyLinkMode();
        getTokenForAccountLink(code).then(({ connected }) => {
          window.history.replaceState({}, document.title, window.location.pathname);
          setAlertMessage({ key: connected ? 'alert.spotifyConnected' : 'alert.spotifyFailed', success: connected });
        });
        return;
      }

      getToken(code).then((token) => {
        if (token) {
          window.history.replaceState({}, document.title, window.location.pathname);
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
  };

  const handleCreateRoom = () => {
    isLeavingRef.current = false;
    localStorage.setItem('deathstep_privacy_mode', 'false');
    socket.emit('createRoom', { clientId }, (response) => {
      if (response.success) {
        setRoom(response.room);
        setGmChatMessages(response.gmChatHistory || []);
        localStorage.setItem('deathstep_room_id', response.room.id);
        localStorage.setItem('deathstep_view', 'gm');
        setView('gm');
      }
    });
  };

  const handleSendGMChatMessage = (text) => {
    if (!room) return;
    socket.emit('sendGMChatMessage', { roomId: room.id, senderName: myGmName, text });
  };

  const handleJoinRoom = (roomId, playerName, danceRole, isFlexible) => {
    isLeavingRef.current = false;
    socket.emit('joinRoom', { roomId, playerName, danceRole, isFlexible, clientId }, (response) => {
      if (response.success) {
        setRoom(response.room);
        localStorage.setItem('deathstep_room_id', response.room.id);
        localStorage.setItem('deathstep_view', 'player');
        setView('player');
      } else if (response.nameTaken) {
        setRejoinPrompt({ roomId, playerName });
      } else {
        setAlertMessage(serverAlert(response, 'alert.joinFailed'));
      }
    });
  };

  const handleRequestRejoin = (roomId, playerName) => {
    isLeavingRef.current = false;
    socket.emit('requestRejoin', { roomId, playerName, clientId }, (response) => {
      if (response.success) {
        setRoom(response.room);
        localStorage.setItem('deathstep_room_id', response.room.id);
        localStorage.setItem('deathstep_view', 'player');
        setView('player');
      } else if (response.pending) {
        setRejoinPending(true);
      } else {
        setAlertMessage(serverAlert(response, 'alert.rejoinFailed'));
      }
    });
  };

  const myGmName = room?.coGms?.find(g => g.id === clientId)?.name || t('gm.mainGmName');

  if (window.location.pathname === '/feedback') {
    return (
      <div className="app-container">
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Feedback />
        <CookieBanner />
      </div>
    );
  }

  if (window.location.pathname === '/datenschutz') {
    return (
      <div className="app-container">
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Datenschutz />
        <CookieBanner />
      </div>
    );
  }

  if (window.location.pathname === '/impressum') {
    return (
      <div className="app-container">
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Impressum />
        <CookieBanner />
      </div>
    );
  }

  if (window.location.pathname === '/stats') {
    return (
      <div className="app-container">
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Stats currentUser={currentUser} onLoginClick={() => setIsAuthModalOpen(true)} />
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} onAuthenticated={handleAuthenticated} />
        <CookieBanner />
      </div>
    );
  }

  if (window.location.pathname === '/settings') {
    return (
      <div className="app-container">
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Settings currentUser={currentUser} onUserUpdated={setCurrentUser} onLoginClick={() => setIsAuthModalOpen(true)} />
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} onAuthenticated={handleAuthenticated} />
        <CookieBanner />
      </div>
    );
  }

  if (window.location.pathname === '/leaderboard') {
    return (
      <div className="app-container">
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Leaderboard currentUser={currentUser} onLoginClick={() => setIsAuthModalOpen(true)} />
        <AuthModal isOpen={isAuthModalOpen} onClose={() => setIsAuthModalOpen(false)} onAuthenticated={handleAuthenticated} />
        <CookieBanner />
      </div>
    );
  }

  if (window.location.pathname === '/playlists') {
    return (
      <div className="app-container">
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Playlists currentUser={currentUser} onLoginClick={() => setIsAuthModalOpen(true)} />
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

      {view === 'home' && rejoinPending && (
        <div className="cyber-card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: '20px', color: 'var(--neon-purple)' }}>{t('app.rejoinRequestedTitle')}</h2>
          <p style={{ color: 'var(--text-muted)' }}>{t('app.rejoinRequestedWait')}</p>
        </div>
      )}

      {view === 'home' && !rejoinPending && (
        <Home
          onCreateRoom={handleCreateRoom}
          onJoinRoom={handleJoinRoom}
          currentUser={currentUser}
          onLoginClick={() => setIsAuthModalOpen(true)}
          onLogout={handleLogout}
        />
      )}

      {view === 'gm' && room && (
        <GMDashboard
          room={room}
          onLeave={() => handleLeaveRoom(true)}
          myGmName={myGmName}
          gmChatMessages={gmChatMessages}
          onSendGMChatMessage={handleSendGMChatMessage}
          currentUser={currentUser}
        />
      )}

      {view === 'player' && room && (
        <PlayerScreen
          room={room}
          role={playerRole}
          isEliminated={isEliminated}
          clientId={clientId}
          currentUser={currentUser}
          onLeave={() => handleLeaveRoom(true)}
        />
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
