import React, { useState } from 'react';
import { socket } from '../socket.js';

import { ConfirmModal } from './Modal.jsx';

function PlayerScreen({ room, role, isEliminated, onLeave, clientId }) {
  const [hasVoted, setHasVoted] = useState(false);
  const [showRole, setShowRole] = useState(false);
  const [confirmState, setConfirmState] = useState(null);

  // Reset vote state if round changes or room status changes
  React.useEffect(() => {
    if (room.status === 'dancing') {
      setHasVoted(false);
    }
  }, [room.status, room.round]);

  const me = room.players.find(p => p.id === clientId);
  const myCouple = room.couples ? room.couples.find(c => c.playerIds && c.playerIds.includes(clientId)) : null;

  const handleConfirm = () => {
    socket.emit('confirmPartner', { roomId: room.id, clientId });
  };

  const handleVote = (suspectCoupleId) => {
    socket.emit('castVote', { roomId: room.id, voterId: clientId, suspectId: suspectCoupleId });
    setHasVoted(true);
  };

  const leaveButton = (
    <button 
      onClick={() => {
        if (window.confirm('Leave the dancefloor?')) {
          onLeave();
        }
      }} 
      style={{ position: 'absolute', top: '10px', right: '10px', background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem', zIndex: 10 }}
    >
      ✖
    </button>
  );

  const playerNameTag = me ? (
    <div style={{ position: 'absolute', top: '15px', left: '15px', color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'left' }}>
      <strong>{me.name}</strong><br/>
      <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>{me.danceRole.toUpperCase()}</span>
    </div>
  ) : null;

  if (!me) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', borderColor: 'var(--neon-red)', position: 'relative' }}>
        <h2 className="glitch-text" style={{ color: 'var(--neon-red)', fontSize: '2rem', marginBottom: '20px', marginTop: '20px' }}>KICKED</h2>
        <p style={{ color: 'var(--text-muted)' }}>You have been removed from the ballroom by the GM.</p>
        <button className="cyber-button" onClick={() => onLeave()} style={{ marginTop: '20px' }}>
          Back to Home
        </button>
      </div>
    );
  }

  if (room.status === 'lobby') {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', position: 'relative', paddingTop: '40px' }}>
        {playerNameTag}
        {leaveButton}
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px', marginTop: '20px' }}>LOBBY</h2>
        <div className="pulse-animation" style={{ width: '50px', height: '50px', borderRadius: '50%', background: 'var(--neon-purple)', margin: '0 auto 20px' }}></div>
        <p style={{ color: 'var(--text-muted)' }}>Waiting for the GM to form pairs...</p>
      </div>
    );
  }

  if (room.status === 'paired') {
    if (!myCouple) {
      return (
        <div className="cyber-card" style={{ textAlign: 'center', position: 'relative', paddingTop: '40px' }}>
          {playerNameTag}
          {leaveButton}
          <h2 style={{ color: 'var(--text-muted)', marginBottom: '20px', marginTop: '20px' }}>SPECTATOR</h2>
          <p>You were not assigned to a couple. Enjoy the show!</p>
        </div>
      );
    }

    const partners = myCouple.playerIds.filter(id => id !== clientId).map(id => room.players.find(p => p.id === id)?.name);
    
    return (
      <div className="cyber-card" style={{ textAlign: 'center', position: 'relative', paddingTop: '40px' }}>
        {playerNameTag}
        {leaveButton}
        <h2 style={{ color: 'var(--neon-purple)', marginBottom: '20px', marginTop: '20px' }}>YOUR PARTNER</h2>
        <p style={{ fontSize: '1.2rem', marginBottom: '20px' }}>
          You will be dancing with:<br/>
          <strong style={{ color: 'var(--neon-blue)', fontSize: '1.5rem' }}>{partners.join(' & ')}</strong>
        </p>
        
        {me?.isConfirmed ? (
          <div>
            <p style={{ color: 'var(--neon-blue)' }}>
              {room.players.filter(p => room.couples.some(c => c.playerIds.includes(p.id))).every(p => p.isConfirmed) 
                ? 'All partners confirmed! Waiting for GM to start the game...' 
                : 'Confirmed! Waiting for others...'}
            </p>
            {me?.danceRole === room.votingRole && (
              <div style={{ marginTop: '30px', padding: '15px', border: '1px solid var(--neon-purple)', borderRadius: '10px', background: 'rgba(0,0,0,0.3)' }}>
                <h3 style={{ color: 'var(--text-main)', marginBottom: '15px', fontSize: '1rem' }}>Wessen Handy wird zur Abstimmung genutzt?</h3>
                <div style={{ display: 'flex', gap: '10px' }}>
                  <button 
                    className={`cyber-button ${(!myCouple.votingPlayerId || myCouple.votingPlayerId === clientId) ? 'pulse-animation' : ''}`}
                    style={{ flex: 1, opacity: (!myCouple.votingPlayerId || myCouple.votingPlayerId === clientId) ? 1 : 0.5, padding: '10px', fontSize: '0.9rem' }}
                    onClick={() => socket.emit('delegateVote', { roomId: room.id, coupleId: myCouple.id, votingPlayerId: clientId })}
                  >
                    Mein Handy
                  </button>
                  <button 
                    className={`cyber-button ${(myCouple.votingPlayerId && myCouple.votingPlayerId !== clientId) ? 'pulse-animation' : ''}`}
                    style={{ flex: 1, opacity: (myCouple.votingPlayerId && myCouple.votingPlayerId !== clientId) ? 1 : 0.5, padding: '10px', fontSize: '0.9rem' }}
                    onClick={() => {
                      const partnerId = myCouple.playerIds.find(id => id !== clientId);
                      socket.emit('delegateVote', { roomId: room.id, coupleId: myCouple.id, votingPlayerId: partnerId });
                    }}
                  >
                    Handy des Partners
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <button className="cyber-button pulse-animation" onClick={handleConfirm} style={{ width: '100%' }}>
            FIND THEM & CONFIRM
          </button>
        )}
      </div>
    );
  }

  if (!myCouple) {
    // Spectator view for remaining phases
    return (
      <div className="cyber-card" style={{ textAlign: 'center', position: 'relative', paddingTop: '40px' }}>
        {playerNameTag}
        {leaveButton}
        <h2 style={{ color: 'var(--text-muted)', marginBottom: '20px', marginTop: '20px' }}>SPECTATING</h2>
        <p>The game is in progress.</p>
        <p>Current Phase: <strong>{room.status.toUpperCase()}</strong></p>
      </div>
    );
  }

  if (room.status === 'ended') {
    const winners = room.couples.filter(c => c.status === 'alive');
    const killersWon = winners.some(c => c.role === 'killer');
    const killerCouple = room.couples.find(c => c.role === 'killer');
    
    const playerWon = (role === 'killer' && killersWon) || (role !== 'killer' && !killersWon && !isEliminated);

    return (
      <div className="cyber-card" style={{ textAlign: 'center', position: 'relative', paddingTop: '40px' }}>
        {playerNameTag}
        {leaveButton}
        <h2 className="glitch-text" style={{ 
          color: playerWon ? '#00ff66' : 'var(--neon-red)', 
          fontSize: '2.5rem', 
          marginBottom: '20px', 
          marginTop: '20px', 
          textShadow: playerWon ? '0 0 15px rgba(0,255,102,0.5)' : '0 0 15px rgba(255,42,85,0.5)' 
        }}>
          {playerWon ? 'SIEG' : 'GAME OVER'}
        </h2>
        <h3 style={{ marginBottom: killersWon ? '10px' : '20px', color: killersWon ? 'var(--neon-red)' : 'var(--neon-blue)' }}>
          {killersWon ? '💀 DIE KILLER HABEN GESIEGT 💀' : '✨ DIE TÄNZER HABEN ÜBERLEBT ✨'}
        </h3>
        
        {killersWon && killerCouple && (
          <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px', textShadow: '0 0 10px rgba(255, 42, 85, 0.5)' }}>
            Killer: <strong>{killerCouple.name}</strong>
          </p>
        )}
        
        {(() => {
          if (role === 'killer') {
            if (killersWon) {
              return <p style={{ color: '#00ff66', fontSize: '1.2rem', marginBottom: '20px' }}>Ihr habt alle Tänzer erfolgreich eliminiert!</p>;
            } else {
              return <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>Ihr wurdet entlarvt und eliminiert.</p>;
            }
          } else {
            if (killersWon) {
              if (isEliminated) {
                return <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>Ihr wurdet von den Killern eliminiert.</p>;
              } else {
                return <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>Die Killer haben die Überhand gewonnen. Ihr habt verloren!</p>;
              }
            } else {
              if (isEliminated) {
                return <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>Ihr wurdet eliminiert, aber die restlichen Tänzer haben überlebt!</p>;
              } else {
                return <p style={{ color: '#00ff66', fontSize: '1.2rem', marginBottom: '20px' }}>Die Killer wurden besiegt! Ihr habt überlebt!</p>;
              }
            }
          }
        })()}
        
        <p style={{ color: 'var(--text-muted)' }}>Warte auf den Spielleiter (GM) für eine neue Runde...</p>
      </div>
    );
  }

  // Eliminated players during game
  if (isEliminated) {
    return (
      <div className="cyber-card" style={{ textAlign: 'center', borderColor: 'var(--neon-red)', position: 'relative', paddingTop: '40px' }}>
        {playerNameTag}
        {leaveButton}
        <h2 className="glitch-text" style={{ color: 'var(--neon-red)', fontSize: '2rem', marginBottom: '20px', marginTop: '20px' }}>ELIMINIERT</h2>
        <p style={{ color: 'var(--text-muted)' }}>Bitte verlasst leise die Tanzfläche.</p>
      </div>
    );
  }

  const victimCouple = room.victimId ? room.couples.find(c => c.id === room.victimId) : null;
  const aliveSuspectCouples = room.couples.filter(c => c.status === 'alive' && c.id !== myCouple.id);

  const canVote = myCouple?.votingPlayerId 
    ? myCouple.votingPlayerId === clientId 
    : me?.danceRole === room.votingRole;

  return (
    <div className="cyber-card" style={{ textAlign: 'center', position: 'relative', paddingTop: '40px' }}>
      {playerNameTag}
      {leaveButton}
      {(room.status === 'dancing' || room.status === 'voting' || room.status === 'role_reveal' || room.status === 'kill_reveal' || room.status === 'discussion') && (
        <p style={{ color: 'var(--text-muted)', marginBottom: '10px', marginTop: '20px' }}>ROUND {room.round}</p>
      )}

      {room.status === 'dancing' && (
        <div style={{ padding: '20px', background: 'rgba(0,240,255,0.1)', border: '2px solid var(--neon-blue)', borderRadius: '10px', marginTop: '20px', animation: 'pulse 2s infinite' }}>
          <h2 style={{ color: 'var(--neon-blue)', fontSize: '1.5rem', letterSpacing: '2px' }}>🎵 THE DANCE HAS STARTED 🎵</h2>
          <p style={{ marginTop: '10px', color: 'white' }}>Keep moving and watch your back!</p>
        </div>
      )}

      {room.status === 'kill_reveal' && (() => {
        const victimCouple = room.victimId ? room.couples.find(c => c.id === room.victimId) : null;
        return (
          <div style={{ marginTop: '20px', padding: '20px', borderRadius: '10px', background: victimCouple ? 'rgba(255,0,85,0.1)' : 'rgba(0,240,255,0.1)', border: `2px solid ${victimCouple ? 'var(--neon-red)' : 'var(--neon-blue)'}` }}>
            <h2 style={{ color: victimCouple ? 'var(--neon-red)' : 'var(--neon-blue)', marginBottom: '15px' }}>
              THE MUSIC STOPPED!
            </h2>
            {victimCouple ? (
              <p style={{ fontSize: '1.2rem', color: 'white' }}>
                💀 <strong style={{ color: 'var(--neon-red)' }}>{victimCouple.name}</strong> were eliminated!
              </p>
            ) : (
              <p style={{ fontSize: '1.2rem', color: 'white' }}>
                ✨ Nobody was eliminated... yet.
              </p>
            )}
            <p style={{ color: 'var(--text-muted)', marginTop: '20px' }}>Waiting for GM...</p>
          </div>
        );
      })()}
      {room.status === 'discussion' && (
        <div style={{ padding: '20px', background: 'rgba(255,0,255,0.1)', border: '2px solid var(--neon-purple)', borderRadius: '10px', marginTop: '20px' }}>
          <h2 style={{ color: 'var(--neon-purple)', fontSize: '1.5rem', letterSpacing: '2px', marginBottom: '10px' }}>🗣️ DISCUSSION PHASE 🗣️</h2>
          <p style={{ color: 'white' }}>Discuss! Who murdered whom?</p>
        </div>
      )}
      
      {(room.status === 'role_reveal' || room.status === 'dancing' || room.status === 'kill_reveal') && (
        <div style={{ marginTop: '20px' }}>
          <button 
            className="cyber-button pulse-animation" 
            onMouseDown={() => {
              setShowRole(true);
              if (!me.hasViewedRole) socket.emit('roleViewed', { roomId: room.id, clientId });
            }}
            onMouseUp={() => setShowRole(false)}
            onMouseLeave={() => setShowRole(false)}
            onTouchStart={() => {
              setShowRole(true);
              if (!me.hasViewedRole) socket.emit('roleViewed', { roomId: room.id, clientId });
            }}
            onTouchEnd={() => setShowRole(false)}
            style={{ marginBottom: '20px', userSelect: 'none', WebkitUserSelect: 'none' }}
          >
            GEDRÜCKT HALTEN UM DIE ROLLE ZU SEHEN
          </button>

          {showRole && (
            role === 'killer' ? (
              <div style={{ padding: '30px', background: 'rgba(255,0,85,0.1)', borderRadius: '12px', border: '1px solid var(--neon-red)' }}>
                <h2 className="glitch-text" style={{ color: 'var(--neon-red)', fontSize: '2rem', marginBottom: '15px' }}>🔪 IHR SEID DIE KILLER 🔪</h2>
                <p style={{ fontSize: '1.1rem' }}>Eliminiert heimlich andere Tänzer, während ihr tanzt.<br/><strong style={{color: 'white', marginTop: '10px', display: 'block'}}>WICHTIG: Ihr dürft maximal ein Paar pro Lied umbringen!</strong></p>
              </div>
            ) : (
              <div style={{ padding: '30px', background: 'rgba(0,240,255,0.1)', borderRadius: '12px', border: '1px solid var(--neon-blue)' }}>
                <h2 style={{ color: 'var(--neon-blue)', fontSize: '1.8rem', marginBottom: '15px' }}>IHR SEID TÄNZER</h2>
                <p style={{ fontSize: '1.1rem' }}>Tanzt und überlebt! Lasst euch nicht von den Killern erwischen.</p>
              </div>
            )
          )}
        </div>
      )}

      {room.status === 'voting' && (
        <div style={{ animation: 'fadeIn 0.5s ease-out' }}>
          <h2 style={{ color: 'var(--neon-purple)', marginBottom: '20px' }}>MUSIC STOPPED</h2>
          
          {victimCouple ? (
            <div style={{ padding: '15px', background: 'rgba(255,0,85,0.1)', borderRadius: '8px', border: '1px solid var(--neon-red)', marginBottom: '20px' }}>
              <h3 style={{ color: 'var(--neon-red)' }}>💀 {victimCouple.name} WAS KILLED 💀</h3>
            </div>
          ) : (
            <div style={{ padding: '15px', background: 'rgba(0,240,255,0.1)', borderRadius: '8px', border: '1px solid var(--neon-blue)', marginBottom: '20px' }}>
              <h3 style={{ color: 'var(--neon-blue)' }}>✨ EVERYONE SURVIVED ✨</h3>
            </div>
          )}

          {!canVote ? (
            <div style={{ padding: '30px', borderRadius: '12px', border: '1px solid var(--text-muted)' }}>
              <h3 style={{ color: 'var(--text-muted)' }}>PARTNER IS VOTING</h3>
              <p style={{ marginTop: '10px' }}>In this game, the <strong>{room.votingRole.toUpperCase()}</strong> casts the vote for the couple.</p>
            </div>
          ) : !hasVoted ? (
            <>
              <h3 style={{ marginBottom: '15px' }}>WHO IS THE KILLER?</h3>
              <div className="couple-list">
                {aliveSuspectCouples.map(suspect => (
                  <button 
                    key={suspect.id} 
                    className="cyber-button" 
                    onClick={() => handleVote(suspect.id)}
                  >
                    VOTE: {suspect.name}
                  </button>
                ))}
                <button 
                  className="cyber-button" 
                  style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }}
                  onClick={() => handleVote(null)}
                >
                  SKIP VOTE
                </button>
              </div>
            </>
          ) : (
            <div style={{ padding: '30px', borderRadius: '12px', border: '1px solid var(--neon-purple)' }}>
              <div className="pulse-animation" style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'var(--neon-purple)', margin: '0 auto 15px' }}></div>
              <h3 style={{ color: 'var(--neon-purple)' }}>VOTE CAST</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: '10px' }}>Waiting for other couples to vote...</p>
            </div>
          )}
        </div>
      )}

      <ConfirmModal 
        isOpen={!!confirmState}
        message={confirmState?.message}
        onConfirm={() => {
          confirmState.onConfirm();
          setConfirmState(null);
        }}
        onCancel={() => setConfirmState(null)}
      />
    </div>
  );
}

export default PlayerScreen;
