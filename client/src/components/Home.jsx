import React, { useState } from 'react';

function Home({ onCreateRoom, onJoinRoom }) {
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [danceRole, setDanceRole] = useState('lead'); // 'lead' or 'follow'
  const [isFlexible, setIsFlexible] = useState(false);
  const [view, setView] = useState('main'); // main, join

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomId(roomParam);
      setView('join');
    }
  }, []);

  if (view === 'main') {
    return (
      <div className="cyber-card" style={{ textAlign: 'center' }}>
        <h2 style={{ marginBottom: '30px', color: 'var(--neon-blue)' }}>ENTER THE DANCEFLOOR</h2>
        
        <button 
          className="cyber-button pulse-animation" 
          style={{ marginBottom: '20px' }}
          onClick={() => setView('join')}
        >
          Join Game
        </button>
        
        <div style={{ margin: '30px 0', color: 'var(--text-muted)' }}>OR</div>
        
        <button 
          className="cyber-button" 
          style={{ background: 'transparent', border: '1px solid var(--neon-purple)', color: 'var(--neon-purple)' }}
          onClick={onCreateRoom}
        >
          Create Ballroom (GM)
        </button>
      </div>
    );
  }

  return (
    <div className="cyber-card">
      <h2 style={{ marginBottom: '20px', color: 'var(--neon-purple)' }}>JOIN GAME</h2>
      
      <input 
        type="text" 
        className="cyber-input" 
        placeholder="4-DIGIT BALLROOM CODE" 
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        maxLength={4}
      />
      
      <input 
        type="text" 
        className="cyber-input" 
        placeholder="YOUR NAME" 
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
      />

      <div style={{ margin: '15px 0 5px 0', display: 'flex', gap: '10px' }}>
        <button 
          className="cyber-button" 
          style={{ 
            flex: 1, 
            background: danceRole === 'lead' ? 'rgba(0, 240, 255, 0.2)' : 'transparent',
            borderColor: danceRole === 'lead' ? 'var(--neon-blue)' : 'var(--text-muted)'
          }}
          onClick={() => setDanceRole('lead')}
        >
          I am LEAD
        </button>
        <button 
          className="cyber-button" 
          style={{ 
            flex: 1, 
            background: danceRole === 'follow' ? 'rgba(255, 0, 255, 0.2)' : 'transparent',
            borderColor: danceRole === 'follow' ? 'var(--neon-purple)' : 'var(--text-muted)'
          }}
          onClick={() => setDanceRole('follow')}
        >
          I am FOLLOW
        </button>
      </div>
      
      <div style={{ marginBottom: '20px', padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: '5px', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <input 
          type="checkbox" 
          id="flexibleRole" 
          checked={isFlexible} 
          onChange={(e) => setIsFlexible(e.target.checked)} 
          style={{ transform: 'scale(1.2)', cursor: 'pointer' }}
        />
        <label htmlFor="flexibleRole" style={{ color: 'white', cursor: 'pointer', fontSize: '0.9rem' }}>
          Ich bin flexibel (kann zur Not auch die andere Rolle tanzen)
        </label>
      </div>
      
      <button 
        className="cyber-button pulse-animation" 
        style={{ marginTop: '10px', marginBottom: '10px', width: '100%' }}
        onClick={() => onJoinRoom(roomId, playerName, danceRole, isFlexible)}
        disabled={!roomId || !playerName}
      >
        CONNECT
      </button>
      
      <button 
        className="cyber-button" 
        style={{ background: 'transparent', color: 'var(--text-muted)', width: '100%' }}
        onClick={() => setView('main')}
      >
        BACK
      </button>
    </div>
  );
}

export default Home;
