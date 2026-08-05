import React, { useEffect, useState } from 'react';
import { Trash2, Check, Skull, Music2, Plus, History, ArrowLeft, Users, ExternalLink, MessageSquare, ChevronDown, ChevronUp } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import { fetchFeedbackList, markFeedbackRead, deleteFeedbackEntry, fetchDevSettings, updateDevSettings, fetchFallbackSongs, addFallbackSong, importFallbackPlaylist, deleteFallbackSong, fetchGamesList, fetchGameDetail } from '../admin.js';

const GAMES_PAGE_SIZE = 20;

// role/status/dance-role labels here reuse existing in-game translation keys
// (role.*, common.lead/follow/spectator, gm.killModeClassic/Silent) rather
// than duplicating them under dev.* - these are the exact same enum values
// game_couples/game_couple_members/games store, just read back out of the
// history tables instead of live room state.
const coupleRoleLabelKey = (role) => (role === 'killer' ? 'role.killer' : 'role.dancer');
const danceRoleLabelKey = (role) => (role === 'lead' ? 'common.lead' : role === 'follow' ? 'common.follow' : 'common.spectator');
const killModeLabelKey = (mode) => (mode === 'silent' ? 'gm.killModeSilent' : 'gm.killModeClassic');
// Drops the seconds a plain toLocaleString() always tacks on ("...3:25:17 PM")
// - down to the minute is plenty precise for a feedback timestamp and reads
// far less noisy next to the sender's name.
const formatFeedbackDate = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Hidden developer-only page (same admin_users gate as the in-game pairing/
// killer override tool - see server/admin.js's requireSuperAdmin) - reachable
// only via the entry point Home.jsx renders for currentUser.isSuperAdmin,
// never linked from anywhere a regular visitor would see. Deliberately
// behaves like the route doesn't exist for anyone else (redirects home
// instead of showing a "you need access" message), consistent with the
// server routes themselves answering 404 rather than 401/403.
function DevDashboard({ currentUser, authLoading }) {
  const { t } = useLanguage();
  const [feedback, setFeedback] = useState(null);
  const [divisor, setDivisor] = useState('');
  const [savedDivisor, setSavedDivisor] = useState(null);
  const [saveStatus, setSaveStatus] = useState('');
  const [fallbackSongs, setFallbackSongs] = useState(null);
  const [fallbackSongUrl, setFallbackSongUrl] = useState('');
  const [fallbackSongStatus, setFallbackSongStatus] = useState('');
  const [fallbackPlaylistUrl, setFallbackPlaylistUrl] = useState('');
  const [fallbackPlaylistStatus, setFallbackPlaylistStatus] = useState(null); // { key, params? }
  const [games, setGames] = useState(null); // array once loaded, null while loading
  const [gamesTotal, setGamesTotal] = useState(0);
  const [gamesOffset, setGamesOffset] = useState(0);
  const [gamesLoadingMore, setGamesLoadingMore] = useState(false);
  // Selecting a game switches this panel from the list to its full detail
  // (couples/rounds/songs) in place - selectedGameId drives which is shown,
  // gameDetail is null while that one game's detail request is in flight.
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [gameDetail, setGameDetail] = useState(null);
  // All three list-heavy sections below default to collapsed - with a
  // couple hundred fallback songs (or feedback entries, or logged games)
  // rendered as full list-items each, this page got very long very fast
  // otherwise. The list itself hides/shows; surrounding controls (the
  // fallback-song add forms, the feedback/games section headers) stay put.
  const [fallbackListOpen, setFallbackListOpen] = useState(false);
  const [gamesListOpen, setGamesListOpen] = useState(false);
  const [feedbackListOpen, setFeedbackListOpen] = useState(false);

  const load = () => {
    fetchFeedbackList().then(r => { if (!r.error) setFeedback(r.feedback); });
    fetchDevSettings().then(r => {
      if (!r.error) {
        setDivisor(String(r.killerRatioDivisor));
        setSavedDivisor(r.killerRatioDivisor);
      }
    });
    fetchFallbackSongs().then(r => { if (!r.error) setFallbackSongs(r.songs); });
    fetchGamesList(GAMES_PAGE_SIZE, 0).then(r => {
      if (r.error) return;
      setGames(r.games);
      setGamesTotal(r.total);
      setGamesOffset(r.games.length);
    });
  };

  const handleLoadMoreGames = async () => {
    setGamesLoadingMore(true);
    const r = await fetchGamesList(GAMES_PAGE_SIZE, gamesOffset);
    setGamesLoadingMore(false);
    if (r.error) return;
    setGames(prev => [...(prev || []), ...r.games]);
    setGamesOffset(prev => prev + r.games.length);
  };

  const handleOpenGame = async (id) => {
    setSelectedGameId(id);
    setGameDetail(null);
    const r = await fetchGameDetail(id);
    if (!r.error) setGameDetail(r.game);
  };

  const handleCloseGame = () => {
    setSelectedGameId(null);
    setGameDetail(null);
  };

  useEffect(() => {
    if (currentUser?.isSuperAdmin) load();
  }, [currentUser?.id]);

  useEffect(() => {
    if (!authLoading && !currentUser?.isSuperAdmin) {
      window.location.href = '/';
    }
  }, [authLoading, currentUser?.isSuperAdmin]);

  if (authLoading || !currentUser?.isSuperAdmin) return null;

  const handleMarkRead = async (id) => {
    await markFeedbackRead(id);
    setFeedback(prev => prev.map(f => f.id === id ? { ...f, is_read: 1 } : f));
  };

  const handleDelete = async (id) => {
    await deleteFeedbackEntry(id);
    setFeedback(prev => prev.filter(f => f.id !== id));
  };

  const handleSaveDivisor = async (e) => {
    e.preventDefault();
    const value = Number(divisor);
    if (!Number.isFinite(value) || value < 1) return;
    setSaveStatus('dev.saving');
    const result = await updateDevSettings(Math.round(value));
    if (result.error) { setSaveStatus('dev.saveError'); return; }
    setSavedDivisor(result.killerRatioDivisor);
    setSaveStatus('dev.saved');
  };

  const handleAddFallbackSong = async (e) => {
    e.preventDefault();
    if (!fallbackSongUrl.trim()) return;
    setFallbackSongStatus('dev.saving');
    const result = await addFallbackSong(fallbackSongUrl.trim());
    if (result.error) {
      setFallbackSongStatus(result.error === 'already_added' ? 'dev.fallbackSongDuplicate' : 'dev.fallbackSongInvalid');
      return;
    }
    setFallbackSongs(prev => [result.song, ...(prev || [])]);
    setFallbackSongUrl('');
    setFallbackSongStatus('');
  };

  const handleDeleteFallbackSong = async (id) => {
    await deleteFallbackSong(id);
    setFallbackSongs(prev => prev.filter(s => s.id !== id));
  };

  // Every distinct failure server/admin.js's import-playlist route can report
  // gets its own message here - a private/deleted playlist, a genuinely
  // malformed link, an account that was never connected, Spotify rate-
  // limiting, and any other unexpected failure all look and mean different
  // things to the dev pasting the link, so collapsing them into one generic
  // "invalid link" message (as the first version of this did) was actively
  // misleading for every case except the actual regex mismatch.
  const FALLBACK_PLAYLIST_ERROR_KEYS = {
    invalid_spotify_link: 'dev.fallbackPlaylistInvalid',
    spotify_not_connected: 'dev.fallbackPlaylistNotConnected',
    empty_or_invalid_playlist: 'dev.fallbackPlaylistEmpty',
    spotify_request_failed: 'dev.fallbackPlaylistUnavailable',
    spotify_rate_limited: 'dev.fallbackPlaylistRateLimited',
  };

  const handleImportFallbackPlaylist = async (e) => {
    e.preventDefault();
    if (!fallbackPlaylistUrl.trim()) return;
    setFallbackPlaylistStatus({ key: 'dev.saving' });
    const result = await importFallbackPlaylist(fallbackPlaylistUrl.trim());
    if (result.error) {
      setFallbackPlaylistStatus({
        key: FALLBACK_PLAYLIST_ERROR_KEYS[result.error] || 'dev.fallbackPlaylistFailed',
        params: result.error === 'spotify_rate_limited' ? { seconds: result.retryAfterSeconds || 30 } : undefined,
      });
      return;
    }
    setFallbackSongs(prev => [...result.songs, ...(prev || [])]);
    setFallbackPlaylistUrl('');
    setFallbackPlaylistStatus({ key: 'dev.fallbackPlaylistImported', params: { added: result.addedCount, skipped: result.skippedCount } });
  };

  return (
    <div className="app-container" style={{ padding: '20px' }}>
      <div className="cyber-card" style={{ maxWidth: '700px', margin: '0 auto' }}>
        <h2 style={{ color: 'var(--neon-red)', marginBottom: '20px', textAlign: 'center' }}>{t('dev.pageTitle')}</h2>

        <div className="panel panel--purple" style={{ marginBottom: '25px' }}>
          <div className="panel-title" style={{ color: 'var(--neon-purple)' }}>
            <Skull size={16} className="icon-inline" />
            {t('dev.killerRatioTitle')}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 10px 0' }}>{t('dev.killerRatioHint')}</p>
          <form onSubmit={handleSaveDivisor} style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
            <input
              type="number"
              min="1"
              className="cyber-input"
              style={{ marginBottom: 0, width: '100px' }}
              value={divisor}
              onChange={(e) => { setDivisor(e.target.value); setSaveStatus(''); }}
            />
            <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '0 20px' }}>
              {t('dev.save')}
            </button>
          </form>
          {saveStatus && (
            <p style={{ color: saveStatus === 'dev.saveError' ? 'var(--neon-red)' : 'var(--neon-green)', fontSize: '0.85rem', marginTop: '8px' }}>
              {t(saveStatus)}
            </p>
          )}
          {savedDivisor && (
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '8px', fontStyle: 'italic' }}>
              {t('dev.killerRatioExample', { divisor: savedDivisor, players: savedDivisor * 3, count: 3 })}
            </p>
          )}
        </div>

        <div className="panel panel--purple" style={{ marginBottom: '25px' }}>
          <div className="panel-title" style={{ color: 'var(--neon-purple)' }}>
            <Music2 size={16} className="icon-inline" />
            {t('dev.fallbackSongsTitle')}
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0 0 10px 0' }}>{t('dev.fallbackSongsHint')}</p>
          <form onSubmit={handleAddFallbackSong} style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              className="cyber-input"
              style={{ marginBottom: 0, flex: 1 }}
              placeholder={t('dev.fallbackSongUrlPlaceholder')}
              value={fallbackSongUrl}
              onChange={(e) => { setFallbackSongUrl(e.target.value); setFallbackSongStatus(''); }}
            />
            <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '0 16px', display: 'flex', alignItems: 'center' }}>
              <Plus size={16} className="icon-inline" />
            </button>
          </form>
          {fallbackSongStatus && (
            <p style={{ color: 'var(--neon-red)', fontSize: '0.85rem', marginTop: '8px' }}>{t(fallbackSongStatus)}</p>
          )}

          <form onSubmit={handleImportFallbackPlaylist} style={{ display: 'flex', gap: '10px', marginTop: '12px' }}>
            <input
              type="text"
              className="cyber-input"
              style={{ marginBottom: 0, flex: 1 }}
              placeholder={t('dev.fallbackPlaylistUrlPlaceholder')}
              value={fallbackPlaylistUrl}
              onChange={(e) => { setFallbackPlaylistUrl(e.target.value); setFallbackPlaylistStatus(null); }}
            />
            <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '0 16px', display: 'flex', alignItems: 'center' }}>
              <Music2 size={16} className="icon-inline" />
            </button>
          </form>
          {fallbackPlaylistStatus && (
            <p style={{
              color: fallbackPlaylistStatus.key === 'dev.fallbackPlaylistImported' ? 'var(--neon-green)'
                : fallbackPlaylistStatus.key === 'dev.saving' ? 'var(--text-muted)' : 'var(--neon-red)',
              fontSize: '0.85rem', marginTop: '8px'
            }}>
              {t(fallbackPlaylistStatus.key, fallbackPlaylistStatus.params)}
            </p>
          )}

          {fallbackSongs === null && <p style={{ color: 'var(--text-muted)', marginTop: '10px' }}>{t('common.loading')}</p>}
          {fallbackSongs && fallbackSongs.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '10px' }}>{t('dev.fallbackSongsEmpty')}</p>
          )}
          {fallbackSongs && fallbackSongs.length > 0 && (
            <>
              <button onClick={() => setFallbackListOpen(v => !v)} className="collapse-toggle" style={{ marginTop: '10px' }}>
                {fallbackListOpen ? <ChevronUp size={14} className="icon-inline" /> : <ChevronDown size={14} className="icon-inline" />}
                {t('dev.fallbackSongsToggle', { count: fallbackSongs.length })}
              </button>
              {fallbackListOpen && (
                <div className="couple-list" style={{ marginTop: '10px' }}>
                  {fallbackSongs.map(s => (
                    <div key={s.id} className="list-item">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{s.name}</div>
                      </div>
                      <button className="icon-btn danger" title={t('admin.remove')} onClick={() => handleDeleteFallbackSong(s.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <div className="panel panel--purple" style={{ marginBottom: '25px' }}>
          <div className="panel-title" style={{ color: 'var(--neon-purple)' }}>
            <History size={16} className="icon-inline" />
            {t('dev.gamesTitle')}
          </div>

          {selectedGameId === null ? (
            <>
              {games === null && <p style={{ color: 'var(--text-muted)', marginTop: '10px' }}>{t('common.loading')}</p>}
              {games && games.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', marginTop: '10px' }}>{t('dev.gamesEmpty')}</p>
              )}
              {games && games.length > 0 && (
                <>
                  <button onClick={() => setGamesListOpen(v => !v)} className="collapse-toggle" style={{ marginTop: '10px' }}>
                    {gamesListOpen ? <ChevronUp size={14} className="icon-inline" /> : <ChevronDown size={14} className="icon-inline" />}
                    {t('dev.gamesToggle', { count: gamesTotal })}
                  </button>
                  {gamesListOpen && (
                    <>
                      <div className="couple-list" style={{ marginTop: '10px' }}>
                        {games.map(g => (
                          <div key={g.id} className="list-item" style={{ cursor: 'pointer' }} onClick={() => handleOpenGame(g.id)}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ color: 'white', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                <span>{new Date(g.endedAt).toLocaleString()}</span>
                                <span style={{ color: 'var(--text-muted)' }}>· {g.roomId}</span>
                                {g.aborted ? (
                                  <span className="badge badge--muted">{t('dev.gameAbortedBadge')}</span>
                                ) : g.killersWon === null ? null : (
                                  <span className={`badge ${g.killersWon ? 'badge--red' : 'badge--green'}`}>
                                    {t(g.killersWon ? 'dev.gameKillersWonBadge' : 'dev.gameDancersWonBadge')}
                                  </span>
                                )}
                              </div>
                              <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '4px' }}>
                                {t(killModeLabelKey(g.killMode))} · {t('dev.gamePlayers', { count: g.playerCount })} · {t('dev.gameRounds', { count: g.roundCount })} · {g.gmDisplayName || t('dev.gameNoGm')}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      {games.length < gamesTotal && (
                        <button
                          className="cyber-button"
                          style={{ width: 'auto', padding: '0 20px', marginTop: '12px' }}
                          disabled={gamesLoadingMore}
                          onClick={handleLoadMoreGames}
                        >
                          {t(gamesLoadingMore ? 'common.loading' : 'dev.gamesLoadMore')}
                        </button>
                      )}
                    </>
                  )}
                </>
              )}
            </>
          ) : (
            <div style={{ marginTop: '10px' }}>
              <button className="cyber-button" style={{ width: 'auto', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '15px' }} onClick={handleCloseGame}>
                <ArrowLeft size={14} className="icon-inline" /> {t('dev.gameBack')}
              </button>

              {gameDetail === null ? (
                <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
              ) : (
                <>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                    <span style={{ color: 'white' }}>{gameDetail.roomId}</span>
                    <span className="badge badge--blue">{t(killModeLabelKey(gameDetail.killMode))}</span>
                    {gameDetail.aborted ? (
                      <span className="badge badge--muted">{t('dev.gameAbortedBadge')}</span>
                    ) : gameDetail.killersWon === null ? null : (
                      <span className={`badge ${gameDetail.killersWon ? 'badge--red' : 'badge--green'}`}>
                        {t(gameDetail.killersWon ? 'dev.gameKillersWonBadge' : 'dev.gameDancersWonBadge')}
                      </span>
                    )}
                  </div>
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '20px' }}>
                    {new Date(gameDetail.startedAt).toLocaleString()} – {new Date(gameDetail.endedAt).toLocaleString()} · {t('dev.gameGmLabel')}: {gameDetail.gmDisplayName || t('dev.gameNoGm')}
                  </p>

                  <h4 style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                    <Users size={15} className="icon-inline" /> {t('dev.gameCouplesTitle')}
                  </h4>
                  <div className="couple-list" style={{ marginBottom: '20px' }}>
                    {gameDetail.couples.map(c => (
                      <div key={c.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '6px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                          <span style={{ color: 'white' }}>{c.name}</span>
                          <span className={`badge ${c.role === 'killer' ? 'badge--red' : 'badge--blue'}`}>{t(coupleRoleLabelKey(c.role))}</span>
                          <span className={`badge ${c.finalStatus === 'eliminated' ? 'badge--muted' : 'badge--green'}`}>
                            {t(c.finalStatus === 'eliminated' ? 'dev.statusEliminated' : 'dev.statusAlive')}
                          </span>
                        </div>
                        <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                          {c.members.map(m => `${m.playerName} (${t(danceRoleLabelKey(m.danceRole))}${m.userDisplayName ? `, ${m.userDisplayName}` : ''})`).join(', ')}
                        </div>
                      </div>
                    ))}
                  </div>

                  <h4 style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>{t('dev.gameRoundsTitle')}</h4>
                  <div className="couple-list" style={{ marginBottom: '20px' }}>
                    {gameDetail.rounds.length === 0 && (
                      <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('dev.gameRoundsEmpty')}</p>
                    )}
                    {gameDetail.rounds.map(r => (
                      <div key={r.id} className="list-item" style={{ flexDirection: 'column', alignItems: 'stretch', gap: '4px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                          <span style={{ color: 'white' }}>{t('dev.gameRoundNumber', { number: r.roundNumber })}</span>
                          {!r.completed && <span className="badge badge--muted">{t('dev.gameRoundIncomplete')}</span>}
                        </div>
                        {r.kills.length > 0 && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            {t('dev.gameKillsLabel')} {r.kills.map(k => k.coupleName).join(', ')}
                          </div>
                        )}
                        {r.eliminatedByVote && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            {t('dev.gameEliminatedByVote', { name: r.eliminatedByVote.coupleName })}
                          </div>
                        )}
                        {r.votes.length > 0 && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            {t('dev.gameVotesLabel')} {r.votes.map((v, i) => (
                              <span key={i}>{i > 0 && ', '}{v.votingPlayerName || v.voterCoupleName} → {v.suspectCoupleName || t('dev.gameNoSuspect')}</span>
                            ))}
                          </div>
                        )}
                        {r.killClaims.length > 0 && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            {t('dev.gameClaimsLabel')} {r.killClaims.map((c, i) => (
                              <span key={i}>{i > 0 && ', '}{c.killerCoupleName} → {c.victimCoupleName || t('dev.gameNoSuspect')}</span>
                            ))}
                          </div>
                        )}
                        {r.victimReports.length > 0 && (
                          <div style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>
                            {t('dev.gameReportsLabel')} {r.victimReports.map((vr, i) => (
                              <span key={i}>{i > 0 && ', '}{t(vr.feltKilled ? 'dev.gameReportFeltKilled' : 'dev.gameReportNotKilled', { name: vr.coupleName, suspect: vr.suspectCoupleName || t('dev.gameNoSuspect') })}</span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>

                  <h4 style={{ color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: '10px' }}>
                    <Music2 size={15} className="icon-inline" /> {t('dev.gameSongsTitle')}
                  </h4>
                  {gameDetail.playedSongs.length === 0 ? (
                    <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('dev.gameSongsEmpty')}</p>
                  ) : (
                    <div className="couple-list">
                      {gameDetail.playedSongs.map((s, i) => (
                        <div key={i} className="list-item">
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {s.trackName}{s.artistName ? ` – ${s.artistName}` : ''}
                            </div>
                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>
                              {s.roundNumber != null ? t('dev.gameRoundNumber', { number: s.roundNumber }) : ''}
                            </div>
                          </div>
                          {s.spotifyUrl && (
                            <a href={s.spotifyUrl} target="_blank" rel="noopener noreferrer" className="icon-btn" title={s.spotifyUrl}>
                              <ExternalLink size={16} />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <h3 style={{ color: 'var(--neon-blue)', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          {t('dev.feedbackTitle')}
          {/* Unread count stays next to the title itself (not just inside
              the collapsed list) so an unread backlog is still visible at a
              glance without expanding anything. */}
          {feedback && feedback.some(f => !f.is_read) && (
            <span className="badge badge--blue">{t('dev.feedbackUnread', { count: feedback.filter(f => !f.is_read).length })}</span>
          )}
        </h3>
        {feedback === null && <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>}
        {feedback && feedback.length === 0 && <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('dev.feedbackEmpty')}</p>}
        {feedback && feedback.length > 0 && (
          <button onClick={() => setFeedbackListOpen(v => !v)} className="collapse-toggle" style={{ marginBottom: '10px' }}>
            {feedbackListOpen ? <ChevronUp size={14} className="icon-inline" /> : <ChevronDown size={14} className="icon-inline" />}
            {t('dev.feedbackToggle', { count: feedback.length })}
          </button>
        )}
        <div className="couple-list">
          {feedbackListOpen && feedback && feedback.map(f => (
            <div key={f.id} className={`list-item ${f.is_read ? '' : 'list-item--active'}`} style={{ flexDirection: 'column', alignItems: 'stretch', gap: '10px', padding: '14px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                <MessageSquare size={18} className="icon-inline" style={{ color: f.is_read ? 'var(--text-muted)' : 'var(--neon-blue)', flexShrink: 0, marginTop: '3px' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: 'var(--text-main)', fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {f.name || f.user_display_name || t('dev.anonymous')}
                  </div>
                  <div style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{formatFeedbackDate(f.created_at)}</div>
                </div>
                <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                  {!f.is_read && (
                    <button className="icon-btn" title={t('dev.markRead')} onClick={() => handleMarkRead(f.id)}>
                      <Check size={16} />
                    </button>
                  )}
                  <button className="icon-btn danger" title={t('admin.remove')} onClick={() => handleDelete(f.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {/* Indented past the icon and set off with a quote-style border
                  so the actual feedback text reads as its own block instead
                  of running straight on from the meta line above it. */}
              <p style={{ color: 'white', margin: 0, marginLeft: '28px', paddingLeft: '10px', borderLeft: '2px solid rgba(136,146,176,0.25)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {f.message}
              </p>
            </div>
          ))}
        </div>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</a>
        </div>
      </div>
    </div>
  );
}

export default DevDashboard;
