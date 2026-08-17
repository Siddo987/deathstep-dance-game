import React, { useState } from 'react';
import { createPortal } from 'react-dom';
import { socket } from '../socket.js';
import { X, Music2, Skull, Sparkles, Timer, Smartphone, Search, Send, Plus, Share2, Link2, HelpCircle, Globe } from 'lucide-react';

import { ConfirmModal, HowToPlayModal, LanguageModal } from './Modal.jsx';
import { useLanguage } from '../i18n.jsx';
import { fetchMyPlaylists, fetchPlaylist, createPlaylist, addTrackToPlaylist, searchTracksInRoom, fetchSpotifyStatus } from '../spotifyPlaylists.js';
import { getCookieConsent } from './CookieBanner.jsx';
import AdminOverridesModal from './AdminOverridesModal.jsx';
import { buildMaxKillsRanks } from '../maxKillsRanking.js';

function PlayerScreen({ room, role, isEliminated, onLeave, clientId, currentUser }) {
  const { t } = useLanguage();
  const spotifyAllowed = getCookieConsent()?.spotify === true;
  // Own-audio-mode games (room.useSpotify === false, set by the GM's lobby
  // choice - see GMDashboard.jsx's setUseSpotify) have no way to act on a
  // Spotify-track suggestion at all, so don't offer that option; plain-text
  // hints still make sense (the GM/DJ running their own system can still
  // read them) and stay available regardless.
  const spotifySuggestionsAllowed = spotifyAllowed && room.useSpotify !== false;
  const [showRole, setShowRole] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  const [showAdminModal, setShowAdminModal] = useState(false);
  const [showHowTo, setShowHowTo] = useState(false);
  const [showLanguageModal, setShowLanguageModal] = useState(false);
  const [votingTimeLeft, setVotingTimeLeft] = useState(0);

  // Song suggestions - three ways to suggest, gated by what the player has
  // connected: plain text always works (no Spotify needed); a real Spotify
  // track can be searched too, run through whichever GM/co-GM has a working
  // connection (searchTracksInRoom - needs no connection of the player's
  // own); and a logged-in Deathstep account with saved playlists (server/
  // playlists.js - a link can be saved with no Spotify connection at all, see
  // Playlists.jsx's import-by-link) can pick a track from one of those.
  const [showSongSuggest, setShowSongSuggest] = useState(false);
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

  // Temporarily lending this account's linked Spotify connection to the room
  // (see server/index.js's grantSpotifyToRoom) - only offered to a logged-in
  // account that actually has one connected (Settings/Playlists page).
  const [showSpotifyShare, setShowSpotifyShare] = useState(false);
  const [mySpotifyLinked, setMySpotifyLinked] = useState(false);
  const [spotifyShareBusy, setSpotifyShareBusy] = useState(false);
  const [spotifyShareError, setSpotifyShareError] = useState('');

  React.useEffect(() => {
    if (!currentUser) { setMySpotifyLinked(false); return; }
    let cancelled = false;
    fetchSpotifyStatus().then((s) => { if (!cancelled) setMySpotifyLinked(!!s.connected); });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  const isMySpotifyDelegate = room.spotifyDelegate?.playerId === clientId;
  const isMyShareRequestPending = room.pendingSpotifyShareRequest?.playerId === clientId;
  // A share only makes sense while nobody else already has one active/pending,
  // the GM doesn't already have a working connection of their own, and the
  // room is actually configured to use Spotify at all - an own-audio-mode
  // game (room.useSpotify === false, see spotifySuggestionsAllowed above) has
  // no playback path that a delegated connection could ever feed into, so
  // offering one there was a dead end that just confused the GM with an
  // accept/deny prompt for a feature this game isn't using. Matches the
  // authoritative check in server/index.js's requestSpotifyShareToRoom, so
  // the entry point never invites a request that's just going to be refused.
  const spotifyShareOffPossible = room.useSpotify !== false
    && !room.gmSpotifyConnected
    && (!room.spotifyDelegate || isMySpotifyDelegate)
    && (!room.pendingSpotifyShareRequest || isMyShareRequestPending);

  // `auto` distinguishes the account-wide setting firing on its own from a
  // deliberate tap on "share" - the server refuses the automatic kind once
  // this room's GM has declined it (see index.js's requestSpotifyShareToRoom)
  // and treats a manual one as overruling that refusal.
  const handleRequestSpotifyShare = ({ auto = false } = {}) => {
    setSpotifyShareBusy(true);
    setSpotifyShareError('');
    socket.emit('requestSpotifyShareToRoom', { roomId: room.id, auto }, (response) => {
      setSpotifyShareBusy(false);
      // An auto-offer being turned down is an expected outcome, not something
      // to put a red error line in front of a player who never asked for it.
      if (!response?.success && !auto) setSpotifyShareError(`server.${response?.messageKey || 'spotifyNotConnected'}`);
    });
  };

  const handleRevokeSpotify = () => {
    setSpotifyShareBusy(true);
    socket.emit('revokeSpotifyFromRoom', { roomId: room.id }, () => {
      setSpotifyShareBusy(false);
    });
  };

  // Account-wide "always offer my Spotify" setting (Settings.jsx) - fires the
  // exact same request a manual click would, still subject to the GM's
  // explicit accept, just so it doesn't have to be redone by hand every room.
  // Guarded by a ref (not state) so it only ever fires once per room per
  // mount, regardless of how many times the room broadcasts in the meantime.
  //
  // That ref is per-mount, so it can't remember anything across a page
  // reload - which is why a reload used to fire a brand-new offer at a GM who
  // had already said no. room.mySpotifyShareDenied is the server's memory of
  // that refusal (see gameStore.resolveSpotifyShareRequest) and survives the
  // reload; the server refuses the auto-request outright either way, this
  // check just avoids sending one it knows will be refused.
  const autoShareTriedRef = React.useRef(false);
  React.useEffect(() => {
    if (autoShareTriedRef.current) return;
    if (!currentUser?.autoShareSpotify || !mySpotifyLinked) return;
    if (room.mySpotifyShareDenied) return;
    if (!spotifyShareOffPossible || isMySpotifyDelegate || isMyShareRequestPending) return;
    autoShareTriedRef.current = true;
    handleRequestSpotifyShare({ auto: true });
  }, [currentUser?.autoShareSpotify, mySpotifyLinked, room.mySpotifyShareDenied, spotifyShareOffPossible, isMySpotifyDelegate, isMyShareRequestPending]);

  // Only a logged-in Deathstep account's own DB-backed playlists (server/
  // playlists.js) show up here - a live-browsed "whatever's on your actual
  // Spotify account" list used to be mixed in too (source: 'local'), but
  // during a game that's redundant with the DB-backed Playlists page (which
  // can now hold any playlist via a pasted link, no Spotify connection
  // needed - see Playlists.jsx's import-by-link) and was confusing to see
  // change on every fetch, so in-game pickers only ever show playlists the
  // player actually saved.
  React.useEffect(() => {
    if (!currentUser) { setPlayerPlaylists([]); return; }
    let cancelled = false;
    (async () => {
      const result = await fetchMyPlaylists();
      if (!cancelled && !result.error) setPlayerPlaylists(result.playlists);
    })();
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

  // Converts a spotify:track:ID uri into a shareable open.spotify.com link -
  // null for anything that isn't a real Spotify track (own-audio mode never
  // populates these at all, so this only matters for logged-out players).
  const spotifyTrackLink = (uri) => {
    const id = uri?.startsWith('spotify:track:') ? uri.slice('spotify:track:'.length) : null;
    return id ? `https://open.spotify.com/track/${id}` : null;
  };

  const [copiedLinkFor, setCopiedLinkFor] = useState('');
  const handleCopyTrackLink = async (uri) => {
    const link = spotifyTrackLink(uri);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiedLinkFor(uri);
      setTimeout(() => setCopiedLinkFor(''), 2000);
    } catch (e) { /* clipboard permission denied - nothing more to do */ }
  };

  // One track row - "add to my playlist" for a logged-in account, or "copy
  // Spotify link" otherwise - shared by the current-song widget (dancing
  // through voting) and the round-grouped played-songs overview below.
  const renderTrackRow = (song, rowKey) => (
    <div key={rowKey} style={{ marginBottom: '10px' }}>
      <div className="list-item">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.name}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{song.artist}</div>
          {song.suggestedBy && (
            <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{t('gm.suggestedBy', { name: song.suggestedBy.name })}</div>
          )}
        </div>
        {currentUser ? (
          <button
            className="icon-btn"
            title={t('gm.addToPlaylist')}
            style={{ flexShrink: 0 }}
            onClick={() => setAddToPlaylistFor(prev => prev === rowKey ? null : rowKey)}
          >
            <Plus size={18} style={{ color: 'var(--neon-purple)' }} />
          </button>
        ) : spotifyTrackLink(song.uri) && (
          <button
            className="icon-btn"
            title={t('player.copyLink')}
            style={{ flexShrink: 0 }}
            onClick={() => handleCopyTrackLink(song.uri)}
          >
            <Link2 size={18} style={{ color: 'var(--neon-purple)' }} />
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
      {!currentUser && copiedLinkFor === song.uri && (
        <p style={{ color: 'var(--neon-green)', fontSize: '0.8rem', textAlign: 'center', marginTop: '10px', marginBottom: 0 }}>{t('player.linkCopied')}</p>
      )}
    </div>
  );

  // Lets a player grab the currently playing (or just-finished) track into
  // their own playlist without waiting for the game to end - visible from
  // the moment a song starts through every phase up to the next one
  // (dancing, then silent_report/kill_reveal/voting while that
  // song is still the last one played). Own-audio mode never sets
  // room.nowPlaying at all, so this simply never renders there.
  // Shows room.nowPlaying (the most recent pick - see server/gameStore.js's
  // playQueueEntry, which is the only place that ever sets it, never cleared
  // in between) labeled "current" while it's actually playing (dancing), or
  // "last" for every phase after that - until the next round's dancing
  // starts an actual new pick, which is exactly when this flips back to
  // "current" for that new track. Never shown to the GM (see GMDashboard.jsx
  // - its own current-track widget only ever renders during dancing, i.e.
  // never as a "last played" callback) and never a full history, just this
  // one track at a time.
  const renderCurrentTrackWidget = () => {
    const isDancing = room.status === 'dancing';
    const lastStatuses = ['silent_report', 'kill_reveal', 'voting', 'vote_reveal', 'ended'];
    if ((!isDancing && !lastStatuses.includes(room.status)) || !room.nowPlaying) return null;
    return (
      <div className="panel panel--success" style={{ textAlign: 'left', marginBottom: '15px' }}>
        <div className="panel-title" style={{ color: 'var(--neon-green)' }}>
          <Music2 size={16} className="icon-inline" /> {t(isDancing ? 'player.currentSongLabel' : 'player.lastSongLabel')}
        </div>
        {renderTrackRow(room.nowPlaying, `nowplaying-${room.nowPlaying.uri}`)}
      </div>
    );
  };

  const mySuggestions = (room.songSuggestions || []).filter(s => s.playerId === clientId);

  const sendSuggestion = (suggestion) => {
    setSuggestErrorKey('');
    socket.emit('suggestSong', { roomId: room.id, suggestion }, (response) => {
      if (!response?.success) {
        setSuggestErrorKey(`server.${response?.messageKey || 'suggestionFailed'}`);
      }
    });
    setSuggestJustSent(true);
    setTimeout(() => setSuggestJustSent(false), 2500);
  };

  // Runs through whichever GM/co-GM in the room has a working Spotify
  // connection (server/index.js's public /api/rooms/:roomId/spotify-search)
  // instead of requiring the player's own - search itself needs no personal
  // login, only browsing one's own playlists (suggestMode 'playlist') does.
  const handleSuggestSearch = async (e) => {
    e.preventDefault();
    if (!suggestQuery.trim()) return;
    setSuggestErrorKey('');
    const result = await searchTracksInRoom(room.id, suggestQuery);
    if (result.error) {
      setSuggestErrorKey(result.error === 'gm_spotify_not_connected' ? 'player.suggestSpotifyUnavailable' : 'player.suggestSearchFailed');
      return;
    }
    setSuggestResults(result.tracks);
    setSuggestSearchDone(true);
  };

  // searchTracksInRoom returns { uri, name, artist, imageUrl } (see
  // server/spotify.js's searchTracksWithToken) - normalize into the
  // { artists: [...], album: { images: [...] } } shape the suggestion panel
  // (GMDashboard.jsx) expects, same as handleSuggestPlaylistTrack below does
  // for playlist tracks, but carrying the real cover art through via a flat
  // imageUrl (GMDashboard.jsx's suggestionImageUrl reads that first) instead
  // of an always-empty images array.
  const handleSuggestTrack = (track) => {
    sendSuggestion({ type: 'spotify', track: { uri: track.uri, name: track.name, artists: [{ name: track.artist }], imageUrl: track.imageUrl || null, album: { images: [] } } });
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

  const handlePickSuggestPlaylist = async (playlist) => {
    const result = await fetchPlaylist(playlist.id);
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

  // "Tote tanzen weiter" (room.deadPlayersKeepDancing, opt-in GM setting): once
  // eliminated, instead of just standing at the edge, a couple gets a fresh
  // harmless physical task each round to stay part of the dance floor. Purely
  // cosmetic/for fun - never derived from real game state, never sent to the
  // server, so an eliminated couple has nothing round-relevant to leak even by
  // accident. Re-picked deterministically per round so it doesn't flicker on
  // every re-render, same pattern as decoyPuzzle above.
  const deadTaskIndex = React.useMemo(() => Math.floor(Math.random() * 6), [room.round]);

  // Rätsel-Paar special role (couple.specialRole === 'puzzle'): a real riddle/
  // puzzle to visibly work on during the dance, as social camouflage - other
  // couples see them occupied with their phone just like everyone else. Same
  // unchecked, never-sent-to-server shape as decoyPuzzle above, just framed
  // as an actual in-round task rather than filler. Re-picked once per round.
  const puzzleRoleTaskIndex = React.useMemo(() => Math.floor(Math.random() * 6), [room.round]);
  React.useEffect(() => {
    setFeltKilledChoice(null);
    setDecoyAnswer('');
  }, [room.round]);

  // Max Kills mode (see server/gameStore.js's submitMaxKillsAccusation) -
  // whether the "raise your hand and accuse" picker is currently open. Reset
  // every round like the other per-round UI toggles above.
  const [showMaxKillsAccusationPicker, setShowMaxKillsAccusationPicker] = useState(false);
  React.useEffect(() => {
    setShowMaxKillsAccusationPicker(false);
  }, [room.round]);

  // Max Kills silent floor-mode: drives the "leave the floor in Xs" countdown
  // below off room.maxKillsHitAt (a server timestamp) - a plain client clock
  // comparison is close enough for a real-world physical cue like this, no
  // need for the voting phase's server-time-offset precision.
  const [maxKillsNow, setMaxKillsNow] = useState(Date.now());
  React.useEffect(() => {
    if (room.gameMode !== 'maxkills' || room.status !== 'dancing') return;
    const interval = setInterval(() => setMaxKillsNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [room.gameMode, room.status]);

  // Before showing either the "who did you kill" or "who killed you" screen,
  // every acting player must confirm their phone is hidden from other
  // couples first - re-asked every round (killers and victims alike, so the
  // required tap count stays identical for both roles) so nobody nearby can
  // read a kill claim or suspicion off someone's screen.
  const [phoneHiddenConfirmedRound, setPhoneHiddenConfirmedRound] = useState(null);

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
    socket.emit('confirmPartner', { roomId: room.id });
  };

  const handleVote = (suspectCoupleId) => {
    socket.emit('castVote', { roomId: room.id, suspectId: suspectCoupleId });
  };

  const handleSubmitKillClaim = (victimCoupleId, victimName) => {
    setConfirmState({
      message: victimCoupleId ? t('player.confirmKillClaim', { name: victimName }) : t('player.confirmKillClaimNobody'),
      onConfirm: () => socket.emit('submitKillClaim', { roomId: room.id, victimId: victimCoupleId })
    });
  };

  const handleSubmitVictimReport = (feltKilled, suspectCoupleId) => {
    socket.emit('submitVictimReport', { roomId: room.id, feltKilled, suspectId: suspectCoupleId });
  };

  const handleLeaveClick = () => {
    setConfirmState({
      message: t('player.leaveConfirm'),
      onConfirm: onLeave
    });
  };

  // Every persistent icon action reachable from anywhere in the game - leave,
  // how-to-play, language, song suggestion, and (when relevant) Spotify share
  // - as one horizontal row anchored to the card's top-right corner, instead
  // of each icon independently absolute-positioned into two stacked rows
  // (leave alone on top, language+song-suggest below it) the way this used
  // to be split across the old leaveButton/songSuggestButton consts. The row
  // itself has no explicit width (anchored via right:10px only), so it just
  // grows further left as conditional icons (admin kebab, Spotify share)
  // appear/disappear rather than needing per-button offsets recalculated.
  const topIconRow = (
    <>
      <div style={{ position: 'absolute', top: '10px', right: '10px', zIndex: 10, display: 'flex', alignItems: 'center', gap: '2px' }}>
        {currentUser?.isSuperAdmin && (
          <button
            onClick={() => setShowAdminModal(true)}
            className="kebab-menu-btn"
            title={t('admin.menuItem')}
          >
            <div className="kebab-dot"></div>
            <div className="kebab-dot"></div>
            <div className="kebab-dot"></div>
          </button>
        )}
        {/* Was a lobby-only inline text link further down the card - now a
            permanent icon here so the rules stay one tap away from every
            phase of the game, not just the pre-game wait screen. */}
        <button onClick={() => setShowHowTo(true)} className="icon-btn" title={t('howto.linkLabel')}>
          <HelpCircle size={20} />
        </button>
        <button onClick={() => setShowLanguageModal(true)} className="icon-btn" title={t('common.languageMenuItem')}>
          <Globe size={20} />
        </button>
        <button onClick={() => setShowSongSuggest(true)} className="icon-btn" title={t('player.suggestSongTitle')}>
          <Music2 size={20} />
        </button>
        {currentUser && mySpotifyLinked && (isMySpotifyDelegate || isMyShareRequestPending || spotifyShareOffPossible) && (
          <button onClick={() => setShowSpotifyShare(true)} className="icon-btn" title={t('player.spotifyShareTitle')}>
            <Share2 size={20} style={isMySpotifyDelegate ? { color: 'var(--neon-green)' } : undefined} />
          </button>
        )}
        <button onClick={handleLeaveClick} className="icon-btn" title={t('common.leave')}>
          <X size={20} />
        </button>
      </div>

      <ConfirmModal
        isOpen={!!confirmState}
        message={confirmState?.message}
        onConfirm={() => confirmState?.onConfirm()}
        onCancel={() => setConfirmState(null)}
      />
      {showAdminModal && <AdminOverridesModal room={room} onClose={() => setShowAdminModal(false)} />}
      <LanguageModal isOpen={showLanguageModal} onClose={() => setShowLanguageModal(false)} />
      <HowToPlayModal
        isOpen={showHowTo}
        onClose={() => setShowHowTo(false)}
        gameMode={room.gameMode}
        // 'paired' excluded deliberately, not just 'lobby' - couples exist by
        // then but room.gameMode/myCouple.role don't (both are only ever set
        // inside startGame(), which runs after 'paired') - narrowing here
        // would show a wrong "Standard mode" description and misjudge this
        // player's role/context before either actually exists yet.
        inRound={room.status !== 'lobby' && room.status !== 'paired'}
        roomStatus={room.status}
        myRole={myCouple?.role}
        mySpecialRole={myCouple?.specialRole}
      />

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

            {spotifySuggestionsAllowed && (
              <div className="segmented-control" style={{ marginBottom: '15px' }}>
                <button className={`segmented-option accent-green ${suggestMode === 'text' ? 'is-active' : ''}`} onClick={() => setSuggestMode('text')}>
                  {t('player.suggestModeText')}
                </button>
                <button className={`segmented-option accent-green ${suggestMode === 'spotify' ? 'is-active' : ''}`} onClick={() => setSuggestMode('spotify')}>
                  {t('player.suggestModeSpotify')}
                </button>
                {playerPlaylists.length > 0 && (
                  <button className={`segmented-option accent-green ${suggestMode === 'playlist' ? 'is-active' : ''}`} onClick={() => setSuggestMode('playlist')}>
                    {t('player.suggestModePlaylist')}
                  </button>
                )}
              </div>
            )}

            {(!spotifySuggestionsAllowed || suggestMode === 'text') && (
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

            {spotifySuggestionsAllowed && suggestMode === 'spotify' && (
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
                        key={track.uri}
                        onClick={() => handleSuggestTrack(track)}
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
                )}
                {suggestSearchDone && suggestResults.length === 0 && (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '15px', fontSize: '0.9rem' }}>{t('spotify.noResults')}</p>
                )}
              </>
            )}

            {suggestMode === 'playlist' && (
              <>
                {!activeSuggestPlaylist ? (
                  <div className="couple-list" style={{ marginTop: 0, marginBottom: '15px' }}>
                    {playerPlaylists.map(pl => (
                      <div
                        key={pl.id}
                        onClick={() => handlePickSuggestPlaylist(pl)}
                        className="list-item list-item--purple"
                        style={{ cursor: 'pointer' }}
                      >
                        <Music2 size={20} className="icon-inline" style={{ color: 'var(--neon-purple)', flexShrink: 0 }} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>
                            {pl.name}
                          </div>
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

      {showSpotifyShare && createPortal(
        <div className="modal-overlay" onClick={() => setShowSpotifyShare(false)}>
          <div className="modal-card cyber-card" style={{ maxWidth: '420px', border: '1px solid var(--neon-green)' }} onClick={(e) => e.stopPropagation()}>
            <button className="icon-btn modal-close-btn" onClick={() => setShowSpotifyShare(false)}>
              <X size={20} />
            </button>
            <h3 style={{ color: 'var(--neon-green)', marginBottom: '15px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              <Share2 size={20} />
              {t('player.spotifyShareTitle')}
            </h3>
            <p style={{ color: 'var(--text-muted)', marginBottom: '15px', fontSize: '0.9rem' }}>{t('player.spotifyShareBody')}</p>

            {isMySpotifyDelegate ? (
              <>
                <p style={{ color: 'var(--neon-green)', textAlign: 'center', marginBottom: '15px' }}>{t('player.spotifyShareActive')}</p>
                <button className="cyber-button" disabled={spotifyShareBusy} style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }} onClick={handleRevokeSpotify}>
                  {t('player.spotifyShareRevoke')}
                </button>
              </>
            ) : isMyShareRequestPending ? (
              <>
                <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '15px' }}>{t('player.spotifyShareWaiting')}</p>
                <button className="cyber-button" disabled={spotifyShareBusy} style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }} onClick={handleRevokeSpotify}>
                  {t('player.spotifyShareWithdraw')}
                </button>
              </>
            ) : room.gmSpotifyConnected ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>{t('player.spotifyShareGmConnected')}</p>
            ) : room.spotifyDelegate ? (
              <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>{t('player.spotifyShareOtherActive', { name: room.spotifyDelegate.name })}</p>
            ) : (
              <>
                {/* Says out loud what used to just look like nothing
                    happening - and, since the automatic re-offer is now
                    suppressed after a refusal, this button is the only way
                    back in, so it has to be obvious that it's still there. */}
                {room.mySpotifyShareDenied && (
                  <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '12px', fontSize: '0.9rem' }}>
                    {t('player.spotifyShareDeclined')}
                  </p>
                )}
                <button className="cyber-button" disabled={spotifyShareBusy} onClick={() => handleRequestSpotifyShare()}>
                  {t(room.mySpotifyShareDenied ? 'player.spotifyShareGrantAgain' : 'player.spotifyShareGrant')}
                </button>
              </>
            )}
            {spotifyShareError && (
              <p style={{ color: 'var(--neon-red)', textAlign: 'center', marginTop: '10px', fontSize: '0.9rem' }}>{t(spotifyShareError)}</p>
            )}
          </div>
        </div>,
        document.body
      )}
    </>
  );

  const playerNameTag = me ? (
    // Sits below the icon row (top:10px, one row tall) now that every icon
    // lives on a single horizontal line instead of stacked rows down the
    // right side - this can use the card's full width again instead of
    // stopping short to leave room for icons beside it.
    <div style={{ position: 'absolute', top: '54px', left: '15px', right: '15px', color: 'var(--text-muted)', fontSize: '0.9rem', textAlign: 'left', zIndex: 5 }}>
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
      {/* Players previously had no way to tell Chaos/Max Kills apart from a
          plain Standard game short of asking the GM - shown here (not just
          on the GM's own dashboard) since it's set once for the whole game
          and this tag is already visible from every phase.
          Gated on 'lobby' only, not 'lobby'/'paired': the mode shouldn't
          leak while the GM is still configuring things pre-pairing (and used
          to be undefined then anyway), but should appear the moment pairs
          are released, not only once the round itself starts - see
          gameStore.setGameMode, which now mirrors the GM's lobby choice onto
          the room live so it's already populated by the time releasePairs()
          flips the status to 'paired'. */}
      {room.status !== 'lobby' && (
        <div style={{ marginTop: '2px', fontSize: '0.75rem', letterSpacing: '1px', color: room.gameMode && room.gameMode !== 'standard' ? 'var(--neon-purple)' : 'inherit', opacity: room.gameMode && room.gameMode !== 'standard' ? 1 : 0.5 }}>
          {t('gm.gameMode')}: {t(room.gameMode === 'chaos' ? 'gm.gameModeChaos' : room.gameMode === 'maxkills' ? 'gm.gameModeMaxKills' : 'gm.gameModeStandard')}
        </div>
      )}
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
        {topIconRow}
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px', marginTop: '20px' }}>{t('phase.lobby')}</h2>
        <div className="pulse-animation" style={{ width: '50px', height: '50px', borderRadius: '50%', background: 'var(--neon-purple)', margin: '0 auto 20px' }}></div>
        <p style={{ color: 'var(--text-muted)' }}>{t('player.lobbyWait')}</p>
        {/* The how-to-play link used to live here as lobby-only inline text -
            now a persistent icon in topIconRow above, available from every
            phase (not just this pre-game wait screen), so nothing further
            is needed here. */}
        <div style={{ textAlign: 'center', margin: '20px 0' }}>
          <div className="qr-frame">
            <img
              src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(window.location.origin + '/?room=' + room.id)}`}
              alt="QR Code"
              style={{ display: 'block' }}
            />
          </div>
        </div>
      </div>
    );
  }

  if (room.status === 'paired') {
    if (!myCouple) {
      return (
        <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
          {playerNameTag}
          {topIconRow}
          <h2 style={{ color: 'var(--text-muted)', marginBottom: '20px', marginTop: '20px' }}>{t('player.spectatorTitle')}</h2>
          <p>{t('player.spectatorBody')}</p>
        </div>
      );
    }

    const partners = myCouple.playerIds.filter(id => id !== clientId).map(id => room.players.find(p => p.id === id)?.name);

    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
        {playerNameTag}
        {topIconRow}
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
        {topIconRow}
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
          {topIconRow}
          <h2 className="glitch-text" style={{ color: 'var(--text-muted)', fontSize: '2.5rem', marginBottom: '20px', marginTop: '20px', textShadow: 'none' }}>
            {t('player.abortedTitle')}
          </h2>
          <h3 style={{ color: 'var(--text-muted)' }}>
            {t('player.abortedBody')}
          </h3>
          {renderCurrentTrackWidget()}
        </div>
      );
    }
    if (room.gameMode === 'maxkills') {
      const ranking = buildMaxKillsRanks(room.maxKillsFinalRanking || []);
      const topKills = ranking[0]?.kills ?? 0;
      const myRank = ranking.findIndex(r => r.coupleId === myCouple?.id);
      const iWon = myRank !== -1 && ranking[myRank].kills === topKills && topKills > 0;
      return (
        <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
          {playerNameTag}
          {topIconRow}
          <h2 className="glitch-text" style={{
            color: iWon ? '#00ff66' : 'var(--neon-purple)',
            fontSize: '2.5rem', marginBottom: '20px', marginTop: '20px',
            textShadow: iWon ? '0 0 15px rgba(0,255,102,0.5)' : '0 0 15px rgba(181,43,255,0.5)'
          }}>
            {t('player.maxKillsGameOverTitle')}
          </h2>
          <div className="couple-list" style={{ marginBottom: '20px', textAlign: 'left', maxWidth: '400px', margin: '0 auto 20px' }}>
            {ranking.map((entry) => {
              const couple = room.couples.find(c => c.id === entry.coupleId);
              const isWinner = entry.kills === topKills && topKills > 0;
              const isMe = entry.coupleId === myCouple?.id;
              return (
                <div key={entry.coupleId} className={`list-item ${isWinner ? 'list-item--active' : ''}`} style={{ borderColor: isMe ? 'var(--neon-purple)' : undefined }}>
                  <span style={{ color: isWinner ? 'var(--neon-purple)' : 'var(--text-muted)', fontWeight: 'bold' }}>{entry.rankLabel} {couple?.name || '?'}{isMe ? ` (${t('player.maxKillsYouLabel')})` : ''}</span>
                  <span className="badge badge--purple">{t('player.maxKillsKillsBadge', { count: entry.kills })}</span>
                </div>
              );
            })}
          </div>
          <p style={{ color: 'var(--text-muted)' }}>{t('player.waitNewRound')}</p>
          {renderCurrentTrackWidget()}
        </div>
      );
    }

    const winners = room.couples.filter(c => c.status === 'alive');
    const killersWon = winners.some(c => c.role === 'killer');
    const killerCouples = room.couples.filter(c => c.role === 'killer');

    // Märtyrer-Paar (special role): a personal win condition inverted from
    // everyone else's - they win by being voted out, independent of who
    // actually won the game as a team. Deliberately NOT a kill: with few
    // killers against many dancer couples, a kill eventually reaches almost
    // every dancer before a typical game ends (killers need the dancer team
    // reduced to their own headcount to win outright, and a group that can't
    // correctly vote out the real killer early just keeps losing couples to
    // kills until then) - making "killed at some point" true for the
    // martyr ~90% of the time in practice, not the special, engineered-
    // feeling moment a personal win condition should be. A vote-out doesn't
    // have that problem: it takes the rest of the table actually choosing to
    // eliminate this couple, an outcome with no such structural bias.
    const isMartyr = myCouple?.specialRole === 'martyr';
    const martyrObjectiveMet = isMartyr && myCouple.eliminatedBy === 'vote';

    // Being voted out/eliminated is a personal loss even if teammates (other killer couples) go on to win.
    const playerWon = isMartyr ? martyrObjectiveMet : (!isEliminated && ((role === 'killer' && killersWon) || (role !== 'killer' && !killersWon)));

    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', position: 'relative', paddingTop: '90px' }}>
        {playerNameTag}
        {topIconRow}
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
            {/* ', ' not ' & ' - killerCount can be >1, and " & " already
                separates a couple's own two members (see the matching
                comment on GMDashboard.jsx's kill_reveal panel). */}
            {t('player.killerLabel')} <strong>{killerCouples.map(c => c.name).join(', ')}</strong>
          </p>
        )}

        {(() => {
          if (isMartyr) {
            // Replaces the normal team-outcome narrative below entirely -
            // that one is about who won as a team, this is the Martyr's own
            // separate personal objective, which can disagree with it in
            // either direction (e.g. personally "won" on a losing team).
            return martyrObjectiveMet
              ? <p style={{ color: '#00ff66', fontSize: '1.2rem', marginBottom: '20px' }}>{t('player.martyrObjectiveMet')}</p>
              : <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>{t('player.martyrObjectiveMissed')}</p>;
          }
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
        {renderCurrentTrackWidget()}
      </div>
    );
  }

  // Eliminated players during game
  if (isEliminated) {
    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center', borderColor: 'var(--neon-red)', position: 'relative', paddingTop: '90px' }}>
        {playerNameTag}
        {topIconRow}
        <h2 className="glitch-text" style={{ color: 'var(--neon-red)', fontSize: '2rem', marginBottom: '20px', marginTop: '20px' }}>{t('player.eliminatedTitle')}</h2>
        {room.deadPlayersKeepDancing ? (
          <>
            <p style={{ color: 'var(--text-muted)' }}>{t('player.deadTaskIntro')}</p>
            <div className="panel panel--info" style={{ padding: '20px', marginTop: '15px' }}>
              <p style={{ color: 'var(--neon-blue)', fontWeight: 'bold', marginBottom: '8px' }}>{t('player.deadTaskTitle')}</p>
              <p style={{ fontSize: '1.1rem' }}>{t(`player.deadTask${deadTaskIndex + 1}`)}</p>
            </div>
          </>
        ) : (
          <p style={{ color: 'var(--text-muted)' }}>{t('player.eliminatedBody')}</p>
        )}
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
      {topIconRow}
      {(room.status === 'dancing' || room.status === 'silent_report' || room.status === 'voting' || room.status === 'role_reveal' || room.status === 'kill_reveal' || room.status === 'vote_reveal') && (
        <p style={{ color: 'var(--text-muted)', marginBottom: '10px', marginTop: '20px' }}>{t('player.round', { n: room.round })}</p>
      )}

      {renderCurrentTrackWidget()}

      {room.status === 'dancing' && (
        <div className="panel panel--info" style={{ animation: 'pulse 2s infinite' }}>
          <h2 style={{ color: 'var(--neon-blue)', fontSize: '1.5rem', letterSpacing: '2px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
            <Music2 size={22} className="icon-inline" /> {t('player.danceStarted')} <Music2 size={22} className="icon-inline" />
          </h2>
          <p style={{ marginTop: '10px', color: 'white' }}>{t('player.danceBody')}</p>
        </div>
      )}

      {room.status === 'dancing' && myCouple.specialRole === 'puzzle' && myCouple.status === 'alive' && (
        <div className="panel panel--purple" style={{ marginTop: '15px' }}>
          <p style={{ color: 'var(--neon-purple)', fontWeight: 'bold', marginBottom: '8px' }}>{t('player.puzzleRoleTaskTitle')}</p>
          <p style={{ fontSize: '1.1rem' }}>{t(`player.puzzleRoleTask${puzzleRoleTaskIndex + 1}`)}</p>
        </div>
      )}

      {/* Max Kills mode - all live, during 'dancing' itself (see the plan) -
          this mode never uses 'silent_report'/'voting' at all, so everything
          from claiming a kill to self-reporting one to accusing the killer
          lives right here instead of a separate phone phase. */}
      {room.status === 'dancing' && room.gameMode === 'maxkills' && myCouple.status === 'alive' && (() => {
        const isKillerRound = role === 'killer';
        const iAmOut = (room.maxKillsRoundOutIds || []).includes(myCouple.id);
        const iWasHit = (room.maxKillsRoundVictimIds || []).includes(myCouple.id);
        const hitAt = room.maxKillsHitAt?.[myCouple.id];
        const secondsLeft = hitAt ? Math.max(0, 20 - Math.floor((maxKillsNow - hitAt) / 1000)) : 0;

        if (!canVote) {
          return (
            <div className="panel" style={{ textAlign: 'center', marginTop: '15px' }}>
              <h3 style={{ color: 'var(--text-muted)' }}>{t('player.partnerActing')}</h3>
              <p style={{ marginTop: '10px' }}>{t('player.partnerActingBody')}</p>
            </div>
          );
        }

        if (iAmOut) {
          if (iWasHit) {
            return (
              <div className="panel panel--danger" style={{ marginTop: '15px', textAlign: 'center' }}>
                <h3 style={{ color: 'var(--neon-red)', marginBottom: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <Skull size={20} className="icon-inline" /> {t('player.maxKillsYouWereHit')}
                </h3>
                {room.killMode === 'silent' ? (
                  secondsLeft > 0
                    ? <p style={{ color: 'white' }}>{t('player.maxKillsLeaveFloorCountdown', { seconds: secondsLeft })}</p>
                    : <p style={{ color: 'white' }}>{t('player.maxKillsLeaveFloorNow')}</p>
                ) : (
                  <p style={{ color: 'white' }}>{t('player.maxKillsStayOnFloor')}</p>
                )}
              </div>
            );
          }
          return (
            <div className="panel panel--purple" style={{ marginTop: '15px', textAlign: 'center' }}>
              <h3 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>{t('player.maxKillsWrongAccusationTitle')}</h3>
              <p style={{ color: 'white' }}>{t('player.maxKillsWrongAccusationBody')}</p>
            </div>
          );
        }

        // Shared by both the killer's and every dancer's view below - for
        // the killer this is a dummy, wired to the exact same event everyone
        // else's button is: submitMaxKillsAccusation already silently no-ops
        // for the round's own killer (`accuser.role === 'killer'` returns
        // null - see gameStore.js), so nothing it does here has any real
        // effect. It exists so the killer's phone offers the same "raise a
        // suspicion" move as everyone else's, letting them point the finger
        // at someone else as an actual social-deduction tactic instead of
        // visibly lacking a button every other phone on the floor has.
        const accusePanel = (
          <div className="panel panel--info">
            {!showMaxKillsAccusationPicker ? (
              <button
                className="cyber-button"
                style={{ background: 'transparent', border: '1px solid var(--neon-blue)' }}
                onClick={() => setShowMaxKillsAccusationPicker(true)}
              >
                {t('player.maxKillsAccuseButton')}
              </button>
            ) : (
              <>
                <h3 style={{ color: 'var(--neon-blue)', marginBottom: '10px' }}>{t('player.maxKillsAccuseWhoTitle')}</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '10px' }}>{t('player.maxKillsAccuseHint')}</p>
                <div className="couple-list">
                  {aliveSuspectCouples.map(c => (
                    <button key={c.id} className="cyber-button" onClick={() => socket.emit('submitMaxKillsAccusation', { roomId: room.id, suspectCoupleId: c.id })}>
                      {c.name}
                    </button>
                  ))}
                  <button
                    className="cyber-button"
                    style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }}
                    onClick={() => setShowMaxKillsAccusationPicker(false)}
                  >
                    {t('player.maxKillsAccuseCancelBtn')}
                  </button>
                </div>
              </>
            )}
          </div>
        );

        if (isKillerRound) {
          return (
            <div style={{ marginTop: '15px' }}>
              {room.killMode !== 'silent' ? (
                <div className="panel panel--danger" style={{ textAlign: 'center', marginBottom: '15px' }}>
                  <p style={{ color: 'white' }}>{t('player.classicKillerGmMarksHint')}</p>
                </div>
              ) : (
                <div className="panel panel--danger" style={{ marginBottom: '15px' }}>
                  <h3 style={{ color: 'var(--neon-red)', marginBottom: '10px' }}>{t('player.maxKillsWhoDidYouKill')}</h3>
                  <div className="couple-list">
                    {aliveSuspectCouples.map(c => {
                      const claimed = (room.maxKillsKillClaims || []).includes(c.id);
                      return (
                        <button
                          key={c.id}
                          className={`cyber-button ${claimed ? 'pulse-animation' : ''}`}
                          onClick={() => socket.emit('submitMaxKillsKillClaim', { roomId: room.id, targetCoupleId: c.id })}
                        >
                          {claimed ? <><Check size={14} className="icon-inline" /> {c.name}</> : c.name}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {accusePanel}
            </div>
          );
        }

        return (
          <div style={{ marginTop: '15px' }}>
            {room.killMode === 'silent' && (
              <div className="panel panel--purple" style={{ marginBottom: '15px' }}>
                <h3 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>{t('player.maxKillsWereYouHitQuestion')}</h3>
                <button className="cyber-button" onClick={() => socket.emit('submitMaxKillsVictimSelfReport', { roomId: room.id })}>
                  {t('player.maxKillsWereYouHitYes')}
                </button>
              </div>
            )}
            {accusePanel}
          </div>
        );
      })()}

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

        if (phoneHiddenConfirmedRound !== room.round) {
          return (
            <div className="panel panel--info" style={{ textAlign: 'center', marginTop: '20px' }}>
              <h3 style={{ color: 'var(--neon-blue)', marginBottom: '15px' }}>{t('player.confirmPhoneHiddenTitle')}</h3>
              <p style={{ color: 'white', marginBottom: '15px' }}>{t('player.confirmPhoneHiddenBody')}</p>
              <button className="cyber-button pulse-animation" onClick={() => setPhoneHiddenConfirmedRound(room.round)}>
                {t('player.confirmPhoneHiddenButton')}
              </button>
            </div>
          );
        }

        // Berühr-Paar special role, silent kill mode: gate the normal kill-
        // claim/victim-report flow below behind this couple's own touch
        // self-report first - independent of (and required in addition to)
        // whatever they report about themselves as a potential victim.
        if (myCouple.specialRole === 'toucher' && !Object.prototype.hasOwnProperty.call(room.toucherReports || {}, myCouple.id)) {
          return (
            <div className="panel panel--purple" style={{ marginTop: '20px' }}>
              <h3 style={{ color: 'var(--neon-purple)', marginBottom: '15px' }}>{t('player.toucherReportQuestion')}</h3>
              <div className="couple-list">
                <button className="cyber-button" onClick={() => socket.emit('submitToucherReport', { roomId: room.id, touched: true })}>
                  {t('player.toucherReportYes')}
                </button>
                <button
                  className="cyber-button"
                  style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }}
                  onClick={() => socket.emit('submitToucherReport', { roomId: room.id, touched: false })}
                >
                  {t('player.toucherReportNo')}
                </button>
              </div>
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
            <button className={decoyAnswer === '' ? 'cyber-button disabled' : 'cyber-button pulse-animation'} disabled={decoyAnswer === ''} onClick={() => handleSubmitVictimReport(false, null)}>
              {t('player.decoySubmit')}
            </button>
          </div>
        );
      })()}

      {room.status === 'kill_reveal' && room.gameMode !== 'maxkills' && (() => {
        const victimCouples = (room.victimIds || []).map(id => room.couples.find(c => c.id === id)).filter(Boolean);
        return (
          <div className={`panel ${victimCouples.length > 0 ? 'panel--danger' : 'panel--info'}`}>
            <h2 style={{ color: victimCouples.length > 0 ? 'var(--neon-red)' : 'var(--neon-blue)', marginBottom: '15px' }}>
              {t('player.musicStopped')}
            </h2>
            {victimCouples.length > 0 ? (
              <p style={{ fontSize: '1.2rem', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                {/* ', ' not ' & ' - see the matching comment in GMDashboard.jsx's
                    kill_reveal panel; same ambiguity, same fix. */}
                <Skull size={20} className="icon-inline" style={{ color: 'var(--neon-red)' }} /> <strong style={{ color: 'var(--neon-red)' }}>{t('player.wereEliminated', { names: victimCouples.map(c => c.name).join(', ') })}</strong>
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

      {/* Max Kills round summary - reuses 'kill_reveal' as this mode's own
          round-summary phase (see gameStore.js's finishMaxKillsRound). The
          killer's identity only becomes public knowledge here, once the
          round is already over - see room.maxKillsRoundResult. */}
      {room.status === 'kill_reveal' && room.gameMode === 'maxkills' && (() => {
        const result = room.maxKillsRoundResult;
        if (!result) return null;
        const killerCouple = room.couples.find(c => c.id === result.killerCoupleId);
        return (
          <div className="panel panel--purple">
            <h2 style={{ color: 'var(--neon-purple)', marginBottom: '15px' }}>{t('player.maxKillsRoundSummaryTitle')}</h2>
            <p style={{ fontSize: '1.2rem', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '10px' }}>
              <Skull size={20} className="icon-inline" style={{ color: 'var(--neon-red)' }} />
              <strong style={{ color: 'var(--neon-red)' }}>{t('player.maxKillsRoundKillerWas', { name: killerCouple?.name || '?' })}</strong>
            </p>
            <p style={{ color: 'white', marginBottom: '10px' }}>{t('player.maxKillsRoundKillTotal', { count: result.kills })}</p>
            {result.caught ? (
              <p style={{ color: 'var(--neon-blue)' }}>{t('player.maxKillsCaughtThisTime')}</p>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>{t('player.maxKillsNotCaughtThisTime')}</p>
            )}
            <p style={{ color: 'var(--text-muted)', marginTop: '20px' }}>{t('player.waitingGm')}</p>
          </div>
        );
      })()}

      {room.status === 'kill_reveal' && myCouple.specialRole === 'seer' && myCouple.status === 'alive' && (() => {
        const myPeek = room.seerPeeks?.[myCouple.id];
        if (myPeek) {
          const target = room.couples.find(c => c.id === myPeek.targetCoupleId);
          return (
            <div className="panel panel--purple" style={{ marginTop: '20px' }}>
              <h3 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>{t('player.seerResultTitle')}</h3>
              <p style={{ fontSize: '1.1rem', color: 'white' }}>
                {t('player.seerResult', { name: target?.name || '?', role: t(`role.${myPeek.targetRole}`) })}
              </p>
            </div>
          );
        }
        return (
          <div className="panel panel--purple" style={{ marginTop: '20px' }}>
            <h3 style={{ color: 'var(--neon-purple)', marginBottom: '15px' }}>{t('player.seerPeekPrompt')}</h3>
            <div className="couple-list">
              {aliveSuspectCouples.map(c => (
                <button key={c.id} className="cyber-button" onClick={() => socket.emit('seerPeek', { roomId: room.id, targetCoupleId: c.id })}>
                  {t('player.seerPeekTarget', { name: c.name })}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {room.status === 'kill_reveal' && myCouple.specialRole === 'protector' && myCouple.status === 'alive' && (() => {
        // Includes the Protector's own couple as a pickable target (self-
        // protection is allowed) - aliveSuspectCouples excludes self, so the
        // full alive-couples list is built here instead.
        const allAliveCouples = room.couples.filter(c => c.status === 'alive');
        const currentPick = room.couples.find(c => c.id === room.protectorPick);
        return (
          <div className="panel panel--purple" style={{ marginTop: '20px' }}>
            <h3 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>{t('player.protectorPickPrompt')}</h3>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '15px' }}>{t('player.protectorPickHint')}</p>
            {currentPick && (
              <p style={{ color: 'white', marginBottom: '15px' }}>{t('player.protectorCurrentPick', { name: currentPick.name })}</p>
            )}
            <div className="couple-list">
              {allAliveCouples.map(c => (
                <button
                  key={c.id}
                  className="cyber-button"
                  style={c.id === room.protectorPick ? { borderColor: 'var(--neon-blue)', color: 'var(--neon-blue)' } : undefined}
                  onClick={() => socket.emit('submitProtectorPick', { roomId: room.id, targetCoupleId: c.id })}
                >
                  {t('player.protectorPickTarget', { name: c.name })}
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {(room.status === 'role_reveal' || room.status === 'dancing' || room.status === 'kill_reveal') && (
        <div style={{ marginTop: '20px' }}>
          {room.status === 'role_reveal' && canSwitchVotingRole && (
            <div style={{ marginBottom: '30px' }}>{votingRoleSwitcher}</div>
          )}
          <button
            className="cyber-button pulse-animation"
            onMouseDown={() => {
              setShowRole(true);
              if (!me.hasViewedRole) socket.emit('roleViewed', { roomId: room.id });
            }}
            onMouseUp={() => setShowRole(false)}
            onMouseLeave={() => setShowRole(false)}
            onTouchStart={() => {
              setShowRole(true);
              if (!me.hasViewedRole) socket.emit('roleViewed', { roomId: room.id });
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
                <p style={{ fontSize: '1.1rem' }}>
                  {room.gameMode === 'maxkills' ? t('player.maxKillsKillerInstructions') : t('player.killerInstructions')}
                  {room.gameMode !== 'maxkills' && <><br/><strong style={{color: 'white', marginTop: '10px', display: 'block'}}>{t('player.killerLimit')}</strong></>}
                </p>
                {/* Classic kill mode's actual mechanism was never explained
                    here - a killer only ever learned "the GM marks your
                    kills" if they happened to see the same line elsewhere
                    (Max Kills' equivalent moment, a completely different
                    screen). Silent mode needs no such note: those killers
                    already see the self-report flow that IS the mechanism.
                    Max Kills mode gets its own version of this at the actual
                    moment it matters (during 'dancing', see above) instead of
                    repeating it here too. */}
                {room.gameMode !== 'maxkills' && room.killMode !== 'silent' && (
                  <p style={{ fontSize: '0.95rem', marginTop: '10px', color: 'var(--text-muted)' }}>
                    {t('player.classicKillerGmMarksHint')}
                  </p>
                )}
                {otherKillerCouples.length > 0 && (
                  <p style={{ fontSize: '1rem', marginTop: '15px', color: 'white' }}>
                    {t('player.otherKillers', { names: otherKillerCouples.map(c => c.name).join(', ') })}
                  </p>
                )}
              </div>
            ) : myCouple?.specialRole === 'puzzle' ? (
              // Sonderrolle "Rätsel-Paar" - still fundamentally a dancer, just
              // with an extra explanation of the puzzle task shown during
              // dancing (see the panel rendered above, gated on room.status
              // === 'dancing'). Seer/Protector/Toucher still fall through to
              // the plain dancer panel below until they're built.
              <div className="panel panel--purple" style={{ padding: '30px', marginBottom: 0 }}>
                <h2 style={{ color: 'var(--neon-purple)', fontSize: '1.8rem', marginBottom: '15px' }}>{t('player.youArePuzzleRole')}</h2>
                <p style={{ fontSize: '1.1rem' }}>{t('player.puzzleRoleInstructions')}</p>
              </div>
            ) : myCouple?.specialRole === 'martyr' ? (
              // Sonderrolle "Märtyrer-Paar" - personal win condition inverted
              // (see the 'ended' screen below), nothing to do differently
              // during the round itself beyond knowing the goal.
              <div className="panel panel--purple" style={{ padding: '30px', marginBottom: 0 }}>
                <h2 style={{ color: 'var(--neon-purple)', fontSize: '1.8rem', marginBottom: '15px' }}>{t('player.youAreMartyr')}</h2>
                <p style={{ fontSize: '1.1rem' }}>{t('player.martyrInstructions')}</p>
              </div>
            ) : myCouple?.specialRole === 'seer' ? (
              // Sonderrolle "Seher" - the actual peek happens later, during
              // kill_reveal (see the block rendered there below).
              <div className="panel panel--purple" style={{ padding: '30px', marginBottom: 0 }}>
                <h2 style={{ color: 'var(--neon-purple)', fontSize: '1.8rem', marginBottom: '15px' }}>{t('player.youAreSeer')}</h2>
                <p style={{ fontSize: '1.1rem' }}>{t('player.seerInstructions')}</p>
              </div>
            ) : myCouple?.specialRole === 'protector' ? (
              // Sonderrolle "Beschützer" - the actual pick happens later,
              // during kill_reveal (see the block rendered there below), and
              // protects the *next* round, not this one (round 1 has nobody
              // protected yet).
              <div className="panel panel--purple" style={{ padding: '30px', marginBottom: 0 }}>
                <h2 style={{ color: 'var(--neon-purple)', fontSize: '1.8rem', marginBottom: '15px' }}>{t('player.youAreProtector')}</h2>
                <p style={{ fontSize: '1.1rem' }}>{t('player.protectorInstructions')}</p>
              </div>
            ) : myCouple?.specialRole === 'toucher' ? (
              // Sonderrolle "Berühr-Paar" - the actual report happens
              // per-round: GM-marked (classic) during 'dancing', or
              // self-reported (silent) during 'silent_report' below.
              <div className="panel panel--purple" style={{ padding: '30px', marginBottom: 0 }}>
                <h2 style={{ color: 'var(--neon-purple)', fontSize: '1.8rem', marginBottom: '15px' }}>{t('player.youAreToucher')}</h2>
                <p style={{ fontSize: '1.1rem' }}>{t('player.toucherInstructions')}</p>
              </div>
            ) : (
              <div className="panel panel--info" style={{ padding: '30px', marginBottom: 0 }}>
                <h2 style={{ color: 'var(--neon-blue)', fontSize: '1.8rem', marginBottom: '15px' }}>{t('player.youAreDancers')}</h2>
                <p style={{ fontSize: '1.1rem' }}>{room.gameMode === 'maxkills' ? t('player.maxKillsDancerInstructions') : t('player.dancerInstructions')}</p>
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
                {/* ', ' not ' & ' - see the matching comment above/in
                    GMDashboard.jsx's kill_reveal panel; same ambiguity. */}
                <Skull size={18} className="icon-inline" /> {t('player.wasKilled', { names: victimCouples.map(c => c.name).join(', ') })}
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

      {/* VOTE REVEAL - between 'voting' and the next 'dancing' round, the GM
          announces who (if anyone) got voted out before continuing (see
          gameStore.executeVote's 'voting' branch and GMDashboard.jsx's
          matching VOTE REVEAL phase block). */}
      {room.status === 'vote_reveal' && (() => {
        const votedOutCouple = room.voteResult?.votedOutCoupleId
          ? room.couples.find(c => c.id === room.voteResult.votedOutCoupleId)
          : null;
        return (
          <div className={`panel ${votedOutCouple ? 'panel--danger' : 'panel--info'}`}>
            <h2 style={{ color: votedOutCouple ? 'var(--neon-red)' : 'var(--neon-blue)', marginBottom: '15px' }}>
              {t('player.voteRevealTitle')}
            </h2>
            {votedOutCouple ? (
              <p style={{ fontSize: '1.2rem', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Skull size={20} className="icon-inline" style={{ color: 'var(--neon-red)' }} /> <strong style={{ color: 'var(--neon-red)' }}>{t('player.wasVotedOut', { name: votedOutCouple.name })}</strong>
              </p>
            ) : (
              <p style={{ fontSize: '1.2rem', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                <Sparkles size={20} className="icon-inline" /> {t('player.nobodyVotedOut')}
              </p>
            )}
            <p style={{ color: 'var(--text-muted)', marginTop: '20px' }}>{t('player.waitingGm')}</p>
          </div>
        );
      })()}
    </div>
  );
}

export default PlayerScreen;
