import React, { useState } from 'react';
import { socket } from '../socket.js';
import { X, Music2, Skull, Sparkles, MessageCircle, Timer, Smartphone } from 'lucide-react';

import { ConfirmModal } from './Modal.jsx';
import { useLanguage } from '../i18n.jsx';

function PlayerScreen({ room, role, isEliminated, onLeave, clientId }) {
  const { t } = useLanguage();
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

  const otherKillerCouples = role === 'killer' && room.couples
    ? room.couples.filter(c => c.role === 'killer' && (!myCouple || c.id !== myCouple.id))
    : [];

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
      message: t('player.leaveConfirm'),
      onConfirm: onLeave
    });
  };

  const leaveButton = (
    <>
      <button
        onClick={handleLeaveClick}
        className="icon-btn"
        style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 10 }}
        title={t('common.leave')}
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
          {t('player.with')} {myCouple.playerIds.filter(id => id !== clientId).map(id => room.players.find(p => p.id === id)?.name).filter(Boolean).join(' & ')}
        </div>
      )}
      <div style={{ marginTop: '4px', fontSize: '0.75rem', opacity: 0.5, letterSpacing: '1px' }}>
        {t('player.room')}: {room.id}
      </div>
    </div>
  ) : null;

  const votingRoleSwitcher = (
    <div className="panel panel--purple" style={{ marginTop: '30px', marginBottom: 0 }}>
      <div className="panel-title" style={{ justifyContent: 'center' }}>
        <Smartphone size={16} className="icon-inline" />
        {t('player.votingPhoneQuestion')}
      </div>
      <div className="segmented-control">
        <button
          className="segmented-option accent-blue is-active pulse-animation"
          onClick={() => myCouple && socket.emit('delegateVote', { roomId: room.id, coupleId: myCouple.id, votingPlayerId: clientId })}
        >
          {t('player.myPhone')}
        </button>
        {otherPhoneHavingPartners.map(partner => (
          <button
            key={partner.id}
            className="segmented-option accent-purple"
            onClick={() => myCouple && socket.emit('delegateVote', { roomId: room.id, coupleId: myCouple.id, votingPlayerId: partner.id })}
          >
            {otherPhoneHavingPartners.length > 1 ? t('player.phoneOf', { name: partner.name }) : t('player.partnersPhone')}
          </button>
        ))}
      </div>
    </div>
  );

  if (!me) {
    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', borderColor: 'var(--neon-red)', position: 'relative' }}>
        <h2 className="glitch-text" style={{ color: 'var(--neon-red)', fontSize: '2rem', marginBottom: '20px', marginTop: '20px' }}>{t('player.kickedTitle')}</h2>
        <p style={{ color: 'var(--text-muted)' }}>{t('player.kickedBody')}</p>
        <button className="cyber-button" onClick={() => onLeave()} style={{ marginTop: '20px' }}>
          {t('player.backHome')}
        </button>
      </div>
    );
  }

  if (room.status === 'lobby') {
    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
        {playerNameTag}
        {leaveButton}
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px', marginTop: '20px' }}>{t('phase.lobby')}</h2>
        <div className="pulse-animation" style={{ width: '50px', height: '50px', borderRadius: '50%', background: 'var(--neon-purple)', margin: '0 auto 20px' }}></div>
        <p style={{ color: 'var(--text-muted)' }}>{t('player.lobbyWait')}</p>
      </div>
    );
  }

  if (room.status === 'paired') {
    if (!myCouple) {
      return (
        <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
          {playerNameTag}
          {leaveButton}
          <h2 style={{ color: 'var(--text-muted)', marginBottom: '20px', marginTop: '20px' }}>{t('player.spectatorTitle')}</h2>
          <p>{t('player.spectatorBody')}</p>
        </div>
      );
    }

    const partners = myCouple.playerIds.filter(id => id !== clientId).map(id => room.players.find(p => p.id === id)?.name);

    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
        {playerNameTag}
        {leaveButton}
        <h2 style={{ color: 'var(--neon-purple)', marginBottom: '20px', marginTop: '20px' }}>{t('player.partnerTitle')}</h2>
        <p style={{ fontSize: '1.2rem', marginBottom: '20px' }}>
          {t('player.dancingWith')}<br/>
          <strong style={{ color: 'var(--neon-blue)', fontSize: '1.5rem' }}>{partners.join(' & ')}</strong>
        </p>

        {me?.isConfirmed ? (
          <div>
            <p style={{ color: 'var(--neon-blue)' }}>
              {room.players.filter(p => room.couples.some(c => c.playerIds.includes(p.id))).every(p => p.isConfirmed)
                ? t('player.allConfirmed')
                : t('player.confirmedWaiting')}
            </p>
            {canSwitchVotingRole && votingRoleSwitcher}
          </div>
        ) : (
          <button className="cyber-button pulse-animation" onClick={handleConfirm} style={{ width: '100%' }}>
            {t('player.findConfirm')}
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
        <h2 style={{ color: 'var(--text-muted)', marginBottom: '20px', marginTop: '20px' }}>{t('player.spectatingTitle')}</h2>
        <p>{t('player.gameInProgress')}</p>
        <p>{t('player.currentPhase')} <strong>{t(`phase.${room.status}`)}</strong></p>
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
            {t('player.abortedTitle')}
          </h2>
          <h3 style={{ color: 'var(--text-muted)' }}>
            {t('player.abortedBody')}
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
          {playerWon ? t('player.victory') : t('player.gameOver')}
        </h2>
        <h3 style={{ marginBottom: killersWon ? '10px' : '20px', color: killersWon ? 'var(--neon-red)' : 'var(--neon-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          {killersWon ? <><Skull size={22} className="icon-inline" /> {t('player.killersWon')} <Skull size={22} className="icon-inline" /></> : <><Sparkles size={22} className="icon-inline" /> {t('player.dancersSurvived')} <Sparkles size={22} className="icon-inline" /></>}
        </h3>

        {killersWon && killerCouples.length > 0 && (
          <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px', textShadow: '0 0 10px rgba(255, 42, 85, 0.5)' }}>
            {t('player.killerLabel')} <strong>{killerCouples.map(c => c.name).join(' & ')}</strong>
          </p>
        )}

        {(() => {
          if (role === 'killer') {
            if (isEliminated) {
              return <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>{t('player.outExposed')}</p>;
            } else if (killersWon) {
              return <p style={{ color: '#00ff66', fontSize: '1.2rem', marginBottom: '20px' }}>{t('player.outKillersWin')}</p>;
            } else {
              return <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>{t('player.outExposed')}</p>;
            }
          } else {
            if (killersWon) {
              if (isEliminated) {
                return <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>{t('player.outEliminatedByKillers')}</p>;
              } else {
                return <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>{t('player.outKillersOverpowered')}</p>;
              }
            } else {
              if (isEliminated) {
                return <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>{t('player.outEliminatedButSurvived')}</p>;
              } else {
                return <p style={{ color: '#00ff66', fontSize: '1.2rem', marginBottom: '20px' }}>{t('player.outKillersDefeated')}</p>;
              }
            }
          }
        })()}

        <p style={{ color: 'var(--text-muted)' }}>{t('player.waitNewRound')}</p>
      </div>
    );
  }

  // Eliminated players during game
  if (isEliminated) {
    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', borderColor: 'var(--neon-red)', position: 'relative', paddingTop: '90px' }}>
        {playerNameTag}
        {leaveButton}
        <h2 className="glitch-text" style={{ color: 'var(--neon-red)', fontSize: '2rem', marginBottom: '20px', marginTop: '20px' }}>{t('player.eliminatedTitle')}</h2>
        <p style={{ color: 'var(--text-muted)' }}>{t('player.eliminatedBody')}</p>
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
        <p style={{ color: 'var(--text-muted)', marginBottom: '10px', marginTop: '20px' }}>{t('player.round', { n: room.round })}</p>
      )}

      {room.status === 'dancing' && (
        <div className="panel panel--info" style={{ animation: 'pulse 2s infinite' }}>
          <h2 style={{ color: 'var(--neon-blue)', fontSize: '1.5rem', letterSpacing: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <Music2 size={22} className="icon-inline" /> {t('player.danceStarted')} <Music2 size={22} className="icon-inline" />
          </h2>
          <p style={{ marginTop: '10px', color: 'white' }}>{t('player.danceBody')}</p>
        </div>
      )}

      {room.status === 'kill_reveal' && (() => {
        const victimCouples = (room.victimIds || []).map(id => room.couples.find(c => c.id === id)).filter(Boolean);
        return (
          <div className={`panel ${victimCouples.length > 0 ? 'panel--danger' : 'panel--info'}`}>
            <h2 style={{ color: victimCouples.length > 0 ? 'var(--neon-red)' : 'var(--neon-blue)', marginBottom: '15px' }}>
              {t('player.musicStopped')}
            </h2>
            {victimCouples.length > 0 ? (
              <p style={{ fontSize: '1.2rem', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Skull size={20} className="icon-inline" style={{ color: 'var(--neon-red)' }} /> <strong style={{ color: 'var(--neon-red)' }}>{t('player.wereEliminated', { names: victimCouples.map(c => c.name).join(' & ') })}</strong>
              </p>
            ) : (
              <p style={{ fontSize: '1.2rem', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Sparkles size={20} className="icon-inline" /> {t('player.nobodyEliminatedYet')}
              </p>
            )}
            <p style={{ color: 'var(--text-muted)', marginTop: '20px' }}>{t('player.waitingGm')}</p>
          </div>
        );
      })()}
      {room.status === 'discussion' && (
        <div className="panel panel--purple">
          <h2 style={{ color: 'var(--neon-purple)', fontSize: '1.5rem', letterSpacing: '2px', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <MessageCircle size={22} className="icon-inline" /> {t('player.discussionTitle')}
          </h2>
          <p style={{ color: 'white' }}>{t('player.discussionBody')}</p>
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
            {t('player.holdToSeeRole')}
          </button>

          {showRole && (
            role === 'killer' ? (
              <div className="panel panel--danger" style={{ padding: '30px', marginBottom: 0 }}>
                <h2 className="glitch-text" style={{ color: 'var(--neon-red)', fontSize: '2rem', marginBottom: '15px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
                  <Skull size={28} className="icon-inline" /> {t('player.youAreKillers')} <Skull size={28} className="icon-inline" />
                </h2>
                <p style={{ fontSize: '1.1rem' }}>{t('player.killerInstructions')}<br/><strong style={{color: 'white', marginTop: '10px', display: 'block'}}>{t('player.killerLimit')}</strong></p>
                {otherKillerCouples.length > 0 && (
                  <p style={{ fontSize: '1rem', marginTop: '15px', color: 'white' }}>
                    {t('player.otherKillers', { names: otherKillerCouples.map(c => c.name).join(', ') })}
                  </p>
                )}
              </div>
            ) : (
              <div className="panel panel--info" style={{ padding: '30px', marginBottom: 0 }}>
                <h2 style={{ color: 'var(--neon-blue)', fontSize: '1.8rem', marginBottom: '15px' }}>{t('player.youAreDancers')}</h2>
                <p style={{ fontSize: '1.1rem' }}>{t('player.dancerInstructions')}</p>
              </div>
            )
          )}
        </div>
      )}

      {room.status === 'voting' && (
        <div className="phase-enter">
          <h2 style={{ color: 'var(--neon-purple)', marginBottom: '20px' }}>{t('player.votingMusicStopped')}</h2>

          {victimCouples.length > 0 ? (
            <div className="panel panel--danger">
              <h3 style={{ color: 'var(--neon-red)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Skull size={18} className="icon-inline" /> {t('player.wasKilled', { names: victimCouples.map(c => c.name).join(' & ') })}
              </h3>
            </div>
          ) : (
            <div className="panel panel--info">
              <h3 style={{ color: 'var(--neon-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Sparkles size={18} className="icon-inline" /> {t('player.everyoneSurvived')}
              </h3>
            </div>
          )}

          {!canVote ? (
            <div className="panel" style={{ textAlign: 'center' }}>
              <h3 style={{ color: 'var(--text-muted)' }}>{t('player.partnerVoting')}</h3>
              <p style={{ marginTop: '10px' }}>
                {t('player.partnerVotingBody')}
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
              <h3 style={{ marginBottom: '15px' }}>{t('player.whoIsKiller')}</h3>
              <div className="couple-list">
                {aliveSuspectCouples.map(suspect => (
                  <button
                    key={suspect.id}
                    className="cyber-button"
                    onClick={() => handleVote(suspect.id)}
                  >
                    {t('player.voteFor', { name: suspect.name })}
                  </button>
                ))}
                <button
                  className="cyber-button"
                  style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }}
                  onClick={() => handleVote(null)}
                >
                  {t('player.skipVote')}
                </button>
              </div>
            </>
          ) : !hasVoted && votingTimeLeft === 0 ? (
            <div className="panel panel--danger" style={{ textAlign: 'center' }}>
              <h3 style={{ color: 'var(--neon-red)' }}>{t('player.timeUp')}</h3>
              <p style={{ marginTop: '10px' }}>{t('player.timeUpBody')}</p>
            </div>
          ) : (
            <div className="panel panel--purple" style={{ textAlign: 'center' }}>
              <div className="pulse-animation" style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'var(--neon-purple)', margin: '0 auto 15px' }}></div>
              <h3 style={{ color: 'var(--neon-purple)' }}>{t('player.voteCast')}</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: '10px' }}>{t('player.voteCastBody')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default PlayerScreen;
