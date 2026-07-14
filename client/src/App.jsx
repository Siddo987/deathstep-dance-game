import React, { useState, useEffect, useRef } from 'react';
import { socket } from './socket.js';
import Home from './components/Home.jsx';
import GMDashboard from './components/GMDashboard.jsx';
import PlayerScreen from './components/PlayerScreen.jsx';
import Feedback from './components/Feedback.jsx';
import Datenschutz from './components/Datenschutz.jsx';
import Impressum from './components/Impressum.jsx';
import CookieBanner from './components/CookieBanner.jsx';
import { AlertModal, ConfirmModal } from './components/Modal.jsx';

function App() {
  const [alertMessage, setAlertMessage] = useState(null);
  const [view, setView] = useState(() => localStorage.getItem('deathstep_view') || 'home'); // home, gm, player
  const [room, setRoom] = useState(null);
  const [playerRole, setPlayerRole] = useState(null);
  const [isEliminated, setIsEliminated] = useState(false);
  const [rejoinPending, setRejoinPending] = useState(false);
  const [rejoinPrompt, setRejoinPrompt] = useState(null); // { roomId, playerName, message }
  const [gmChatMessages, setGmChatMessages] = useState([]);
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
            if (response.message) {
              setAlertMessage(response.message);
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
        setAlertMessage("The GM has closed the ballroom.");
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

    socket.on('rejoinDenied', ({ message }) => {
      setRejoinPending(false);
      setAlertMessage(message || 'Der Spielleiter hat die Anfrage abgelehnt.');
    });

    socket.on('sessionReplaced', () => {
      handleLeaveRoom(false);
      setAlertMessage('Deine Sitzung wurde von einem anderen Gerät übernommen, da du einen Wiedereinstieg beantragt hast.');
    });

    socket.on('removedFromGame', ({ message }) => {
      if (isLeavingRef.current) return;
      handleLeaveRoom(false);
      setAlertMessage(message || 'Du wurdest aus dem Spiel entfernt.');
    });

    socket.on('promotedToGM', ({ room: newRoom, gmChatHistory }) => {
      isLeavingRef.current = false;
      setRoom(newRoom);
      setGmChatMessages(gmChatHistory || []);
      localStorage.setItem('deathstep_room_id', newRoom.id);
      localStorage.setItem('deathstep_view', 'gm');
      setView('gm');
      setAlertMessage('Du wurdest zum Spielleiter (GM) befördert!');
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
      socket.off('promotedToGM');
      socket.off('gmChatMessage');
    };
  }, [view, clientId]);

  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const code = urlParams.get('code');
    if (code) {
      import('./spotify.js').then(({ getToken }) => {
        getToken(code).then((token) => {
          if (token) {
            window.history.replaceState({}, document.title, window.location.pathname);
            setAlertMessage("Spotify successfully connected!");
          } else {
            setAlertMessage("Failed to connect Spotify.");
          }
        });
      });
    }
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
    socket.emit('createRoom', (response) => {
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
        setRejoinPrompt({
          roomId,
          playerName,
          message: `${response.message} Wiedereinstieg beim Spielleiter beantragen?`
        });
      } else {
        setAlertMessage(response.message || 'Failed to join room');
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
        setAlertMessage(response.message || 'Wiedereinstieg fehlgeschlagen');
      }
    });
  };

  const myGmName = room?.coGms?.find(g => g.id === clientId)?.name || 'Haupt-GM';

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

  return (
    <div className="app-container">
      <div className="header">
        <h1 className="glitch-text">Deathstep</h1>
      </div>
      
      {view === 'home' && rejoinPending && (
        <div className="cyber-card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: '20px', color: 'var(--neon-purple)' }}>WIEDEREINSTIEG BEANTRAGT</h2>
          <p style={{ color: 'var(--text-muted)' }}>Warte auf Bestätigung durch den Spielleiter...</p>
        </div>
      )}

      {view === 'home' && !rejoinPending && (
        <Home onCreateRoom={handleCreateRoom} onJoinRoom={handleJoinRoom} />
      )}

      {view === 'gm' && room && (
        <GMDashboard
          room={room}
          onLeave={() => handleLeaveRoom(true)}
          myGmName={myGmName}
          gmChatMessages={gmChatMessages}
          onSendGMChatMessage={handleSendGMChatMessage}
        />
      )}
      
      {view === 'player' && room && (
        <PlayerScreen 
          room={room} 
          role={playerRole} 
          isEliminated={isEliminated} 
          clientId={clientId}
          onLeave={() => handleLeaveRoom(true)}
        />
      )}

      <AlertModal
        isOpen={!!alertMessage}
        message={alertMessage}
        onClose={() => setAlertMessage(null)}
      />

      <ConfirmModal
        isOpen={!!rejoinPrompt}
        message={rejoinPrompt?.message}
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
