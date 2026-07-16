import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { socket } from '../socket.js';
import { X, Music2, Skull, Sparkles, MessageCircle, Timer, Smartphone, Search, Send, Plus } from 'lucide-react';

import { ConfirmModal } from './Modal.jsx';
import { useLanguage } from '../i18n.jsx';
import { loginWithSpotify, searchTracks, getValidToken } from '../spotify.js';
import { fetchMyPlaylists, fetchPlaylist, createPlaylist, addTrackToPlaylist } from '../spotifyPlaylists.js';

function PlayerScreen({ room, role, isEliminated, onLeave, clientId, currentUser }) {
  const { t } = useLanguage();
  const [showRole, setShowRole] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [votingTimeLeft, setVotingTimeLeft] = useState(0);

  // Song suggestions - three ways to suggest, gated by what the player has
  // connected: plain text always works (no Spotify needed); a player's own
  // device can also connect to Spotify the same way the GM does
  // (client/src/spotify.js, local PKCE flow, no Deathstep account needed) to
  // search real tracks; and a logged-in Deathstep account with imported
  // playlists (server/playlists.js) can pick a track from one of those. Each
  // is independent of the GM's own Spotify session/account.
  const [showSongSuggest, setShowSongSuggest] = useState(false);
  const [spotifySuggestToken, setSpotifySuggestToken] = useState(null);
  const [suggestMode, setSuggestMode] = useState('text'); // 'text' | 'spotify' | 'playlist'
  const [suggestText, setSuggestText] = useState('');
  const [suggestQuery, setSuggestQuery] = useState('');
  const [suggestResults, setSuggestResults] = useState([]);
  const [suggestSearchDone, setSuggestSearchDone] = useState(false); // true once a search has actually returned, so an empty result set can say "no results" instead of looking unsearched
  const [suggestJustSent, setSuggestJustSent] = useState(false);
  const [suggestErrorKey, setSuggestErrorKey] = useState('');
  const [playerPlaylists, setPlayerPlaylists] = useState([]);
  const [activeSuggestPlaylist, setActiveSuggestPlaylist] = useState(null);

  // Post-game "played songs" summary - lets a logged-in player add any track
  // from the game straight into one of their own playlists.
  const [addToPlaylistFor, setAddToPlaylistFor] = useState(null); // track uri whose picker is expanded, or null
  const [addToPlaylistNewName, setAddToPlaylistNewName] = useState('');
  const [addToPlaylistStatus, setAddToPlaylistStatus] = useState('');

  React.useEffect(() => {
    getValidToken().then(token => { if (token) setSpotifySuggestToken(token); });
  }, []);

  React.useEffect(() => {
    if (!currentUser) { setPlayerPlaylists([]); return; }
    let cancelled = false;
    fetchMyPlaylists().then(result => { if (!cancelled && !result.error) setPlayerPlaylists(result.playlists); });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  const handleAddTrackToPlaylist = async (playlistId, track) => {
    const result = await addTrackToPlaylist(playlistId, { uri: track.uri, name: track.name, artist: track.artist });
    const messageKey = result.error ? 'gm.addToPlaylistFailed' : result.track?.syncStatus === 'pending_add' ? 'gm.addToPlaylistPending' : 'gm.addToPlaylistSuccess';
    setAddToPlaylistStatus(t(messageKey));
    setTimeout(() => setAddToPlaylistStatus(''), 2500);
    if (!result.error) setAddToPlaylistFor(null);
  };

  const handleCreatePlaylistWithTrack = async (track) => {
    const name = addToPlaylistNewName.trim();
    if (!name) return;
    const created = await createPlaylist(name);
    if (created.error) return;
    setPlayerPlaylists(prev => [...prev, created.playlist]);
    setAddToPlaylistNewName('');
    await handleAddTrackToPlaylist(created.playlist.id, track);
  };

  // Post-game summary of every track the server recorded as actually played
  // (server/gameStore.js addPlayedSong) - empty whenever the GM used
  // own-audio mode the whole game, since the app never sees what plays
  // externally.
  const renderPlayedSongs = () => {
    if (!room.playedSongs || room.playedSongs.length === 0) return null;
    return (
      <div className="panel panel--success" style={{ textAlign: 'left', marginTop: '20px' }}>
        <div className="panel-title" style={{ color: 'var(--neon-green)' }}>
          <Music2 size={16} className="icon-inline" /> {t('player.playedSongs')}
        </div>
        {room.playedSongs.map(song => {
          const rowKey = `${song.uri}-${song.playedAt}`;
          return (
          <div key={rowKey} style={{ marginBottom: '10px' }}>
            <div className="list-item">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.name}</div>
                <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.artist}</div>
              </div>
              {currentUser && (
                <button
                  className="icon-btn"
                  title={t('gm.addToPlaylist')}
                  style={{ flexShrink: 0 }}
                  onClick={() => setAddToPlaylistFor(prev => prev === rowKey ? null : rowKey)}
                >
                  <Plus size={18} style={{ color: 'var(--neon-purple)' }} />
                </button>
              )}
            </div>
            {currentUser && addToPlaylistFor === rowKey && (
              <div style={{ border: '1px solid var(--neon-purple)', borderRadius: 'var(--radius-sm)', padding: '12px' }}>
                {playerPlaylists.length > 0 && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '10px' }}>
                    {playerPlaylists.map(pl => (
                      <button
                        key={pl.id}
                        onClick={() => handleAddTrackToPlaylist(pl.id, song)}
                        style={{ textAlign: 'left', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 12px', color: 'var(--text-main)', cursor: 'pointer', fontSize: '0.85rem' }}
                      >
                        {pl.name}
                      </button>
                    ))}
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
                  <button className="cyber-button" style={{ width: 'auto', padding: '8px 14px', fontSize: '0.85rem' }} onClick={() => handleCreatePlaylistWithTrack(song)}>
                    <Plus size={14} className="icon-inline" />
                  </button>
                </div>
                {addToPlaylistStatus && (
                  <p style={{ color: 'var(--neon-green)', fontSize: '0.8rem', textAlign: 'center', marginTop: '8px', marginBottom: 0 }}>{addToPlaylistStatus}</p>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>
    );
  };

  const mySuggestions = (room.songSuggestions || []).filter(s => s.playerId === clientId);

  const sendSuggestion = (suggestion) => {
    setSuggestErrorKey('');
    socket.emit('suggestSong', { roomId: room.id, clientId, suggestion }, (response) => {
      if (!response?.success) {
        setSuggestErrorKey(`server.${response?.messageKey || 'suggestionFailed'}`);
      }
    });
    setSuggestJustSent(true);
    setTimeout(() => setSuggestJustSent(false), 2500);
  };

  const handleSuggestSearch = async (e) => {
    e.preventDefault();
    if (!suggestQuery.trim()) return;
    try {
      const results = await searchTracks(suggestQuery);
      setSuggestResults(results);
      setSuggestSearchDone(true);
    } catch (err) {
      console.error('Failed to search tracks', err);
    }
  };

  const handleSuggestTrack = (track) => {
    sendSuggestion({ type: 'spotify', track });
    setSuggestResults([]);
    setSuggestSearchDone(false);
    setSuggestQuery('');
  };

  const handleSuggestTextSubmit = (e) => {
    e.preventDefault();
    const text = suggestText.trim();
    if (!text) return;
    sendSuggestion({ type: 'text', text });
    setSuggestText('');
  };

  const handlePickSuggestPlaylist = async (playlistId) => {
    const result = await fetchPlaylist(playlistId);
    if (!result.error) setActiveSuggestPlaylist(result.playlist);
  };

  // Playlist tracks are stored as { uri, name, artist } (artist is a plain
  // string) - normalized here into the same { name, artists: [...] } shape a
  // Spotify search result has, so the GM's suggestion panel can render either
  // kind identically.
  const handleSuggestPlaylistTrack = (track) => {
    sendSuggestion({ type: 'spotify', track: { uri: track.uri, name: track.name, artists: [{ name: track.artist }], album: { images: [] } } });
  };

  // Silent-report dancing phase: whether this couple's non-killer felt killed this round, and
  // the decoy puzzle shown to those who say "no" (regenerated once per round, unchecked).
  const [feltKilledChoice, setFeltKilledChoice] = useState(null);
  const [decoyAnswer, setDecoyAnswer] = useState('');
  const decoyPuzzle = React.useMemo(() => ({
    a: 1 + Math.floor(Math.random() * 20),
    b: 1 + Math.floor(Math.random() * 20)
  }), [room.round]);
  React.useEffect(() => {
    setFeltKilledChoice(null);
    setDecoyAnswer('');
  }, [room.round]);

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

  const handleSubmitKillClaim = (victimCoupleId, victimName) => {
    setConfirmState({
      message: victimCoupleId ? t('player.confirmKillClaim', { name: victimName }) : t('player.confirmKillClaimNobody'),
      onConfirm: () => socket.emit('submitKillClaim', { roomId: room.id, clientId, victimId: victimCoupleId })
    });
  };

  const handleSubmitVictimReport = (feltKilled, suspectCoupleId) => {
    socket.emit('submitVictimReport', { roomId: room.id, clientId, feltKilled, suspectId: suspectCoupleId });
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

  const songSuggestButton = (
    <>
      <button
        onClick={() => setShowSongSuggest(true)}
        className="icon-btn"
        style={{ position: 'absolute', top: '54px', right: '10px', zIndex: 10 }}
        title={t('player.suggestSongTitle')}
      >
        <Music2 size={20} />
      </button>
      {showSongSuggest && createPortal(
        <div className="modal-overlay" onClick={() => setShowSongSuggest(false)}>
          <div className="modal-card cyber-card" style={{ maxWidth: '420px', border: '1px solid var(--neon-green)' }} onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn modal-close-btn" onClick={() => setShowSongSuggest(false)}>
              <X size={20} />
            </button>
            <h3 style={{ color: 'var(--neon-green)', marginBottom: '15px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              <Music2 size={20} />
              {t('player.suggestSongTitle')}
            </h3>

            {spotifySuggestToken && (
              <div className="segmented-control" style={{ marginBottom: '15px' }}>
                <button className={`segmented-option accent-green ${suggestMode === 'text' ? 'is-active' : ''}`} onClick={() => setSuggestMode('text')}>
                  {t('player.suggestModeText')}
                </button>
                <button className={`segmented-option accent-green ${suggestMode === 'spotify' ? 'is-active' : ''}`} onClick={() => setSuggestMode('spotify')}>
                  {t('player.suggestModeSpotify')}
                </button>
                {currentUser && playerPlaylists.length > 0 && (
                  <button className={`segmented-option accent-green ${suggestMode === 'playlist' ? 'is-active' : ''}`} onClick={() => setSuggestMode('playlist')}>
                    {t('player.suggestModePlaylist')}
                  </button>
                )}
              </div>
            )}

            {(!spotifySuggestToken || suggestMode === 'text') && (
              <form onSubmit={handleSuggestTextSubmit} style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                <input
                  type="text"
                  className="cyber-input"
                  style={{ marginBottom: 0, flex: 1 }}
                  placeholder={t('player.suggestTextPlaceholder')}
                  value={suggestText}
                  onChange={(e) => setSuggestText(e.target.value)}
                  maxLength={200}
                />
                <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '0 16px' }}>
                  <Send size={16} className="icon-inline" />
                </button>
              </form>
            )}

            {!spotifySuggestToken && (
              <button className="cyber-button" style={{ background: 'transparent', border: '1px solid var(--neon-green)', color: 'var(--neon-green)' }} onClick={loginWithSpotify}>
                {t('player.connectForMoreOptions')}
              </button>
            )}

            {spotifySuggestToken && suggestMode === 'spotify' && (
              <>
                <form onSubmit={handleSuggestSearch} style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
                  <input
                    type="text"
                    className="cyber-input"
                    style={{ marginBottom: 0, flex: 1 }}
                    placeholder={t('spotify.searchPlaceholder')}
                    value={suggestQuery}
                    onChange={(e) => { setSuggestQuery(e.target.value); setSuggestSearchDone(false); }}
                  />
                  <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '0 16px' }}>
                    <Search size={16} className="icon-inline" />
                  </button>
                </form>

                {suggestResults.length > 0 && (
                  <div className="couple-list" style={{ marginTop: 0, marginBottom: '15px' }}>
                    {suggestResults.map(track => (
                      <div
                        key={track.id}
                        onClick={() => handleSuggestTrack(track)}
                        className="list-item list-item--purple"
                        style={{ cursor: 'pointer' }}
                      >
                        <img src={track.album.images[2]?.url} alt="" style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{track.name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{track.artists.map(a => a.name).join(', ')}</div>
                        </div>
                        <Send size={16} className="icon-inline" style={{ color: 'var(--neon-green)', flexShrink: 0 }} />
                      </div>
                    ))}
                  </div>
                )}
                {suggestSearchDone && suggestResults.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '15px', fontSize: '0.9rem' }}>{t('spotify.noResults')}</p>
                )}
              </>
            )}

            {spotifySuggestToken && suggestMode === 'playlist' && (
              <>
                {!activeSuggestPlaylist ? (
                  <div className="couple-list" style={{ marginTop: 0, marginBottom: '15px' }}>
                    {playerPlaylists.map(pl => (
                      <div
                        key={pl.id}
                        onClick={() => handlePickSuggestPlaylist(pl.id)}
                        className="list-item list-item--purple"
                        style={{ cursor: 'pointer' }}
                      >
                        <Music2 size={20} className="icon-inline" style={{ color: 'var(--neon-purple)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{pl.name}</div>
                          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{t('playlists.trackCount', { count: pl.trackCount })}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <button
                      onClick={() => setActiveSuggestPlaylist(null)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', marginBottom: '10px', padding: 0 }}
                    >
                      {t('common.back')}
                    </button>
                    <div className="couple-list" style={{ marginTop: 0, marginBottom: '15px' }}>
                      {activeSuggestPlaylist.tracks.length === 0 && (
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('playlists.noTracks')}</p>
                      )}
                      {activeSuggestPlaylist.tracks.map(track => (
                        <div
                          key={track.id}
                          onClick={() => handleSuggestPlaylistTrack(track)}
                          className="list-item list-item--purple"
                          style={{ cursor: 'pointer' }}
                        >
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{track.name}</div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{track.artist}</div>
                          </div>
                          <Send size={16} className="icon-inline" style={{ color: 'var(--neon-green)', flexShrink: 0 }} />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </>
            )}

            {suggestJustSent && !suggestErrorKey && (
              <p style={{ color: 'var(--neon-green)', textAlign: 'center', marginBottom: '10px', fontSize: '0.9rem' }}>{t('player.suggestSent')}</p>
            )}
            {suggestErrorKey && (
              <p style={{ color: 'var(--neon-red)', textAlign: 'center', marginBottom: '10px', fontSize: '0.9rem' }}>{t(suggestErrorKey)}</p>
            )}

            {mySuggestions.length > 0 && (
              <div style={{ marginTop: '10px' }}>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '8px', textTransform: 'uppercase' }}>{t('player.yourSuggestions')}</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  {mySuggestions.map(s => (
                    <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                      <span>{s.type === 'text' ? s.text : `${s.track.name} — ${s.track.artists.map(a => a.name).join(', ')}`}</span>
                      <span style={{ color: 'var(--neon-purple)' }}>{t('player.suggestionPending')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>,
        document.body
      )}
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
        {songSuggestButton}
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
        {songSuggestButton}
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
        {songSuggestButton}
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
        {songSuggestButton}
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
        {songSuggestButton}
          <h2 className="glitch-text" style={{ color: 'var(--text-muted)', fontSize: '2.5rem', marginBottom: '20px', marginTop: '20px', textShadow: 'none' }}>
            {t('player.abortedTitle')}
          </h2>
          <h3 style={{ color: 'var(--text-muted)' }}>
            {t('player.abortedBody')}
          </h3>
          {renderPlayedSongs()}
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
        {songSuggestButton}
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
        {renderPlayedSongs()}
      </div>
    );
  }

  // Eliminated players during game
  if (isEliminated) {
    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', borderColor: 'var(--neon-red)', position: 'relative', paddingTop: '90px' }}>
        {playerNameTag}
        {leaveButton}
        {songSuggestButton}
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
        {songSuggestButton}
      {(room.status === 'dancing' || room.status === 'silent_report' || room.status === 'voting' || room.status === 'role_reveal' || room.status === 'kill_reveal' || room.status === 'discussion') && (
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

      {room.status === 'silent_report' && (
        <div className="panel panel--purple">
          <h2 style={{ color: 'var(--neon-purple)', fontSize: '1.5rem', letterSpacing: '2px', marginBottom: '10px' }}>
            {t('player.silentReportPhaseTitle')}
          </h2>
          <p style={{ color: 'white' }}>{t('player.silentReportPhaseBody')}</p>
        </div>
      )}

      {room.status === 'silent_report' && myCouple.status === 'alive' && (() => {
        const hasSubmittedKillClaim = !!(room.killClaims && Object.prototype.hasOwnProperty.call(room.killClaims, myCouple.id));
        const hasSubmittedVictimReport = !!(room.victimReports && Object.prototype.hasOwnProperty.call(room.victimReports, myCouple.id));
        const isKiller = role === 'killer';
        const hasSubmitted = isKiller ? hasSubmittedKillClaim : hasSubmittedVictimReport;

        if (!canVote) {
          return (
            <div className="panel" style={{ textAlign: 'center', marginTop: '20px' }}>
              <h3 style={{ color: 'var(--text-muted)' }}>{t('player.partnerActing')}</h3>
              <p style={{ marginTop: '10px' }}>{t('player.partnerActingBody')}</p>
            </div>
          );
        }

        if (hasSubmitted) {
          return (
            <div className="panel panel--purple" style={{ textAlign: 'center', marginTop: '20px' }}>
              <div className="pulse-animation" style={{ width: '30px', height: '30px', borderRadius: '50%', background: 'var(--neon-purple)', margin: '0 auto 15px' }}></div>
              <h3 style={{ color: 'var(--neon-purple)' }}>{t('player.silentReportSubmitted')}</h3>
              <p style={{ color: 'var(--text-muted)', marginTop: '10px' }}>{t('player.silentReportSubmittedBody')}</p>
            </div>
          );
        }

        if (isKiller) {
          return (
            <div className="panel panel--danger" style={{ marginTop: '20px' }}>
              <h3 style={{ color: 'var(--neon-red)', marginBottom: '15px' }}>{t('player.whoDidYouKill')}</h3>
              <div className="couple-list">
                {aliveSuspectCouples.filter(c => c.role !== 'killer').map(c => (
                  <button key={c.id} className="cyber-button" onClick={() => handleSubmitKillClaim(c.id, c.name)}>
                    {t('player.killClaimFor', { name: c.name })}
                  </button>
                ))}
                <button
                  className="cyber-button"
                  style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }}
                  onClick={() => handleSubmitKillClaim(null, null)}
                >
                  {t('player.killClaimNobody')}
                </button>
              </div>
            </div>
          );
        }

        if (feltKilledChoice === null) {
          return (
            <div className="panel panel--purple" style={{ marginTop: '20px' }}>
              <h3 style={{ color: 'var(--neon-purple)', marginBottom: '15px' }}>{t('player.feltKilledQuestion')}</h3>
              <div className="couple-list">
                <button className="cyber-button" onClick={() => setFeltKilledChoice('yes')}>{t('player.feltKilledYes')}</button>
                <button
                  className="cyber-button"
                  style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }}
                  onClick={() => setFeltKilledChoice('no')}
                >
                  {t('player.feltKilledNo')}
                </button>
              </div>
            </div>
          );
        }

        if (feltKilledChoice === 'yes') {
          return (
            <div className="panel panel--danger" style={{ marginTop: '20px' }}>
              <h3 style={{ color: 'var(--neon-red)', marginBottom: '15px' }}>{t('player.whoKilledYou')}</h3>
              <div className="couple-list">
                {aliveSuspectCouples.map(c => (
                  <button key={c.id} className="cyber-button" onClick={() => handleSubmitVictimReport(true, c.id)}>
                    {t('player.suspectButton', { name: c.name })}
                  </button>
                ))}
              </div>
            </div>
          );
        }

        return (
          <div className="panel panel--info" style={{ marginTop: '20px' }}>
            <h3 style={{ color: 'var(--neon-blue)', marginBottom: '15px' }}>{t('player.decoyPuzzleTitle')}</h3>
            <p style={{ color: 'white', fontSize: '1.3rem', marginBottom: '15px' }}>{decoyPuzzle.a} + {decoyPuzzle.b} = ?</p>
            <input
              type="number"
              className="cyber-input"
              value={decoyAnswer}
              onChange={(e) => setDecoyAnswer(e.target.value)}
              style={{ width: '100%', marginBottom: '15px', padding: '10px', textAlign: 'center', fontSize: '1.1rem' }}
            />
            <button className="cyber-button" disabled={decoyAnswer === ''} onClick={() => handleSubmitVictimReport(false, null)}>
              {t('player.decoySubmit')}
            </button>
          </div>
        );
      })()}

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
