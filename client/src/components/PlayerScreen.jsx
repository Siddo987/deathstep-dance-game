import React, { useState } from 'react';
import { socket } from '../socket.js';
import { X, Music2, Skull, Sparkles, MessageCircle, Timer, Smartphone } from 'lucide-react';

import { ConfirmModal } from './Modal.jsx';

function PlayerScreen({ room, role, isEliminated, onLeave, clientId }) {
  const [showRole, setShowRole] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [votingTimeLeft, setVotingTimeLeft] = useState(0);

  // Calculate server time offset to prevent countdown starting at wrong times
  const serverOffsetRef = React.useRef(0);
  React.useEffect(() => {
    if (room.serverTime) {
      serverOffsetRef.current = room.serverTime - Date.now();
    }
  }, [room.serverTime]);

  // Handle voting countdown
  const [votingTotal, setVotingTotal] = useState(0);
  React.useEffect(() => {
    if (room.status === 'voting' && room.votingEndTime) {
      setVotingTotal(prev => prev || Math.max(1, Math.ceil((room.votingEndTime - (Date.now() + serverOffsetRef.current)) / 1000)));
      const updateTimer = () => {
        const estimatedServerTime = Date.now() + serverOffsetRef.current;
        const remaining = Math.max(0, Math.ceil((room.votingEndTime - estimatedServerTime) / 1000));
        setVotingTimeLeft(remaining);
      };
      updateTimer();
      const interval = setInterval(updateTimer, 1000);
      return () => clearInterval(interval);
    } else {
      setVotingTotal(0);
    }
  }, [room.status, room.votingEndTime]);

  const me = room.players.find(p => p.id === clientId);
  const myCouple = room.couples ? room.couples.find(c => c.playerIds && c.playerIds.includes(clientId)) : null;

  // Only the couple member currently holding the vote can hand it off, and only
  // to other members who actually have a phone to vote with (a 2-person couple
  // where just one partner has a phone has no one to hand off to; a 3-person
  // group can have 0, 1, or 2 other phone-having partners). If there's nobody
  // to switch to, there's no real choice to offer.
  const otherPhoneHavingPartners = myCouple
    ? myCouple.playerIds
        .filter(id => id !== clientId)
        .map(id => room.players.find(p => p.id === id))
        .filter(p => p && !p.hasNoPhone)
    : [];
  const isCurrentVotingPlayer = !!(myCouple && myCouple.votingPlayerId === clientId);
  const canSwitchVotingRole = isCurrentVotingPlayer && otherPhoneHavingPartners.length > 0;

  // Derived from the server's vote record (not local state) so a page refresh or
  // reconnect after voting doesn't bring the vote form back up.
  const hasVoted = !!(myCouple && room.votes && Object.prototype.hasOwnProperty.call(room.votes, myCouple.id));

  const handleConfirm = () => {
    socket.emit('confirmPartner', { roomId: room.id, clientId });
  };

  const handleVote = (suspectCoupleId) => {
    socket.emit('castVote', { roomId: room.id, voterId: clientId, suspectId: suspectCoupleId });
  };

  const handleLeaveClick = () => {
    setConfirmState({
      message: 'Die Tanzfläche verlassen?',
      onConfirm: onLeave
    });
  };

  const leaveButton = (
    <>
      <button
        onClick={handleLeaveClick}
        className="icon-btn"
        style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 10 }}
        title="Verlassen"
      >
        <X size={20} />
      </button>
      <ConfirmModal
        isOpen={!!confirmState}
        message={confirmState?.message}
        onConfirm={() => confirmState?.onConfirm()}
        onCancel={() => setConfirmState(null)}
      />
    </>
  );

  const playerNameTag = me ? (
    <div style={{ position: 'absolute', top: '15px', left: '15px', right: '50px', color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'left', zIndex: 5 }}>
      <strong style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{me.name}</strong>
      <span style={{ fontSize: '0.8rem', opacity: 0.7 }}>{me.danceRole.toUpperCase()}</span>
      {myCouple && myCouple.playerIds && myCouple.playerIds.length > 1 && (
        <div style={{ marginTop: '4px', fontSize: '0.85rem', color: 'var(--neon-blue)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          w/ {myCouple.playerIds.filter(id => id !== clientId).map(id => room.players.find(p => p.id === id)?.name).filter(Boolean).join(' & ')}
        </div>
      )}
      <div style={{ marginTop: '4px', fontSize: '0.75rem', opacity: 0.5, letterSpacing: '1px' }}>
        ROOM: {room.id}
      </div>
    </div>
  ) : null;

  const votingRoleSwitcher = (
    <div className="panel panel--purple" style={{ marginTop: '30px', marginBottom: 0 }}>
      <div className="panel-title" style={{ justifyContent: 'center' }}>
        <Smartphone size={16} className="icon-inline" />
        Wessen Handy wird zur Abstimmung genutzt?
      </div>
      <div className="segmented-control">
        <button
          className="segmented-option accent-blue is-active pulse-animation"
          onClick={() => myCouple && socket.emit('delegateVote', { roomId: room.id, coupleId: myCouple.id, votingPlayerId: clientId })}
        >
          Mein Handy
        </button>
        {otherPhoneHavingPartners.map(partner => (
          <button
            key={partner.id}
            className="segmented-option accent-purple"
            onClick={() => myCouple && socket.emit('delegateVote', { roomId: room.id, coupleId: myCouple.id, votingPlayerId: partner.id })}
          >
            {otherPhoneHavingPartners.length > 1 ? `Handy von ${partner.name}` : 'Handy des Partners'}
          </button>
        ))}
      </div>
    </div>
  );

  if (!me) {
    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', borderColor: 'var(--neon-red)', position: 'relative' }}>
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
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
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
        <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
          {playerNameTag}
          {leaveButton}
          <h2 style={{ color: 'var(--text-muted)', marginBottom: '20px', marginTop: '20px' }}>SPECTATOR</h2>
          <p>You were not assigned to a couple. Enjoy the show!</p>
        </div>
      );
    }

    const partners = myCouple.playerIds.filter(id => id !== clientId).map(id => room.players.find(p => p.id === id)?.name);

    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
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
            {canSwitchVotingRole && votingRoleSwitcher}
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
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
        {playerNameTag}
        {leaveButton}
        <h2 style={{ color: 'var(--text-muted)', marginBottom: '20px', marginTop: '20px' }}>SPECTATING</h2>
        <p>The game is in progress.</p>
        <p>Current Phase: <strong>{room.status.toUpperCase()}</strong></p>
      </div>
    );
  }

  if (room.status === 'ended') {
    if (room.endReason === 'aborted') {
      return (
        <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
          {playerNameTag}
          {leaveButton}
          <h2 className="glitch-text" style={{ color: 'var(--text-muted)', fontSize: '2.5rem', marginBottom: '20px', marginTop: '20px', textShadow: 'none' }}>
            SPIEL ABGEBROCHEN
          </h2>
          <h3 style={{ color: 'var(--text-muted)' }}>
            Das Spiel wurde vorzeitig durch den GM beendet.
          </h3>
        </div>
      );
    }
    const winners = room.couples.filter(c => c.status === 'alive');
    const killersWon = winners.some(c => c.role === 'killer');
    const killerCouples = room.couples.filter(c => c.role === 'killer');

    // Being voted out/eliminated is a personal loss even if teammates (other killer couples) go on to win.
    const playerWon = !isEliminated && ((role === 'killer' && killersWon) || (role !== 'killer' && !killersWon));

    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
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
        <h3 style={{ marginBottom: killersWon ? '10px' : '20px', color: killersWon ? 'var(--neon-red)' : 'var(--neon-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          {killersWon ? <><Skull size={22} className="icon-inline" /> DIE KILLER HABEN GESIEGT <Skull size={22} className="icon-inline" /></> : <><Sparkles size={22} className="icon-inline" /> DIE TÄNZER HABEN ÜBERLEBT <Sparkles size={22} className="icon-inline" /></>}
        </h3>

        {killersWon && killerCouples.length > 0 && (
          <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px', textShadow: '0 0 10px rgba(255, 42, 85, 0.5)' }}>
            {killerCouples.length > 1 ? 'Killer:' : 'Killer:'} <strong>{killerCouples.map(c => c.name).join(' & ')}</strong>
          </p>
        )}

        {(() => {
          if (role === 'killer') {
            if (isEliminated) {
              return <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>Ihr wurdet entlarvt und eliminiert.</p>;
            } else if (killersWon) {
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
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', borderColor: 'var(--neon-red)', position: 'relative', paddingTop: '90px' }}>
        {playerNameTag}
        {leaveButton}
        <h2 className="glitch-text" style={{ color: 'var(--neon-red)', fontSize: '2rem', marginBottom: '20px', marginTop: '20px' }}>ELIMINIERT</h2>
        <p style={{ color: 'var(--text-muted)' }}>Bitte verlasst leise die Tanzfläche.</p>
      </div>
    );
  }

  const victimCouples = (room.victimIds || []).map(id => room.couples.find(c => c.id === id)).filter(Boolean);
  const aliveSuspectCouples = room.couples.filter(c => c.status === 'alive' && c.id !== myCouple.id);

  const canVote = myCouple?.votingPlayerId
    ? myCouple.votingPlayerId === clientId
    : me?.danceRole === room.votingRole;

  return (
    <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
      {playerNameTag}
      {leaveButton}
      {(room.status === 'dancing' || room.status === 'voting' || room.status === 'role_reveal' || room.status === 'kill_reveal' || room.status === 'discussion') && (
        <p style={{ color: 'var(--text-muted)', marginBottom: '10px', marginTop: '20px' }}>ROUND {room.round}</p>
      )}

      {room.status === 'dancing' && (
        <div className="panel panel--info" style={{ animation: 'pulse 2s infinite' }}>
          <h2 style={{ color: 'var(--neon-blue)', fontSize: '1.5rem', letterSpacing: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <Music2 size={22} className="icon-inline" /> THE DANCE HAS STARTED <Music2 size={22} className="icon-inline" />
          </h2>
          <p style={{ marginTop: '10px', color: 'white' }}>Keep moving and watch your back!</p>
        </div>
      )}

      {room.status === 'kill_reveal' && (() => {
        const victimCouples = (room.victimIds || []).map(id => room.couples.find(c => c.id === id)).filter(Boolean);
        return (
          <div className={`panel ${victimCouples.length > 0 ? 'panel--danger' : 'panel--info'}`}>
            <h2 style={{ color: victimCouples.length > 0 ? 'var(--neon-red)' : 'var(--neon-blue)', marginBottom: '15px' }}>
              THE MUSIC STOPPED!
            </h2>
            {victimCouples.length > 0 ? (
              <p style={{ fontSize: '1.2rem', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Skull size={20} className="icon-inline" style={{ color: 'var(--neon-red)' }} /> <strong style={{ color: 'var(--neon-red)' }}>{victimCouples.map(c => c.name).join(' & ')}</strong> were eliminated!
              </p>
            ) : (
              <p style={{ fontSize: '1.2rem', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Sparkles size={20} className="icon-inline" /> Nobody was eliminated... yet.
              </p>
            )}
            <p style={{ color: 'var(--text-muted)', marginTop: '20px' }}>Waiting for GM...</p>
          </div>
        );
      })()}
      {room.status === 'discussion' && (
        <div className="panel panel--purple">
          <h2 style={{ color: 'var(--neon-purple)', fontSize: '1.5rem', letterSpacing: '2px', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <MessageCircle size={22} className="icon-inline" /> DISCUSSION PHASE
          </h2>
          <p style={{ color: 'white' }}>Discuss! Who murdered whom?</p>
        </div>
      )}

      {(room.status === 'role_reveal' || room.status === 'dancing' || room.status === 'kill_reveal') && (
        <div style={{ marginTop: '20px' }}>
          {room.status === 'role_reveal' && canSwitchVotingRole && (
            <div style={{ marginBottom: '30px' }}>{votingRoleSwitcher}</div>
          )}
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
              <div className="panel panel--danger" style={{ padding: '30px', marginBottom: 0 }}>
                <h2 className="glitch-text" style={{ color: 'var(--neon-red)', fontSize: '2rem', marginBottom: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                  <Skull size={28} className="icon-inline" /> IHR SEID DIE KILLER <Skull size={28} className="icon-inline" />
                </h2>
                <p style={{ fontSize: '1.1rem' }}>Eliminiert heimlich andere Tänzer, während ihr tanzt.<br/><strong style={{color: 'white', marginTop: '10px', display: 'block'}}>WICHTIG: Ihr dürft maximal ein Paar pro Lied umbringen!</strong></p>
              </div>
            ) : (
              <div className="panel panel--info" style={{ padding: '30px', marginBottom: 0 }}>
                <h2 style={{ color: 'var(--neon-blue)', fontSize: '1.8rem', marginBottom: '15px' }}>IHR SEID TÄNZER</h2>
                <p style={{ fontSize: '1.1rem' }}>Tanzt und überlebt! Lasst euch nicht von den Killern erwischen.</p>
              </div>
            )
          )}
        </div>
      )}

      {room.status === 'voting' && (
        <div className="phase-enter">
          <h2 style={{ color: 'var(--neon-purple)', marginBottom: '20px' }}>MUSIC STOPPED</h2>

          {victimCouples.length > 0 ? (
            <div className="panel panel--danger">
              <h3 style={{ color: 'var(--neon-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Skull size={18} className="icon-inline" /> {victimCouples.map(c => c.name).join(' & ')} WAS KILLED
              </h3>
            </div>
          ) : (
            <div className="panel panel--info">
              <h3 style={{ color: 'var(--neon-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Sparkles size={18} className="icon-inline" /> EVERYONE SURVIVED
              </h3>
            </div>
          )}

          {!canVote ? (
            <div className="panel" style={{ textAlign: 'center' }}>
              <h3 style={{ color: 'var(--text-muted)' }}>PARTNER IS VOTING</h3>
              <p style={{ marginTop: '10px' }}>
                Based on the selection made at the beginning of the round, your partner is casting the vote for your couple on their device.
              </p>
            </div>
          ) : !hasVoted && votingTimeLeft > 0 ? (
            <>
              <div style={{ fontSize: '2rem', fontWeight: 'bold', color: votingTimeLeft <= 10 ? 'var(--neon-red)' : 'var(--neon-purple)', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                <Timer size={26} className="icon-inline" /> {votingTimeLeft}s
              </div>
              <div className="progress-track" style={{ marginBottom: '20px' }}>
                <div
                  className="progress-fill"
                  style={{
                    width: `${votingTotal ? (votingTimeLeft / votingTotal) * 100 : 100}%`,
                    background: votingTimeLeft <= 10 ? 'var(--neon-red)' : 'var(--neon-purple)'
                  }}
                />
              </div>
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
          ) : !hasVoted && votingTimeLeft === 0 ? (
            <div className="panel panel--danger" style={{ textAlign: 'center' }}>
              <h3 style={{ color: 'var(--neon-red)' }}>TIME IS UP</h3>
              <p style={{ marginTop: '10px' }}>You missed the voting window.</p>
            </div>
          ) : (
            <div className="panel panel--purple" style={{ textAlign: 'center' }}>
              <div className="pulse-animation" style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'var(--neon-purple)', margin: '0 auto 15px' }}></div>
              <h3 style={{ color: 'var(--neon-purple)' }}>VOTE CAST</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: '10px' }}>Waiting for other couples to vote...</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PlayerScreen;
