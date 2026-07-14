import React, { useState } from 'react';
import { Users, Crown, LogIn, Repeat, ArrowLeft } from 'lucide-react';
import { openCookieSettings } from './CookieBanner.jsx';

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
      <div className="cyber-card phase-enter" style={{ textAlign: 'center' }}>
        <h2 style={{ marginBottom: '8px', color: 'var(--neon-blue)' }}>ENTER THE DANCEFLOOR</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '30px', fontSize: '0.95rem' }}>
          A murder mystery, hidden inside a dance. Join as a player, or run the show as GM.
        </p>

        <button
          className="cyber-button pulse-animation"
          style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
          onClick={() => setView('join')}
        >
          <LogIn size={20} className="icon-inline" />
          Join Game
        </button>

        <div style={{ margin: '30px 0', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ flex: 1, height: '1px', background: 'rgba(136,146,176,0.25)' }} />
          OR
          <span style={{ flex: 1, height: '1px', background: 'rgba(136,146,176,0.25)' }} />
        </div>

        <button
          className="cyber-button"
          style={{ background: 'transparent', border: '1px solid var(--neon-purple)', color: 'var(--neon-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
          onClick={onCreateRoom}
        >
          <Crown size={20} className="icon-inline" />
          Create Ballroom (GM)
        </button>

        <div style={{ marginTop: '30px', display: 'flex', flexWrap: 'wrap', gap: '8px 15px', justifyContent: 'center' }}>
          <a
            href="/feedback"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            Feedback geben
          </a>
          <a
            href="/datenschutz"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            Datenschutz
          </a>
          <a
            href="/impressum"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            Impressum
          </a>
          <button
            onClick={openCookieSettings}
            style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            Cookie-Einstellungen
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cyber-card phase-enter">
      <h2 style={{ marginBottom: '20px', color: 'var(--neon-purple)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Users size={26} className="icon-inline" />
        JOIN GAME
      </h2>

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

      <div className="segmented-control" style={{ margin: '15px 0 5px 0' }}>
        <button
          className={`segmented-option accent-blue ${danceRole === 'lead' ? 'is-active' : ''}`}
          onClick={() => setDanceRole('lead')}
        >
          I am LEAD
        </button>
        <button
          className={`segmented-option accent-purple ${danceRole === 'follow' ? 'is-active' : ''}`}
          onClick={() => setDanceRole('follow')}
        >
          I am FOLLOW
        </button>
      </div>

      <label className="check-row" style={{ marginBottom: '20px', padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)' }}>
        <input
          type="checkbox"
          checked={isFlexible}
          onChange={(e) => setIsFlexible(e.target.checked)}
        />
        <Repeat size={16} className="icon-inline" style={{ color: 'var(--text-muted)' }} />
        <span style={{ color: 'white', fontSize: '0.9rem' }}>
          Ich bin flexibel (kann zur Not auch die andere Rolle tanzen)
        </span>
      </label>

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
        style={{ background: 'transparent', color: 'var(--text-muted)', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        onClick={() => setView('main')}
      >
        <ArrowLeft size={18} className="icon-inline" />
        BACK
      </button>
    </div>
  );
}

export default Home;
