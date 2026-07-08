import React, { useState, useEffect, useRef } from 'react';
import { socket } from './socket.js';
import Home from './components/Home.jsx';
import GMDashboard from './components/GMDashboard.jsx';
import PlayerScreen from './components/PlayerScreen.jsx';
import Feedback from './components/Feedback.jsx';
import { AlertModal } from './components/Modal.jsx';

function App() {
  const [alertMessage, setAlertMessage] = useState(null);
  const [view, setView] = useState(() => localStorage.getItem('deathstep_view') || 'home'); // home, gm, player
  const [room, setRoom] = useState(null);
  const [playerRole, setPlayerRole] = useState(null);
  const [isEliminated, setIsEliminated] = useState(false);
  const [clientId] = useState(() => {
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
          } else {
            handleLeaveRoom(false); // Room doesn't exist anymore
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

    return () => {
      socket.off('roomUpdated', handleRoomUpdated);
      socket.off('roleAssigned');
      socket.off('roomDestroyed');
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
    setView('home');
  };

  const handleCreateRoom = () => {
    isLeavingRef.current = false;
    socket.emit('createRoom', (response) => {
      if (response.success) {
        setRoom(response.room);
        localStorage.setItem('deathstep_room_id', response.room.id);
        localStorage.setItem('deathstep_view', 'gm');
        setView('gm');
      }
    });
  };

  const handleJoinRoom = (roomId, playerName, danceRole, isFlexible) => {
    isLeavingRef.current = false;
    socket.emit('joinRoom', { roomId, playerName, danceRole, isFlexible, clientId }, (response) => {
      if (response.success) {
        setRoom(response.room);
        localStorage.setItem('deathstep_room_id', response.room.id);
        localStorage.setItem('deathstep_view', 'player');
        setView('player');
      } else {
        setAlertMessage(response.message || 'Failed to join room');
      }
    });
  };

  if (window.location.pathname === '/feedback') {
    return (
      <div className="app-container">
        <div className="header">
          <h1 className="glitch-text">Deathstep</h1>
        </div>
        <Feedback />
      </div>
    );
  }

  return (
    <div className="app-container">
      <div className="header">
        <h1 className="glitch-text">Deathstep</h1>
      </div>
      
      {view === 'home' && (
        <Home onCreateRoom={handleCreateRoom} onJoinRoom={handleJoinRoom} />
      )}
      
      {view === 'gm' && room && (
        <GMDashboard room={room} onLeave={() => handleLeaveRoom(true)} />
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
    </div>
  );
}

export default App;
