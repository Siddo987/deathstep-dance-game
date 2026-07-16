import React, { useEffect, useState } from 'react';
import { Music2, Plus, Trash2, Download, LogIn, Search, X, Link2, Unlink } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import { loginWithSpotifyForAccountLink } from '../spotify.js';
import {
  fetchSpotifyStatus, disconnectSpotify, fetchSpotifyPlaylists, searchSpotifyTracks,
  fetchMyPlaylists, fetchPlaylist, createPlaylist, deletePlaylist,
  addTrackToPlaylist, removeTrackFromPlaylist, importSpotifyPlaylist, confirmPendingTrack,
} from '../spotifyPlaylists.js';

// Maps server error codes to a specific, translated explanation instead of
// ever surfacing a raw error code or a generic "something went wrong". Reuses
// the existing auth.error.* keys where one already covers the same code.
const PLAYLIST_ERROR_KEYS = {
  already_imported: 'playlists.error.alreadyImported',
  spotify_not_connected: 'auth.error.spotify_not_connected',
  missing_name: 'auth.error.missing_name',
  missing_spotify_playlist_id: 'auth.error.missing_name',
  playlist_not_found: 'auth.error.playlist_not_found',
  missing_track_fields: 'playlists.error.missingTrackFields',
  track_not_found: 'playlists.error.trackNotFound',
  track_not_pending: 'playlists.error.trackNotPending',
  not_a_linked_playlist: 'playlists.error.notLinked',
  spotify_push_failed: 'auth.error.spotify_request_failed',
  not_authenticated: 'playlists.error.notAuthenticated',
};

function Playlists({ currentUser, onLoginClick }) {
  const { t } = useLanguage();
  const [loading, setLoading] = useState(true);
  const [spotifyStatus, setSpotifyStatus] = useState({ connected: false, displayName: null });
  const [playlists, setPlaylists] = useState([]);
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState(null); // { id, name, tracks }
  const [pickerOpen, setPickerOpen] = useState(false);
  const [spotifyPlaylists, setSpotifyPlaylists] = useState([]);
  const [pickerLoading, setPickerLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [statusMessage, setStatusMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const loadAll = async () => {
    const [status, mine] = await Promise.all([fetchSpotifyStatus(), fetchMyPlaylists()]);
    if (!status.error) setSpotifyStatus(status);
    if (!mine.error) setPlaylists(mine.playlists);
    setLoading(false);
  };

  useEffect(() => {
    if (!currentUser) { setLoading(false); return; }
    loadAll();
  }, [currentUser?.id]);

  // Live sync: while a Spotify-linked playlist is expanded, keep pulling in
  // anything added on the Spotify side (the server throttles the actual
  // Spotify API calls, so polling here is cheap).
  useEffect(() => {
    if (!expanded?.spotifyPlaylistId) return;
    const interval = setInterval(async () => {
      const result = await fetchPlaylist(expanded.id);
      if (!result.error) {
        setExpanded(result.playlist);
        setPlaylists(prev => prev.map(p => p.id === result.playlist.id ? { ...p, trackCount: result.playlist.tracks.length } : p));
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [expanded?.id, expanded?.spotifyPlaylistId]);

  const importedSpotifyIds = new Set(playlists.map(p => p.spotifyPlaylistId).filter(Boolean));
  const translateError = (code) => t(PLAYLIST_ERROR_KEYS[code] || 'playlists.error.generic');

  if (!currentUser) {
    return (
      <div className="app-container" style={{ padding: '20px' }}>
        <div className="cyber-card" style={{ maxWidth: '500px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px' }}>{t('playlists.pageTitle')}</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>{t('playlists.loginRequired')}</p>
          <button
            className="cyber-button pulse-animation"
            style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%' }}
            onClick={onLoginClick}
          >
            <LogIn size={20} className="icon-inline" />
            {t('auth.loginOrRegister')}
          </button>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</a>
        </div>
      </div>
    );
  }

  const handleDisconnect = async () => {
    setErrorMessage('');
    const result = await disconnectSpotify();
    if (result.error) { setErrorMessage(translateError(result.error)); return; }
    setSpotifyStatus({ connected: false, displayName: null });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setErrorMessage('');
    const result = await createPlaylist(name);
    if (result.error) { setErrorMessage(translateError(result.error)); return; }
    setNewName('');
    setPlaylists(prev => [result.playlist, ...prev]);
  };

  const handleDelete = async (id) => {
    setErrorMessage('');
    const result = await deletePlaylist(id);
    if (result.error) { setErrorMessage(translateError(result.error)); return; }
    setPlaylists(prev => prev.filter(p => p.id !== id));
    if (expanded?.id === id) setExpanded(null);
  };

  const openPlaylist = async (id) => {
    if (expanded?.id === id) { setExpanded(null); return; }
    const result = await fetchPlaylist(id);
    if (!result.error) {
      setExpanded(result.playlist);
      setSearchQuery('');
      setSearchResults([]);
    }
  };

  const openPicker = async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    const result = await fetchSpotifyPlaylists();
    setSpotifyPlaylists(result.playlists || []);
    setPickerLoading(false);
  };

  const handleImport = async (spotifyPlaylist) => {
    if (importedSpotifyIds.has(spotifyPlaylist.id)) return; // already imported, picker already disables this - guard against stale clicks
    setPickerOpen(false);
    setErrorMessage('');
    const result = await importSpotifyPlaylist(spotifyPlaylist.id, spotifyPlaylist.name);
    if (result.error) {
      setErrorMessage(translateError(result.error));
      return;
    }
    setPlaylists(prev => [result.playlist, ...prev]);
    setStatusMessage(t('playlists.importedCount', { count: result.playlist.trackCount, name: spotifyPlaylist.name }));
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setErrorMessage('');
    const result = await searchSpotifyTracks(q);
    if (result.error) { setErrorMessage(translateError(result.error)); return; }
    setSearchResults(result.tracks || []);
  };

  const handleAddTrack = async (track) => {
    setErrorMessage('');
    const result = await addTrackToPlaylist(expanded.id, track);
    if (result.error) {
      setErrorMessage(translateError(result.error));
      return;
    }
    setExpanded(prev => ({ ...prev, tracks: [...prev.tracks, result.track] }));
    setPlaylists(prev => prev.map(p => p.id === expanded.id ? { ...p, trackCount: p.trackCount + 1 } : p));
  };

  // A 'pending_add' track never actually reached Spotify - nothing to
  // reconcile, so it's just removed outright. Anything else (synced or
  // already pending_delete) is staged as deleted server-side and only
  // disappears once it's also gone from the real Spotify playlist, so we
  // re-fetch the playlist to reflect whichever of those actually happened.
  const handleRemoveTrack = async (trackId) => {
    setErrorMessage('');
    const result = await removeTrackFromPlaylist(expanded.id, trackId);
    if (result.error) {
      setErrorMessage(translateError(result.error));
      return;
    }
    const refreshed = await fetchPlaylist(expanded.id);
    if (!refreshed.error) {
      setExpanded(refreshed.playlist);
      setPlaylists(prev => prev.map(p => p.id === refreshed.playlist.id ? { ...p, trackCount: refreshed.playlist.tracks.length } : p));
    }
  };

  // Pushes a staged change to Spotify right now: a pending_add track becomes
  // synced, a pending_delete track is fully removed (from both sides, so the
  // local row goes away entirely rather than flipping to another status).
  const handleConfirmPendingTrack = async (trackId) => {
    setErrorMessage('');
    const result = await confirmPendingTrack(expanded.id, trackId);
    if (result.error) {
      setErrorMessage(translateError(result.error));
      return;
    }
    if (result.removed) {
      setExpanded(prev => ({ ...prev, tracks: prev.tracks.filter(t => t.id !== trackId) }));
      setPlaylists(prev => prev.map(p => p.id === expanded.id ? { ...p, trackCount: p.trackCount - 1 } : p));
    } else {
      setExpanded(prev => ({ ...prev, tracks: prev.tracks.map(t => t.id === trackId ? { ...t, syncStatus: 'synced' } : t) }));
    }
  };

  return (
    <div className="app-container" style={{ padding: '20px' }}>
      <div className="cyber-card" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          <Music2 size={24} className="icon-inline" />
          {t('playlists.pageTitle')}
        </h2>

        {loading ? (
          <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{t('stats.loading')}</p>
        ) : (
          <>
            {/* Spotify connection */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)', marginBottom: '20px' }}>
              {spotifyStatus.connected ? (
                <>
                  <span style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>
                    {t('playlists.spotifyConnectedAs', { name: spotifyStatus.displayName })}
                  </span>
                  <button
                    onClick={handleDisconnect}
                    style={{ background: 'transparent', border: 'none', color: 'var(--neon-red)', textDecoration: 'underline', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.85rem' }}
                  >
                    <Unlink size={14} className="icon-inline" />
                    {t('playlists.spotifyDisconnect')}
                  </button>
                </>
              ) : (
                <>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t('playlists.spotifyNotConnected')}</span>
                  <button
                    onClick={loginWithSpotifyForAccountLink}
                    className="cyber-button"
                    style={{ background: 'var(--neon-green)', color: 'black', padding: '8px 14px', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.85rem' }}
                  >
                    <Link2 size={14} className="icon-inline" />
                    {t('playlists.spotifyConnect')}
                  </button>
                </>
              )}
            </div>

            {/* Create / Import */}
            <form onSubmit={handleCreate} style={{ display: 'flex', gap: '10px', marginBottom: '10px' }}>
              <input
                type="text"
                className="cyber-input"
                placeholder={t('playlists.newNamePlaceholder')}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                style={{ marginBottom: 0, flex: 1 }}
              />
              <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '0 20px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                <Plus size={16} className="icon-inline" />
                {t('playlists.create')}
              </button>
            </form>

            <button
              onClick={openPicker}
              disabled={!spotifyStatus.connected}
              className="cyber-button"
              style={{ width: '100%', background: 'transparent', border: '1px solid var(--neon-purple)', color: spotifyStatus.connected ? 'var(--neon-purple)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '20px' }}
            >
              <Download size={16} className="icon-inline" />
              {t('playlists.importFromSpotify')}
            </button>

            {statusMessage && (
              <p style={{ textAlign: 'center', color: 'var(--neon-green)', fontSize: '0.85rem', marginBottom: '15px' }}>{statusMessage}</p>
            )}
            {errorMessage && (
              <p style={{ textAlign: 'center', color: 'var(--neon-red)', fontSize: '0.85rem', marginBottom: '15px' }}>{errorMessage}</p>
            )}

            {/* Spotify playlist picker */}
            {pickerOpen && (
              <div style={{ border: '1px solid var(--neon-purple)', borderRadius: 'var(--radius-sm)', padding: '14px', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                  <strong style={{ color: 'var(--text-main)', fontSize: '0.9rem' }}>{t('playlists.pickerTitle')}</strong>
                  <button onClick={() => setPickerOpen(false)} className="icon-btn"><X size={16} /></button>
                </div>
                {pickerLoading ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('stats.loading')}</p>
                ) : spotifyPlaylists.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('playlists.noSpotifyPlaylists')}</p>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '250px', overflowY: 'auto' }}>
                    {spotifyPlaylists.map((sp) => {
                      const alreadyImported = importedSpotifyIds.has(sp.id);
                      return (
                        <button
                          key={sp.id}
                          onClick={() => handleImport(sp)}
                          disabled={alreadyImported}
                          style={{ textAlign: 'left', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 12px', color: alreadyImported ? 'var(--text-muted)' : 'var(--text-main)', cursor: alreadyImported ? 'default' : 'pointer', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', opacity: alreadyImported ? 0.6 : 1 }}
                        >
                          <span>{sp.name}{alreadyImported ? ` (${t('playlists.alreadyImported')})` : ''}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{t('playlists.trackCount', { count: sp.trackCount })}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Own playlists */}
            {playlists.length === 0 ? (
              <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{t('playlists.empty')}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                {playlists.map((p) => (
                  <div key={p.id}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)' }}>
                      <button
                        onClick={() => openPlaylist(p.id)}
                        style={{ flex: 1, textAlign: 'left', background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '6px', minWidth: 0 }}
                      >
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.name}</span>
                        {p.spotifyPlaylistId && <Link2 size={12} className="icon-inline" style={{ color: 'var(--neon-green)', flexShrink: 0 }} title={t('playlists.linkedTooltip')} />}
                      </button>
                      <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('playlists.trackCount', { count: p.trackCount })}</span>
                      <button onClick={() => handleDelete(p.id)} className="icon-btn" title={t('playlists.delete')}>
                        <Trash2 size={16} style={{ color: 'var(--neon-red)' }} />
                      </button>
                    </div>

                    {expanded?.id === p.id && (
                      <div style={{ padding: '12px 14px', border: '1px solid rgba(136,146,176,0.3)', borderTop: 'none', borderRadius: '0 0 var(--radius-sm) var(--radius-sm)' }}>
                        {expanded.tracks.length === 0 ? (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '10px' }}>{t('playlists.noTracks')}</p>
                        ) : (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginBottom: '12px' }}>
                            {expanded.tracks.map((track) => {
                              const status = track.syncStatus;
                              const isPendingAdd = status === 'pending_add';
                              const isPendingDelete = status === 'pending_delete';
                              const isRemovedOnSpotify = status === 'removed_on_spotify';
                              return (
                                <div key={track.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                  <span style={{ textDecoration: (isPendingDelete || isRemovedOnSpotify) ? 'line-through' : 'none', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {track.name} — {track.artist}
                                    {isPendingAdd && <span style={{ color: 'var(--neon-purple)' }}> ({t('playlists.pendingAdd')})</span>}
                                    {isPendingDelete && <span style={{ color: 'var(--neon-red)' }}> ({t('playlists.pendingDelete')})</span>}
                                    {isRemovedOnSpotify && <span style={{ color: '#f5a623' }}> ({t('playlists.removedOnSpotify')})</span>}
                                  </span>
                                  {(isPendingAdd || isPendingDelete) && (
                                    <button
                                      onClick={() => handleConfirmPendingTrack(track.id)}
                                      className="icon-btn"
                                      title={t(isPendingAdd ? 'playlists.confirmToSpotify' : 'playlists.confirmRemoveFromSpotify')}
                                      style={{ color: 'var(--neon-green)', flexShrink: 0 }}
                                    >
                                      <Link2 size={14} />
                                    </button>
                                  )}
                                  {!isPendingDelete && (
                                    <button onClick={() => handleRemoveTrack(track.id)} className="icon-btn" title={t('playlists.removeTrack')} style={{ flexShrink: 0 }}>
                                      <X size={14} />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {spotifyStatus.connected ? (
                          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px' }}>
                            <input
                              type="text"
                              className="cyber-input"
                              placeholder={t('playlists.addTrackPlaceholder')}
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              style={{ marginBottom: 0, flex: 1, padding: '8px 12px', fontSize: '0.85rem' }}
                            />
                            <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '8px 12px' }}>
                              <Search size={14} className="icon-inline" />
                            </button>
                          </form>
                        ) : (
                          <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem' }}>{t('playlists.connectToAddTracks')}</p>
                        )}

                        {searchResults.length > 0 && (
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', marginTop: '8px' }}>
                            {searchResults.map((track) => (
                              <button
                                key={track.uri}
                                onClick={() => handleAddTrack(track)}
                                style={{ textAlign: 'left', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '6px 10px', color: 'var(--text-main)', cursor: 'pointer', fontSize: '0.8rem', display: 'flex', justifyContent: 'space-between' }}
                              >
                                <span>{track.name} — {track.artist}</span>
                                <Plus size={14} className="icon-inline" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        <div style={{ textAlign: 'center', marginTop: '25px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</a>
        </div>
      </div>
    </div>
  );
}

export default Playlists;
