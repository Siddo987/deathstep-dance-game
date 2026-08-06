import React, { useEffect, useState } from 'react';
import { Music2, Plus, Trash2, Download, LogIn, Search, X, Link2, Unlink, RotateCcw, Info } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import { loginWithSpotifyForAccountLink } from '../spotify.js';
import {
  fetchSpotifyStatus, disconnectSpotify, fetchSpotifyPlaylists, searchSpotifyTracks,
  fetchMyPlaylists, fetchPlaylist, createPlaylist, deletePlaylist,
  addTrackToPlaylist, removeTrackFromPlaylist, importSpotifyPlaylist, confirmPendingTrack,
  undoDeleteTrack, linkPlaylistToSpotify, importPlaylistByLink, addTrackByLink,
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
  spotify_rate_limited: 'playlists.error.spotifyRateLimited',
  track_already_in_playlist: 'playlists.error.trackAlreadyInPlaylist',
  already_linked: 'playlists.error.alreadyLinked',
  invalid_spotify_link: 'playlists.error.invalidSpotifyLink',
};

function Playlists({ currentUser, authLoading, onLoginClick }) {
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
  // Single feedback slot, but tagged with *where* it belongs instead of
  // always rendering in one fixed spot at the top of the page - a delete/
  // sync/add/remove failure used to always show up there regardless of which
  // playlist or track the action was actually on, which reads as completely
  // disconnected from the thing you just clicked once the list has more than
  // a couple of items (you have to scroll up to even find it). scope is one
  // of 'global' (page-level actions with no specific existing row - create,
  // import-by-link, opening the Spotify picker), 'connection' (the Spotify
  // connect/disconnect box), `picker:<spotifyId>` (one row in the "import
  // from Spotify" picker), `playlist:<id>` (one playlist's own row - delete,
  // sync-to-Spotify, opening it), `playlistForm:<id>` (that playlist's
  // add-track search/link form, once expanded), or `track:<id>` (one track
  // row inside an expanded playlist - remove/confirm/undo). renderFeedback
  // below only ever renders the message matching the scope it's called with.
  const [feedback, setFeedback] = useState(null); // { scope, type: 'success'|'error', text } | null
  const [playlistLinkInput, setPlaylistLinkInput] = useState('');
  const [trackLinkInput, setTrackLinkInput] = useState('');

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

  // spotify_not_connected can mean "never connected", but can also mean the
  // account WAS connected and the server just found the stored connection
  // dead (see server/spotify.js's getValidAccessToken, which deletes it on
  // invalid_grant) - flip the visible status now instead of leaving the
  // "Connected as ..." banner up while every action quietly keeps failing.
  const reportError = (code, scope = 'global') => {
    setFeedback({ scope, type: 'error', text: translateError(code) });
    if (code === 'spotify_not_connected') setSpotifyStatus(s => ({ ...s, connected: false }));
  };

  const reportSuccess = (text, scope = 'global') => setFeedback({ scope, type: 'success', text });

  // Renders nothing unless the current feedback is actually tagged for this
  // scope - see the `feedback` state comment above for what scope means.
  const renderFeedback = (scope) => {
    if (feedback?.scope !== scope) return null;
    return (
      <p style={{ color: feedback.type === 'success' ? 'var(--neon-green)' : 'var(--neon-red)', fontSize: '0.8rem', margin: '6px 0 0' }}>
        {feedback.text}
      </p>
    );
  };

  // Don't know yet whether this visitor is logged in (fetchMe() is still in
  // flight) - show nothing decisive rather than flashing "please log in" at
  // an already-logged-in user for a moment.
  if (authLoading) {
    return (
      <div className="app-container" style={{ padding: '20px' }}>
        <div className="cyber-card" style={{ maxWidth: '500px', margin: '0 auto', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

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
    setFeedback(null);
    const result = await disconnectSpotify();
    if (result.error) { reportError(result.error, 'connection'); return; }
    setSpotifyStatus({ connected: false, displayName: null });
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    const name = newName.trim();
    if (!name) return;
    setFeedback(null);
    const result = await createPlaylist(name);
    if (result.error) { reportError(result.error); return; }
    setNewName('');
    setPlaylists(prev => [result.playlist, ...prev]);
  };

  const handleDelete = async (id) => {
    setFeedback(null);
    const result = await deletePlaylist(id);
    if (result.error) { reportError(result.error, `playlist:${id}`); return; }
    setPlaylists(prev => prev.filter(p => p.id !== id));
    if (expanded?.id === id) setExpanded(null);
  };

  const openPlaylist = async (id) => {
    if (expanded?.id === id) { setExpanded(null); return; }
    setFeedback(null);
    const result = await fetchPlaylist(id);
    if (result.error) { reportError(result.error, `playlist:${id}`); return; }
    setExpanded(result.playlist);
    setSearchQuery('');
    setSearchResults([]);
  };

  const openPicker = async () => {
    setPickerOpen(true);
    setPickerLoading(true);
    setFeedback(null);
    const result = await fetchSpotifyPlaylists();
    if (result.error) {
      reportError(result.error);
      setPickerOpen(false);
      setPickerLoading(false);
      return;
    }
    setSpotifyPlaylists(result.playlists || []);
    setPickerLoading(false);
  };

  const handleImport = async (spotifyPlaylist) => {
    if (importedSpotifyIds.has(spotifyPlaylist.id)) return; // already imported, picker already disables this - guard against stale clicks
    setFeedback(null);
    const result = await importSpotifyPlaylist(spotifyPlaylist.id, spotifyPlaylist.name);
    if (result.error) {
      // Keep the picker open on failure (it used to close unconditionally
      // right before this call) so the error can actually show up next to
      // the specific Spotify playlist that failed to import, instead of the
      // picker already being gone and the message having nowhere sensible
      // to attach but the generic top-of-page spot.
      reportError(result.error, `picker:${spotifyPlaylist.id}`);
      return;
    }
    setPickerOpen(false);
    setPlaylists(prev => [result.playlist, ...prev]);
    reportSuccess(t('playlists.importedCount', { count: result.playlist.trackCount, name: spotifyPlaylist.name }));
  };

  const handleImportByLink = async (e) => {
    e.preventDefault();
    const url = playlistLinkInput.trim();
    if (!url) return;
    setFeedback(null);
    const result = await importPlaylistByLink(url);
    if (result.error) { reportError(result.error); return; }
    setPlaylistLinkInput('');
    setPlaylists(prev => [result.playlist, ...prev]);
    reportSuccess(t('playlists.importedByLink', { name: result.playlist.name }));
  };

  const handleAddTrackByLink = async (e) => {
    e.preventDefault();
    const url = trackLinkInput.trim();
    if (!url) return;
    setFeedback(null);
    const result = await addTrackByLink(expanded.id, url);
    if (result.error) { reportError(result.error, `playlistForm:${expanded.id}`); return; }
    setTrackLinkInput('');
    if (result.reactivated) {
      setExpanded(prev => ({ ...prev, tracks: prev.tracks.map(t => t.id === result.track.id ? result.track : t) }));
      return;
    }
    setExpanded(prev => ({ ...prev, tracks: [...prev.tracks, result.track] }));
    setPlaylists(prev => prev.map(p => p.id === expanded.id ? { ...p, trackCount: p.trackCount + 1 } : p));
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    const q = searchQuery.trim();
    if (!q) return;
    setFeedback(null);
    const result = await searchSpotifyTracks(q);
    if (result.error) { reportError(result.error, `playlistForm:${expanded.id}`); return; }
    setSearchResults(result.tracks || []);
  };

  const handleAddTrack = async (track) => {
    setFeedback(null);
    const result = await addTrackToPlaylist(expanded.id, track);
    if (result.error) {
      reportError(result.error, `playlistForm:${expanded.id}`);
      return;
    }
    if (result.reactivated) {
      // Was already in the playlist, staged for deletion - re-adding it just
      // cancelled that deletion (see server/playlists.js), not a new track.
      setExpanded(prev => ({ ...prev, tracks: prev.tracks.map(t => t.id === result.track.id ? result.track : t) }));
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
    setFeedback(null);
    const result = await removeTrackFromPlaylist(expanded.id, trackId);
    if (result.error) {
      reportError(result.error, `track:${trackId}`);
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
  // local row goes away entirely rather than flipping to another status), and
  // a removed_on_spotify track (deleted on Spotify while still in this
  // playlist here) gets re-added to Spotify and becomes synced again.
  const handleConfirmPendingTrack = async (trackId) => {
    setFeedback(null);
    const result = await confirmPendingTrack(expanded.id, trackId);
    if (result.error) {
      reportError(result.error, `track:${trackId}`);
      return;
    }
    if (result.removed) {
      setExpanded(prev => ({ ...prev, tracks: prev.tracks.filter(t => t.id !== trackId) }));
      setPlaylists(prev => prev.map(p => p.id === expanded.id ? { ...p, trackCount: p.trackCount - 1 } : p));
    } else {
      setExpanded(prev => ({ ...prev, tracks: prev.tracks.map(t => t.id === trackId ? { ...t, syncStatus: 'synced' } : t) }));
    }
  };

  // Cancels a staged deletion before it's pushed to Spotify - the track just
  // goes back to looking exactly as it did before the delete was requested.
  const handleUndoDeleteTrack = async (trackId) => {
    setFeedback(null);
    const result = await undoDeleteTrack(expanded.id, trackId);
    if (result.error) {
      reportError(result.error, `track:${trackId}`);
      return;
    }
    setExpanded(prev => ({ ...prev, tracks: prev.tracks.map(t => t.id === trackId ? { ...t, syncStatus: 'synced' } : t) }));
  };

  // Creates a brand-new playlist on the user's real Spotify account from an
  // app-only playlist and pushes every track it already has - from then on
  // it's linked and reconciled exactly like an imported one.
  const handleSyncToSpotify = async (id) => {
    setFeedback(null);
    const result = await linkPlaylistToSpotify(id);
    if (result.error) {
      reportError(result.error, `playlist:${id}`);
      return;
    }
    setPlaylists(prev => prev.map(p => p.id === id ? { ...p, spotifyPlaylistId: result.playlist.spotifyPlaylistId } : p));
    if (expanded?.id === id) setExpanded(prev => ({ ...prev, spotifyPlaylistId: result.playlist.spotifyPlaylistId }));
    reportSuccess(t('playlists.syncedToSpotify', { name: result.playlist.name }), `playlist:${id}`);
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
            <div style={{ padding: '12px 14px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)', marginBottom: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
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
              {!spotifyStatus.connected && (
                <p className="info-note"><Info size={13} /> {t('spotify.inviteOnlyNotice')}</p>
              )}
              {renderFeedback('connection')}
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
              style={{ width: '100%', background: 'transparent', border: '1px solid var(--neon-purple)', color: spotifyStatus.connected ? 'var(--neon-purple)' : 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '10px' }}
            >
              <Download size={16} className="icon-inline" />
              {t('playlists.importFromSpotify')}
            </button>

            {/* Works without any Spotify connection - just needs a public playlist link */}
            <form onSubmit={handleImportByLink} style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
              <input
                type="text"
                className="cyber-input"
                placeholder={t('playlists.importByLinkPlaceholder')}
                value={playlistLinkInput}
                onChange={(e) => setPlaylistLinkInput(e.target.value)}
                style={{ marginBottom: 0, flex: 1 }}
              />
              <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '0 16px', display: 'flex', alignItems: 'center', gap: '6px', whiteSpace: 'nowrap' }}>
                <Link2 size={16} className="icon-inline" />
                {t('playlists.importByLink')}
              </button>
            </form>

            <div style={{ textAlign: 'center', marginBottom: feedback?.scope === 'global' ? '15px' : 0 }}>
              {renderFeedback('global')}
            </div>

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
                        <div key={sp.id}>
                          <button
                            onClick={() => handleImport(sp)}
                            disabled={alreadyImported}
                            style={{ width: '100%', textAlign: 'left', background: 'rgba(255,255,255,0.05)', border: 'none', borderRadius: 'var(--radius-sm)', padding: '8px 12px', color: alreadyImported ? 'var(--text-muted)' : 'var(--text-main)', cursor: alreadyImported ? 'default' : 'pointer', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', opacity: alreadyImported ? 0.6 : 1 }}
                          >
                            <span>{sp.name}{alreadyImported ? ` (${t('playlists.alreadyImported')})` : ''}</span>
                            <span style={{ color: 'var(--text-muted)' }}>{t('playlists.trackCount', { count: sp.trackCount })}</span>
                          </button>
                          <div style={{ padding: '0 4px' }}>{renderFeedback(`picker:${sp.id}`)}</div>
                        </div>
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
                      {!p.spotifyPlaylistId && spotifyStatus.connected && (
                        <button onClick={() => handleSyncToSpotify(p.id)} className="icon-btn" title={t('playlists.syncToSpotify')}>
                          <Link2 size={16} style={{ color: 'var(--neon-green)' }} />
                        </button>
                      )}
                      <button onClick={() => handleDelete(p.id)} className="icon-btn" title={t('playlists.delete')}>
                        <Trash2 size={16} style={{ color: 'var(--neon-red)' }} />
                      </button>
                    </div>
                    <div style={{ padding: '0 4px' }}>{renderFeedback(`playlist:${p.id}`)}</div>

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
                                <div key={track.id}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                                    <span style={{ textDecoration: (isPendingDelete || isRemovedOnSpotify) ? 'line-through' : 'none', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                      {track.name} — {track.artist}
                                      {isPendingAdd && <span style={{ color: 'var(--neon-purple)' }}> ({t('playlists.pendingAdd')})</span>}
                                      {isPendingDelete && <span style={{ color: 'var(--neon-red)' }}> ({t('playlists.pendingDelete')})</span>}
                                      {isRemovedOnSpotify && <span style={{ color: '#f5a623' }}> ({t('playlists.removedOnSpotify')})</span>}
                                    </span>
                                    {(isPendingAdd || isPendingDelete || isRemovedOnSpotify) && (
                                      <button
                                        onClick={() => handleConfirmPendingTrack(track.id)}
                                        className="icon-btn"
                                        title={t(isPendingDelete ? 'playlists.confirmRemoveFromSpotify' : isRemovedOnSpotify ? 'playlists.confirmReAddToSpotify' : 'playlists.confirmToSpotify')}
                                        style={{ color: 'var(--neon-green)', flexShrink: 0 }}
                                      >
                                        <Link2 size={14} />
                                      </button>
                                    )}
                                    {isPendingDelete && (
                                      <button
                                        onClick={() => handleUndoDeleteTrack(track.id)}
                                        className="icon-btn"
                                        title={t('playlists.undoDelete')}
                                        style={{ color: 'var(--neon-blue)', flexShrink: 0 }}
                                      >
                                        <RotateCcw size={14} />
                                      </button>
                                    )}
                                    {!isPendingDelete && (
                                      <button onClick={() => handleRemoveTrack(track.id)} className="icon-btn" title={t('playlists.removeTrack')} style={{ flexShrink: 0 }}>
                                        <X size={14} />
                                      </button>
                                    )}
                                  </div>
                                  {renderFeedback(`track:${track.id}`)}
                                </div>
                              );
                            })}
                          </div>
                        )}

                        {spotifyStatus.connected && (
                          <form onSubmit={handleSearch} style={{ display: 'flex', gap: '8px', marginBottom: '8px' }}>
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
                        )}
                        {/* Works without any Spotify connection - just needs a public track link */}
                        <form onSubmit={handleAddTrackByLink} style={{ display: 'flex', gap: '8px' }}>
                          <input
                            type="text"
                            className="cyber-input"
                            placeholder={t('playlists.addTrackByLinkPlaceholder')}
                            value={trackLinkInput}
                            onChange={(e) => setTrackLinkInput(e.target.value)}
                            style={{ marginBottom: 0, flex: 1, padding: '8px 12px', fontSize: '0.85rem' }}
                          />
                          <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '8px 12px' }}>
                            <Link2 size={14} className="icon-inline" />
                          </button>
                        </form>
                        {renderFeedback(`playlistForm:${p.id}`)}

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
