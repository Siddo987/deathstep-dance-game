import React, { useState } from 'react';
import { socket } from '../socket.js';
import { ConfirmModal } from './Modal.jsx';
import { loginWithSpotify, searchTracks, playTrack, pausePlayback, logoutSpotify } from '../spotify.js';

function GMDashboard({ room, onLeave }) {
  const [pendingCouples, setPendingCouples] = useState([]);
  const [currentGroup, setCurrentGroup] = useState([]); 
  
  // State for the randomizer dialog flow
  const [randomizerFlow, setRandomizerFlow] = useState(null);
  const [showMenu, setShowMenu] = useState(false);
  const [confirmState, setConfirmState] = useState(null);
  
  // Spotify State
  const [useSpotify, setUseSpotify] = useState(() => {
    return localStorage.getItem('deathstep_use_spotify') === 'true';
  });
  const [spotifyToken, setSpotifyToken] = useState(null);
  const [spotifyPlayerId, setSpotifyPlayerId] = useState(null);
  const [spotifyPlayer, setSpotifyPlayer] = useState(null);
  const [showSpotifyModal, setShowSpotifyModal] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasSongFinished, setHasSongFinished] = useState(false);
  const [playerStatus, setPlayerStatus] = useState('Initializing player...');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [selectedTrack, setSelectedTrack] = useState(() => {
    const saved = localStorage.getItem('deathstep_selected_track');
    return saved ? JSON.parse(saved) : null;
  });
  const [playbackProgress, setPlaybackProgress] = useState(0);
  const [playbackDuration, setPlaybackDuration] = useState(1);

  // New states
  const [bypassRoleView, setBypassRoleView] = useState(false);
  const [bypassPaired, setBypassPaired] = useState(false);

  React.useEffect(() => {
    if (room.status !== 'paired') setBypassPaired(false);
    if (room.status !== 'role_reveal') setBypassRoleView(false);
  }, [room.status]);

  React.useEffect(() => {
    localStorage.setItem('deathstep_use_spotify', useSpotify);
  }, [useSpotify]);

  React.useEffect(() => {
    if (selectedTrack) {
      localStorage.setItem('deathstep_selected_track', JSON.stringify(selectedTrack));
    } else {
      localStorage.removeItem('deathstep_selected_track');
    }
  }, [selectedTrack]);

  React.useEffect(() => {
    if (room.status === 'kill_reveal' || room.status === 'lobby') {
      setSelectedTrack(null);
    }
  }, [room.status]);

  React.useEffect(() => {
    if (!spotifyPlayer || !isPlaying) return;
    const interval = setInterval(() => {
      spotifyPlayer.getCurrentState().then(state => {
        if (!state) return;
        setPlaybackProgress(state.position);
        setPlaybackDuration(state.duration);
        localStorage.setItem('deathstep_playback_state', JSON.stringify({
          position: state.position,
          uri: state.track_window.current_track.uri,
          timestamp: Date.now()
        }));
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [spotifyPlayer, isPlaying]);

  React.useEffect(() => {
    if (playbackDuration > 0 && playbackProgress >= playbackDuration - 1500) {
      setHasSongFinished(true);
    }
  }, [playbackProgress, playbackDuration]);

  React.useEffect(() => {
    setHasSongFinished(false);
  }, [selectedTrack, room?.status, room?.round]);

  React.useEffect(() => {
    const token = localStorage.getItem('spotify_access_token');
    if (token) {
      setSpotifyToken(token);
    }
  }, []);

  React.useEffect(() => {
    if (!spotifyToken) return;

    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'Deathstep Web Player',
        getOAuthToken: cb => { cb(spotifyToken); },
        volume: 0.5
      });

      player.addListener('ready', ({ device_id }) => {
        console.log('Ready with Device ID', device_id);
        setSpotifyPlayerId(device_id);
        setSpotifyPlayer(player);
        setPlayerStatus('Ready to play directly in browser! 🔊');

        // Check if we should auto-resume
        const savedPlayback = localStorage.getItem('deathstep_playback_state');
        if (savedPlayback) {
          try {
            const pb = JSON.parse(savedPlayback);
            const elapsed = Date.now() - pb.timestamp;
            // Only resume if the timestamp is less than 15s old (meaning it was a quick reload while playing)
            if (elapsed < 15000) {
              const newPosition = pb.position + elapsed;
              playTrack(pb.uri, device_id, newPosition).catch(e => console.error(e));
            }
          } catch(e) {}
        }
      });

      player.addListener('player_state_changed', state => {
        if (!state) return;
        setIsPlaying(!state.paused);
        setPlaybackProgress(state.position);
        setPlaybackDuration(state.duration);
      });

      player.addListener('not_ready', ({ device_id }) => {
        setPlayerStatus('Player offline');
      });

      player.addListener('initialization_error', ({ message }) => setPlayerStatus('Error: ' + message));
      player.addListener('authentication_error', ({ message }) => setPlayerStatus('Auth Error: ' + message));
      player.addListener('account_error', ({ message }) => setPlayerStatus('Premium Required: ' + message));

      player.connect();
    };

    if (window.Spotify) {
      window.onSpotifyWebPlaybackSDKReady();
    }
  }, [spotifyToken]);

  const menuRef = React.useRef();

  React.useEffect(() => {
    const handleClickOutside = (event) => {
      if (menuRef.current && !menuRef.current.contains(event.target)) {
        setShowMenu(false);
      }
    };
    if (showMenu) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showMenu]);

  const handleStartGame = () => {
    socket.emit('startGame', { roomId: room.id });
  };

  const handleReportKill = (victimCoupleId) => {
    if (victimCoupleId === null) {
      socket.emit('reportKill', { roomId: room.id, victimId: null });
    } else {
      setConfirmState({
        message: 'Report this couple as killed by the killer?',
        onConfirm: () => socket.emit('reportKill', { roomId: room.id, victimId: victimCoupleId })
      });
    }
  };

  const handleExecuteVote = (suspectCoupleId) => {
    socket.emit('executeVote', { roomId: room.id, suspectId: suspectCoupleId });
  };

  const handleStartDancing = async () => {
    socket.emit('startDancing', { roomId: room.id });
    if (selectedTrack && spotifyToken) {
      try {
        await playTrack(selectedTrack.uri, spotifyPlayerId);
      } catch (e) {
        if (e.message === 'NO_ACTIVE_DEVICE') {
          alert("Fehler: Kein aktives Spotify-Gerät gefunden!\n\nBitte warte, bis der Web Player den Status 'Ready' hat.");
        } else {
          console.error("Failed to play track", e);
        }
      }
    }
  };

  const handleRevealKill = () => {
    setConfirmState({
      message: 'Den markierten Kill jetzt für alle Spieler aufdecken?' + (isPlaying ? '\n(Achtung: Die Musik wird gestoppt!)' : ''),
      onConfirm: async () => {
        socket.emit('revealKill', { roomId: room.id });
        if (spotifyToken) {
          try {
            await pausePlayback();
          } catch (e) {
            console.error("Failed to pause playback", e);
          }
        }
      }
    });
  };

  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery) return;
    try {
      const results = await searchTracks(searchQuery);
      setSearchResults(results);
    } catch (e) {
      console.error("Failed to search tracks", e);
    }
  };

  const handleProceedToVoting = () => {
    socket.emit('proceedToVoting', { roomId: room.id });
  };

  const handleStartDiscussion = () => {
    socket.emit('startDiscussion', { roomId: room.id });
  };

  const handleResetGame = () => {
    setConfirmState({
      message: 'Reset to lobby for a new pairing?',
      onConfirm: () => {
        if (spotifyPlayer) {
          spotifyPlayer.pause().catch(e => console.error("Failed to pause", e));
        }
        socket.emit('resetGame', { roomId: room.id });
        setPendingCouples([]);
        setCurrentGroup([]);
        setRandomizerFlow(null);
      }
    });
  };

  const handleEndGame = () => {
    setConfirmState({
      message: 'End the game immediately and reveal the winners?',
      onConfirm: () => {
        if (spotifyPlayer) {
          spotifyPlayer.pause().catch(e => console.error("Failed to pause", e));
        }
        socket.emit('endGame', { roomId: room.id });
      }
    });
  };

  const handleChangeRole = (clientId, newRole) => {
    socket.emit('updatePlayerRole', { roomId: room.id, clientId, newRole });
  };

  const handleKickPlayer = (clientId) => {
    setConfirmState({
      message: 'Diesen Spieler endgültig aus dem Raum entfernen?',
      onConfirm: () => socket.emit('kickPlayer', { roomId: room.id, clientId })
    });
  };

  const handleDissolvePendingCouple = (index) => {
    const newCouples = [...pendingCouples];
    newCouples.splice(index, 1);
    setPendingCouples(newCouples);
  };

  const handleSetVotingRole = (e) => {
    socket.emit('setVotingRole', { roomId: room.id, role: e.target.value });
  };

  // --- Pairing Logic ---

  const getUnpairedPlayers = () => {
    const pairedIds = pendingCouples.flatMap(c => c.playerIds);
    return room.players.filter(p => !pairedIds.includes(p.id));
  };

  const executePairing = (leads, follows, makeThreesomes) => {
    const newCouples = [...pendingCouples];
    let spectatorsToUpdate = [];
    
    // Determine how many base 1-to-1 couples we can form
    const baseCouplesCount = Math.min(leads.length, follows.length);
    
    // Form base 1-to-1 couples first
    for (let i = 0; i < baseCouplesCount; i++) {
      const lIndex = Math.floor(Math.random() * leads.length);
      const fIndex = Math.floor(Math.random() * follows.length);
      
      const l = leads.splice(lIndex, 1)[0];
      const f = follows.splice(fIndex, 1)[0];
      
      newCouples.push({
        name: `${l.name} & ${f.name}`,
        playerIds: [l.id, f.id]
      });
    }

    if (makeThreesomes) {
      const remainingPlayers = [...leads, ...follows]; // One of these is empty
      while (remainingPlayers.length > 0) {
        const pIndex = Math.floor(Math.random() * remainingPlayers.length);
        const p = remainingPlayers.splice(pIndex, 1)[0];
        
        // Find couples that currently have exactly 2 players (to avoid 4-person groups)
        const availableCouples = newCouples.filter(c => c.playerIds.length === 2);
        
        if (availableCouples.length > 0) {
           const cIndex = Math.floor(Math.random() * availableCouples.length);
           availableCouples[cIndex].name += ` & ${p.name}`;
           availableCouples[cIndex].playerIds.push(p.id);
        } else {
           // Fallback if no 2-person couples left (should be blocked by UI check)
           spectatorsToUpdate.push(p);
        }
      }
    }

    setPendingCouples(newCouples);

    spectatorsToUpdate.forEach(p => {
      socket.emit('updatePlayerRole', { roomId: room.id, clientId: p.id, newRole: 'spectator' });
    });
    setRandomizerFlow(null);
  };

  const handleRandomPairsClick = () => {
    const unpaired = getUnpairedPlayers();
    if (unpaired.length < 2) {
      alert("Es gibt nicht genug unverpaarte Spieler! Bitte klicke erst auf 'Clear Pairs', um alle aufzuheben und neu zu mischen.");
      return;
    }

    const leads = unpaired.filter(p => p.danceRole === 'lead');
    const follows = unpaired.filter(p => p.danceRole === 'follow');
    const excessCount = Math.abs(leads.length - follows.length);
    const baseCouplesCount = Math.min(leads.length, follows.length);

    if (excessCount === 0) {
      executePairing([...leads], [...follows], false);
    } else {
      setRandomizerFlow({
        step: 'mixed_selection',
        excessType: leads.length > follows.length ? 'lead' : 'follow',
        excessCount,
        baseCouplesCount,
        leads,
        follows,
        selectedToKick: []
      });
    }
  };

  const handleToggleKickSelection = (playerId) => {
    let selected = [...randomizerFlow.selectedToKick];
    if (selected.includes(playerId)) {
      selected = selected.filter(id => id !== playerId);
    } else {
      selected.push(playerId);
    }
    setRandomizerFlow({ ...randomizerFlow, selectedToKick: selected });
  };

  const executeMixedSelection = () => {
    const minKickCount = Math.max(0, randomizerFlow.excessCount - randomizerFlow.baseCouplesCount);
    
    if (randomizerFlow.selectedToKick.length < minKickCount) {
      alert(`Bitte wähle mindestens ${minKickCount} Spieler zum Aussortieren aus. Ansonsten kommt es zu unzulässigen Paaren mit 4 Personen!`);
      return;
    }
    
    let leads = [...randomizerFlow.leads];
    let follows = [...randomizerFlow.follows];
    const kickedPlayers = [];
    
    if (randomizerFlow.excessType === 'lead') {
      randomizerFlow.selectedToKick.forEach(id => {
        const idx = leads.findIndex(p => p.id === id);
        if (idx !== -1) kickedPlayers.push(leads.splice(idx, 1)[0]);
      });
    } else {
      randomizerFlow.selectedToKick.forEach(id => {
        const idx = follows.findIndex(p => p.id === id);
        if (idx !== -1) kickedPlayers.push(follows.splice(idx, 1)[0]);
      });
    }
    
    kickedPlayers.forEach(p => {
      socket.emit('updatePlayerRole', { roomId: room.id, clientId: p.id, newRole: 'spectator' });
    });
    
    // Unselected players stay in the leads/follows arrays and are passed down to be threesomes
    executePairing(leads, follows, true);
  };

  const handleToggleCurrentGroup = (player) => {
    if (currentGroup.includes(player.id)) {
      setCurrentGroup(currentGroup.filter(id => id !== player.id));
    } else {
      setCurrentGroup([...currentGroup, player.id]);
    }
  };

  const handleCreateManualCouple = () => {
    if (currentGroup.length < 2) return;
    const names = currentGroup.map(id => room.players.find(p => p.id === id)?.name).join(' & ');
    setPendingCouples([
      ...pendingCouples,
      { name: names, playerIds: currentGroup }
    ]);
    setCurrentGroup([]);
  };

  const handleClearPairs = () => {
    socket.emit('resetRoles', { roomId: room.id });
    setPendingCouples([]);
    setCurrentGroup([]);
    setRandomizerFlow(null);
  };

  const handleReleasePairs = () => {
    if (pendingCouples.length === 0) return alert("No couples to release!");
    socket.emit('releasePairs', { roomId: room.id, generatedCouples: pendingCouples });
  };

  // --- Helper views ---
  
  const getVoteCount = (suspectCoupleId) => {
    if (!room.votes) return 0;
    return Object.values(room.votes).filter(id => id === suspectCoupleId).length;
  };

  const handleExecuteVoteSafe = (suspectCoupleId) => {
    const aliveCouples = room.couples ? room.couples.filter(c => c.status === 'alive') : [];
    const voteCounts = aliveCouples.map(c => ({ id: c.id, votes: getVoteCount(c.id) }));
    const maxVotes = Math.max(...voteCounts.map(v => v.votes), 0);
    const topCouples = voteCounts.filter(v => v.votes === maxVotes && maxVotes > 0);

    const message = suspectCoupleId === null
      ? (topCouples.length === 1 
          ? `WARNUNG: Es gibt einen klaren Mehrheits-Vote für "${aliveCouples.find(c => c.id === topCouples[0].id)?.name}" (${maxVotes} Votes). Willst du den Vote ignorieren und niemanden kicken?`
          : 'Niemanden kicken und nächste Runde starten?')
      : (getVoteCount(suspectCoupleId) < maxVotes || maxVotes === 0
          ? `WARNUNG: Dieses Paar hat NICHT die meisten Votes (${getVoteCount(suspectCoupleId)} vs ${maxVotes}). Willst du dich über die Abstimmung hinwegsetzen und sie kicken?`
          : (topCouples.length > 1
              ? `HINWEIS: Es gibt einen Gleichstand mit ${maxVotes} Votes. Du als GM brichst jetzt den Gleichstand, indem du dieses Paar kickst. Fortfahren?`
              : 'Dieses Paar (mit den meisten Votes) kicken?'));

    setConfirmState({
      message,
      onConfirm: () => handleExecuteVote(suspectCoupleId)
    });
  };

  const aliveCouples = room.couples ? room.couples.filter(c => c.status === 'alive') : [];

  const renderTruncatedNames = (combinedName) => {
    if (!combinedName) return null;
    const names = combinedName.split(' & ');
    return (
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 0, flex: 1, gap: '5px' }}>
        {names.map((n, idx) => (
          <React.Fragment key={idx}>
            {idx > 0 && <span style={{ opacity: 0.5, flexShrink: 0 }}>&amp;</span>}
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>{n}</span>
          </React.Fragment>
        ))}
      </div>
    );
  };

  const renderSpotifyControls = (hideIfConnected = false, isModal = false) => {
    if (!useSpotify) return null;
    if (hideIfConnected && spotifyToken) return null;
    if (!isModal && selectedTrack) return null;
    
    return (
      <div style={{ marginBottom: '20px', padding: '15px', background: 'rgba(29, 185, 84, 0.1)', border: '1px solid #1db954', borderRadius: '8px' }}>
        <h3 style={{ color: '#1db954', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
            <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.84.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.54-1.02.72-1.559.42z"/>
          </svg>
          Spotify Integration
        </h3>
        
        {!spotifyToken ? (
          <button className="cyber-button" style={{ background: '#1db954', color: 'black' }} onClick={loginWithSpotify}>
            CONNECT SPOTIFY PREMIUM
          </button>
        ) : (
          <div>
            <div style={{ color: 'var(--text-muted)', marginBottom: '15px' }}>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '10px', marginBottom: '5px' }}>
                <strong style={{ color: spotifyPlayerId ? '#1db954' : 'var(--neon-red)' }}>{playerStatus}</strong>
                {playerStatus.includes('Error') && (
                  <button 
                    className="cyber-button" 
                    style={{ padding: '4px 8px', fontSize: '0.7rem', background: '#1db954', color: 'black', minWidth: 'auto', margin: 0 }}
                    onClick={loginWithSpotify}
                  >
                    RETRY AUTH
                  </button>
                )}
              </div>
              Select a track to play automatically when the dance starts!
            </div>
            
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '10px', marginBottom: '15px' }}>
              <input 
                type="text" 
                className="cyber-input" 
                style={{ marginBottom: 0, flex: 1 }} 
                placeholder="Search for a song..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <button type="submit" className="cyber-button" style={{ width: 'auto', padding: '0 20px' }}>Search</button>
            </form>

            {searchResults.length > 0 && (
              <div className="couple-list" style={{ marginTop: 0, marginBottom: '15px' }}>
                {searchResults.map(track => (
                  <div key={track.id} 
                    onClick={() => { 
                      setSelectedTrack(track); 
                      setSearchResults([]); 
                      setSearchQuery(''); 
                      if (room.status === 'dancing' && spotifyPlayerId) {
                        playTrack(track.uri, spotifyPlayerId).catch(console.error);
                      }
                    }}
                    style={{ padding: '10px', background: 'rgba(0,0,0,0.5)', border: '1px solid var(--neon-purple)', borderRadius: '5px', display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer' }}
                  >
                    <img src={track.album.images[2]?.url} alt="" style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{track.name}</div>
                      <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{track.artists.map(a => a.name).join(', ')}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {selectedTrack && (
              <div style={{ padding: '10px', background: 'rgba(29, 185, 84, 0.2)', border: '1px solid #1db954', borderRadius: '5px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <img src={selectedTrack.album.images[2]?.url} alt="" style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '0.8rem', color: '#1db954', textTransform: 'uppercase', fontWeight: 'bold' }}>SELECTED TRACK</div>
                  <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{selectedTrack.name}</div>
                </div>
                <button 
                  style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: '1.2rem' }}
                  onClick={() => setSelectedTrack(null)}
                >
                  ✖
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderSpotifyPlaybackBar = () => {
    if (!useSpotify || !spotifyToken || !selectedTrack) return null;
    return (
      <div style={{ position: 'relative', marginBottom: '20px', padding: '15px', background: 'rgba(29, 185, 84, 0.1)', border: '1px solid #1db954', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '15px', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', bottom: 0, left: 0, height: '4px', background: '#1db954', width: `${(playbackProgress / playbackDuration) * 100}%`, transition: 'width 1s linear' }}></div>
        <img src={selectedTrack.album.images[2]?.url} alt="" style={{ width: '50px', height: '50px', borderRadius: '50%', position: 'relative', zIndex: 2 }} />
        <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 2 }}>
          <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white', fontWeight: 'bold' }}>{selectedTrack.name}</div>
          <div style={{ fontSize: '0.8rem', color: '#1db954' }}>NOW PLAYING</div>
        </div>
        <button 
          disabled={!spotifyPlayer}
          style={{ 
            width: '50px', 
            height: '50px', 
            borderRadius: '50%', 
            padding: 0, 
            display: 'flex', 
            justifyContent: 'center', 
            alignItems: 'center', 
            background: spotifyPlayer ? '#1db954' : 'gray', 
            color: 'black', 
            border: 'none',
            cursor: spotifyPlayer ? 'pointer' : 'not-allowed',
            boxShadow: isPlaying ? '0 0 15px #1db954' : 'none',
            transition: 'all 0.2s ease-in-out',
            opacity: spotifyPlayer ? 1 : 0.5,
            flexShrink: 0
          }}
          onClick={async () => {
            if (spotifyPlayer) {
              if (isPlaying) {
                spotifyPlayer.pause();
              } else {
                const state = await spotifyPlayer.getCurrentState();
                if (state && state.track_window.current_track.uri === selectedTrack.uri) {
                  spotifyPlayer.resume();
                } else {
                  playTrack(selectedTrack.uri, spotifyPlayerId).catch(console.error);
                }
              }
            }
          }}
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
          ) : (
            <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="cyber-card" style={{ position: 'relative' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', marginTop: '20px' }}>
        <h2 style={{ color: 'var(--neon-purple)', margin: 0 }}>GM DASHBOARD</h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <div style={{ background: 'rgba(0,240,255,0.1)', padding: '5px 10px', borderRadius: '5px', border: '1px solid var(--neon-blue)' }}>
            <span style={{ color: 'var(--text-muted)' }}>BALLROOM CODE:</span>{' '}
            <strong style={{ color: 'var(--neon-blue)', fontSize: '1.2rem', letterSpacing: '2px' }}>{room.id}</strong>
          </div>
          
          {/* 3-Dot Menu Container */}
          <div style={{ position: 'relative', zIndex: 100 }} ref={menuRef}>
            <div style={{ display: 'flex', gap: '10px' }}>
              {selectedTrack && room.status !== 'dancing' && (
                <button 
                  className="kebab-menu-btn pulse-animation" 
                  onClick={() => setShowSpotifyModal(true)}
                  title="Change Spotify Track"
                  style={{ color: '#1db954' }}
                >
                  <svg viewBox="0 0 24 24" width="24" height="24" fill="currentColor">
                    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.84.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.6.18-1.2.72-1.38 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.54-1.02.72-1.559.42z"/>
                  </svg>
                </button>
              )}
              <button 
                className="kebab-menu-btn"
                onClick={() => setShowMenu(!showMenu)} 
                title="Menu"
              >
                <div className="kebab-dot"></div>
                <div className="kebab-dot"></div>
                <div className="kebab-dot"></div>
              </button>
            </div>
            {showMenu && (
              <div className="dropdown-menu">
                {room.status !== 'lobby' && (
                  <button className="dropdown-item danger" onClick={() => { setShowMenu(false); handleEndGame(); }}>
                    End Game Immediately
                  </button>
                )}
                <button className="dropdown-item danger" onClick={() => { 
                  setShowMenu(false); 
                  setConfirmState({ message: 'Close the ballroom? This will kick all players.', onConfirm: () => {
                    localStorage.removeItem('deathstep_selected_track');
                    onLeave();
                  }});
                }}>
                  Close Ballroom
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      <div style={{ marginBottom: '20px', padding: '10px', background: 'rgba(0,0,0,0.3)', borderRadius: '5px' }}>
        <p>Status: <strong style={{ textTransform: 'uppercase', color: (room.status === 'dancing' || room.status === 'role_reveal') ? 'var(--neon-blue)' : 'var(--neon-purple)' }}>{room.status.replace('_', ' ')}</strong></p>
        {room.round > 0 && <p>Round: <strong>{room.round}</strong></p>}
      </div>

      {/* LOBBY PHASE */}
      {room.status === 'lobby' && (
        <div style={{ marginBottom: '20px' }}>
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button className="cyber-button" style={{ flex: 1, background: !useSpotify ? 'var(--neon-purple)' : 'transparent', color: !useSpotify ? 'black' : 'var(--neon-purple)' }} onClick={() => setUseSpotify(false)}>
              Use Own Audio System
            </button>
            <button className="cyber-button" style={{ flex: 1, background: useSpotify ? '#1db954' : 'transparent', color: useSpotify ? 'black' : '#1db954', borderColor: '#1db954' }} onClick={() => setUseSpotify(true)}>
              Use Spotify Integration
            </button>
          </div>
          
          {renderSpotifyControls(true)}

          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{ background: 'white', padding: '10px', display: 'inline-block', borderRadius: '10px', marginBottom: '15px' }}>
              <img 
                src={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(window.location.origin + '/?room=' + room.id)}`} 
                alt="QR Code" 
                style={{ display: 'block' }} 
              />
            </div>
          </div>

          <h3 style={{ color: 'var(--neon-blue)', marginBottom: '10px' }}>Players ({room.players.length})</h3>
          
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button className="cyber-button pulse-animation" onClick={handleRandomPairsClick} style={{ flex: 1 }}>
              Random Pairs
            </button>
            <button className="cyber-button" onClick={handleClearPairs} style={{ flex: 1 }}>
              Clear Pairs
            </button>
          </div>

          {/* IN-PAGE RANDOMIZER FLOW DIALOGS */}
          {randomizerFlow && (
            <div style={{ padding: '20px', background: 'rgba(0,240,255,0.05)', border: '1px solid var(--neon-blue)', borderRadius: '10px', marginBottom: '20px' }}>
              <h3 style={{ color: 'var(--neon-blue)', marginBottom: '15px' }}>Unbalanced Pairs!</h3>
              
              {randomizerFlow.step === 'mixed_selection' && (() => {
                const minKickCount = Math.max(0, randomizerFlow.excessCount - randomizerFlow.baseCouplesCount);
                return (
                  <div>
                    <p style={{ marginBottom: '15px' }}>
                      Es gibt <strong>{randomizerFlow.excessCount} überschüssige {randomizerFlow.excessType === 'lead' ? 'Leads' : 'Follows'}</strong>.
                    </p>
                    <p style={{ marginBottom: '15px', color: 'var(--neon-blue)' }}>
                      Select who becomes a <strong>Spectator</strong>.<br/>
                      Everyone not selected will be distributed as a 3rd person to the {randomizerFlow.baseCouplesCount} base couples! (You can create a maximum of {randomizerFlow.baseCouplesCount} 3-person couples).
                    </p>
                    {randomizerFlow.excessCount >= 2 && (
                      <p style={{ marginBottom: '15px', color: 'var(--neon-purple)', fontStyle: 'italic' }}>
                        💡 Tip: With such a large excess, you can also click "Cancel" and manually change the role of some players in the list below (e.g. make Leads into Follows) so they can dance together.
                      </p>
                    )}
                    
                    {minKickCount > 0 && (
                      <div style={{ padding: '10px', background: 'rgba(255,0,85,0.2)', border: '1px solid var(--neon-red)', borderRadius: '5px', marginBottom: '15px' }}>
                        ⚠️ Da es nur {randomizerFlow.baseCouplesCount} Basis-Paare gibt, musst du <strong>mindestens {minKickCount}</strong> Spieler zu Zuschauern machen, um 4er-Paare zu verhindern!
                      </div>
                    )}
                    
                    <div className="couple-list" style={{ marginBottom: '15px' }}>
                      {(randomizerFlow.excessType === 'lead' ? randomizerFlow.leads : randomizerFlow.follows).map(p => {
                        const isSelected = randomizerFlow.selectedToKick.includes(p.id);
                        return (
                          <div key={p.id} 
                               onClick={() => handleToggleKickSelection(p.id)}
                               style={{ 
                                 padding: '10px', 
                                 cursor: 'pointer',
                                 border: isSelected ? '1px solid var(--neon-red)' : '1px solid var(--text-muted)',
                                 background: isSelected ? 'rgba(255,0,85,0.2)' : 'rgba(0,0,0,0.5)',
                                 borderRadius: '5px',
                                 display: 'flex',
                                 alignItems: 'center',
                                 gap: '10px'
                               }}>
                            <div style={{ 
                              width: '20px', height: '20px', borderRadius: '4px', 
                              border: isSelected ? '2px solid var(--neon-red)' : '2px solid var(--text-muted)',
                              background: isSelected ? 'var(--neon-red)' : 'transparent',
                              display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0
                            }}>
                              {isSelected && <span style={{ color: 'white', fontSize: '14px', fontWeight: 'bold' }}>✗</span>}
                            </div>
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1 }}>
                              {p.name}
                            </span>
                          </div>
                        )
                      })}
                    </div>
                    <div style={{ display: 'flex', gap: '10px' }}>
                      <button className="cyber-button" onClick={executeMixedSelection} style={{ flex: 1 }}>
                        Auswahl bestätigen ({randomizerFlow.selectedToKick.length}/{randomizerFlow.excessCount})
                      </button>
                      <button className="cyber-button danger" onClick={() => setRandomizerFlow(null)} style={{ flex: 1 }}>Abbrechen</button>
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
            <div style={{ flex: 1, minWidth: 0, opacity: randomizerFlow ? 0.3 : 1, pointerEvents: randomizerFlow ? 'none' : 'auto' }}>
              <h4 style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>Unpaired</h4>
              <div className="couple-list">
                {getUnpairedPlayers().map(p => (
                  <div key={p.id} style={{ 
                    padding: '10px', background: 'rgba(0,0,0,0.5)', borderRadius: '5px', minWidth: 0,
                    border: currentGroup.includes(p.id) ? '2px solid var(--neon-purple)' : '1px solid var(--text-muted)'
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px' }}>
                      <div 
                        onClick={() => handleToggleCurrentGroup(p)} 
                        style={{ 
                          display: 'flex', alignItems: 'center', gap: '10px', flex: 1, 
                          cursor: 'pointer', overflow: 'hidden' 
                        }}
                      >
                        <div style={{ 
                          width: '20px', height: '20px', borderRadius: '4px', 
                          border: currentGroup.includes(p.id) ? '2px solid var(--neon-purple)' : '2px solid var(--text-muted)',
                          background: currentGroup.includes(p.id) ? 'var(--neon-purple)' : 'transparent',
                          display: 'flex', justifyContent: 'center', alignItems: 'center', flexShrink: 0
                        }}>
                          {currentGroup.includes(p.id) && <span style={{ color: 'black', fontSize: '14px', fontWeight: 'bold' }}>✓</span>}
                        </div>
                        <span style={{ 
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', 
                          color: currentGroup.includes(p.id) ? 'white' : 'var(--text-muted)' 
                        }}>
                          {p.name}
                        </span>
                      </div>
                      <select 
                        value={p.danceRole} 
                        onChange={(e) => handleChangeRole(p.id, e.target.value)}
                        style={{ 
                          background: 'rgba(0,0,0,0.8)', color: 'var(--neon-blue)', 
                          border: '1px solid var(--neon-blue)', borderRadius: '5px', 
                          padding: '5px 8px', outline: 'none', cursor: 'pointer', flexShrink: 0
                        }}
                      >
                        <option value="lead">Lead</option>
                        <option value="follow">Follow</option>
                        <option value="spectator">Spectator</option>
                      </select>
                      <button 
                        onClick={() => handleKickPlayer(p.id)}
                        style={{ 
                          background: 'transparent', border: 'none', color: 'var(--neon-red)', 
                          cursor: 'pointer', fontSize: '1.2rem', padding: '0 5px' 
                        }}
                        title="Kick Player"
                      >
                        ✖
                      </button>
                    </div>
                  </div>
                ))}
              </div>
              {currentGroup.length > 0 && (
                <button className="cyber-button" style={{ marginTop: '10px', width: '100%', borderColor: 'var(--neon-purple)' }} onClick={handleCreateManualCouple}>
                  Create Group ({currentGroup.length})
                </button>
              )}
            </div>

            <div style={{ flex: 1, minWidth: 0, opacity: randomizerFlow ? 0.3 : 1, pointerEvents: randomizerFlow ? 'none' : 'auto' }}>
              <h4 style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>Pending Couples</h4>
              <div className="couple-list">
                {pendingCouples.map((c, i) => (
                  <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px', background: 'rgba(0,240,255,0.1)', border: '1px solid var(--neon-blue)', borderRadius: '5px', minWidth: 0 }}>
                    {renderTruncatedNames(c.name)}
                    <button 
                      onClick={() => handleDissolvePendingCouple(i)}
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', fontSize: '1.2rem', marginLeft: '10px', flexShrink: 0 }}
                      title="Paar auflösen"
                    >
                      ✂️
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div style={{ marginBottom: '20px', padding: '15px', border: '1px solid var(--text-muted)', borderRadius: '8px' }}>
             <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
               <span style={{ color: 'var(--text-muted)' }}>Voting Right during game:</span>
               <select value={room.votingRole} onChange={handleSetVotingRole} style={{ background: 'black', color: 'white', padding: '5px', border: '1px solid var(--neon-purple)' }}>
                 <option value="lead">Leads only</option>
                 <option value="follow">Follows only</option>
               </select>
             </label>
          </div>

          <button className="cyber-button pulse-animation" onClick={handleReleasePairs} disabled={pendingCouples.length === 0 || randomizerFlow} style={{ width: '100%' }}>
            RELEASE PAIRS
          </button>
        </div>
      )}

      {/* PAIRED PHASE */}
      {room.status === 'paired' && (() => {
        const pairedPlayers = room.players.filter(p => room.couples.some(c => c.playerIds.includes(p.id)));
        const allConfirmed = pairedPlayers.length > 0 && pairedPlayers.every(p => p.isConfirmed);
        const canStart = allConfirmed || bypassPaired;

        return (
          <div style={{ marginBottom: '20px' }}>
            {renderSpotifyControls()}

            <h3 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>Waiting for Confirmations</h3>
            <div className="couple-list" style={{ marginBottom: '20px' }}>
              {pairedPlayers.map(p => (
                <div key={p.id} style={{ padding: '10px', border: p.isConfirmed ? '1px solid var(--neon-blue)' : '1px solid var(--neon-red)', borderRadius: '5px', display: 'flex', justifyContent: 'space-between' }}>
                  <span>{p.name} ({p.danceRole})</span>
                  <span style={{ color: p.isConfirmed ? 'var(--neon-blue)' : 'var(--neon-red)' }}>{p.isConfirmed ? 'Ready' : 'Waiting...'}</span>
                </div>
              ))}
            </div>
            
            <button 
              className={canStart ? "cyber-button pulse-animation" : "cyber-button disabled"} 
              onClick={handleStartGame} 
              disabled={!canStart}
              style={{ width: '100%', opacity: canStart ? 1 : 0.5, cursor: canStart ? 'pointer' : 'not-allowed' }}
            >
              REVEAL ROLES
            </button>

            {!allConfirmed && !bypassPaired && (
              <div style={{ textAlign: 'center' }}>
                <button 
                  onClick={() => setBypassPaired(true)} 
                  style={{ marginTop: '15px', background: 'transparent', border: 'none', color: 'var(--neon-red)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  Bypass check and start anyway
                </button>
              </div>
            )}
          </div>
        );
      })()}

      {/* ROLE REVEAL PHASE */}
      {room.status === 'role_reveal' && (() => {
        const aliveCouples = room.couples.filter(c => c.status === 'alive');
        // Check if at least one player per couple has viewed their role
        const allCouplesViewedRole = aliveCouples.length > 0 && aliveCouples.every(c => 
          c.playerIds.some(id => {
            const player = room.players.find(p => p.id === id);
            return player && player.hasViewedRole;
          })
        );
        const isSpotifyReady = !useSpotify || (selectedTrack && spotifyPlayer);
        const canStart = (allCouplesViewedRole || bypassRoleView) && isSpotifyReady;

        return (
          <div style={{ marginBottom: '20px' }}>
            {renderSpotifyControls()}

            <div style={{ textAlign: 'center' }}>
              <h3 style={{ color: 'var(--neon-blue)', marginBottom: '15px' }}>ROLES REVEALED</h3>
              
              {!isSpotifyReady && (
                <div style={{ padding: '10px', background: 'rgba(255,42,85,0.1)', border: '1px solid var(--neon-red)', borderRadius: '5px', marginBottom: '20px' }}>
                  <strong style={{ color: 'var(--neon-red)' }}>⚠️ MUSIC NOT READY ⚠️</strong><br/>
                  <span style={{ color: 'white' }}>Please select a song using the Spotify search above.</span>
                </div>
              )}

              {(!allCouplesViewedRole && !bypassRoleView) && (
                <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
                  Waiting for at least one player from each couple to view their role on their device...
                </p>
              )}
              
              {(allCouplesViewedRole || bypassRoleView) && isSpotifyReady && (
                <p style={{ color: '#00ff66', marginBottom: '20px' }}>
                  All checks passed! You can start the Game now!
                </p>
              )}
              
              <div className="couple-list" style={{ marginBottom: '20px', textAlign: 'left' }}>
                {aliveCouples.map(couple => {
                  const hasViewed = couple.playerIds.some(id => {
                    const player = room.players.find(p => p.id === id);
                    return player && player.hasViewedRole;
                  });
                  return (
                    <div key={couple.id} style={{ padding: '10px', border: hasViewed ? '1px solid var(--neon-blue)' : '1px solid var(--neon-red)', borderRadius: '5px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ flex: 1, minWidth: 0, marginRight: '10px' }}>
                        {renderTruncatedNames(couple.name)}
                      </div>
                      <span style={{ color: hasViewed ? 'var(--neon-blue)' : 'var(--neon-red)', whiteSpace: 'nowrap' }}>
                        {hasViewed ? 'Ready' : 'Waiting...'}
                      </span>
                    </div>
                  );
                })}
              </div>
              
              <button 
                className={canStart ? "cyber-button pulse-animation" : "cyber-button disabled"} 
                onClick={handleStartDancing} 
                disabled={!canStart}
                style={{ width: '100%', fontSize: '1.2rem', padding: '15px', opacity: canStart ? 1 : 0.5, cursor: canStart ? 'pointer' : 'not-allowed' }}
              >
                {useSpotify 
                  ? `START MUSIC & START DANCING`
                  : `START DANCING (ROUND ${room.round})`
                }
              </button>

              {!allCouplesViewedRole && !bypassRoleView && (
                <button 
                  onClick={() => setBypassRoleView(true)} 
                  style={{ marginTop: '15px', background: 'transparent', border: 'none', color: 'var(--neon-red)', textDecoration: 'underline', cursor: 'pointer' }}
                >
                  Bypass check and start anyway
                </button>
              )}
            </div>
          </div>
        );
      })()}

      {/* DANCING PHASE */}
      {room.status === 'dancing' && (() => {
        const aliveCouplesToKill = aliveCouples.filter(c => c.role !== 'killer');
        return (
          <div style={{ marginBottom: '20px' }}>
            <div style={{ padding: '20px', background: 'rgba(0,240,255,0.1)', border: '2px solid var(--neon-blue)', borderRadius: '10px', marginBottom: '20px', animation: 'pulse 2s infinite' }}>
              <h3 style={{ color: 'var(--neon-blue)', textAlign: 'center', margin: 0, letterSpacing: '2px', marginBottom: '15px' }}>🎵 DANCING IN PROGRESS 🎵</h3>
              
              {useSpotify && selectedTrack && (
                <div style={{ marginBottom: '15px' }}>
                  {!hasSongFinished ? (
                    <div style={{ padding: '10px', background: 'rgba(29, 185, 84, 0.2)', border: '1px solid #1db954', borderRadius: '5px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <img src={selectedTrack.album.images[2]?.url} alt="" style={{ width: '40px', height: '40px', borderRadius: '4px' }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: '0.8rem', color: '#1db954', textTransform: 'uppercase', fontWeight: 'bold' }}>AKTUELLER SONG</div>
                        <div style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{selectedTrack.name}</div>
                      </div>
                      <button 
                        disabled={!spotifyPlayer}
                        style={{ 
                          width: '40px', height: '40px', borderRadius: '50%', padding: 0, 
                          display: 'flex', justifyContent: 'center', alignItems: 'center', 
                          background: spotifyPlayer ? '#1db954' : 'gray', color: 'black', border: 'none',
                          cursor: spotifyPlayer ? 'pointer' : 'not-allowed', flexShrink: 0
                        }}
                        onClick={async () => {
                          if (spotifyPlayer) {
                            if (isPlaying) {
                              spotifyPlayer.pause();
                            } else {
                              const state = await spotifyPlayer.getCurrentState();
                              if (state && state.track_window.current_track.uri === selectedTrack.uri) {
                                spotifyPlayer.resume();
                              } else {
                                playTrack(selectedTrack.uri, spotifyPlayerId).catch(console.error);
                              }
                            }
                          }
                        }}
                      >
                        {isPlaying ? (
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>
                        ) : (
                          <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        )}
                      </button>
                    </div>
                  ) : (
                    <div style={{ padding: '10px', background: 'rgba(255, 0, 0, 0.2)', border: '1px solid var(--neon-red)', borderRadius: '5px', textAlign: 'center', color: 'var(--neon-red)', fontWeight: 'bold' }}>
                      Das Lied ist vorbei!
                    </div>
                  )}
                </div>
              )}

              <p style={{ textAlign: 'center', color: 'white', margin: 0 }}>Everyone is dancing! The killers can secretly eliminate one couple by touching them.</p>
            </div>

            <div style={{ background: 'rgba(0,0,0,0.5)', padding: '20px', borderRadius: '10px', border: '1px solid var(--neon-purple)' }}>
              <h4 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>Observe the dance floor</h4>
              <p style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>
                Watch to see if any pair is touched/killed by the killers.
              </p>
              <p style={{ color: 'var(--text-muted)', marginBottom: '5px' }}>
                <strong>Mark killed Pair:</strong>
              </p>

              <div className="couple-list" style={{ marginBottom: '20px' }}>
                {aliveCouplesToKill.map(couple => (
                  <button 
                    key={couple.id} 
                    className={`kill-option-btn ${room.pendingVictimId === couple.id ? 'selected' : ''}`}
                    onClick={() => handleReportKill(couple.id)}
                  >
                    <span style={{ flexShrink: 0, minWidth: '100px', whiteSpace: 'nowrap' }}>
                      {room.pendingVictimId === couple.id ? '✓ Marked:' : 'Kill:'}
                    </span>
                    {renderTruncatedNames(couple.name)}
                  </button>
                ))}
              </div>
              <button 
                className={`nobody-option-btn ${room.pendingVictimId === null ? 'selected' : ''}`}
                onClick={() => handleReportKill(null)}
                style={{ marginBottom: '20px' }}
              >
                {room.pendingVictimId === null ? '✓ Marked: NOBODY KILLED' : 'NOBODY KILLED'}
              </button>

              <button 
                className="cyber-button pulse-animation" 
                style={{ width: '100%', padding: '15px', fontSize: '1.2rem', borderColor: 'var(--neon-purple)' }} 
                onClick={handleRevealKill}
              >
                REVEAL KILL TO PLAYERS
              </button>
            </div>
          </div>
        );
      })()}

      {/* KILL REVEAL PHASE */}
      {room.status === 'kill_reveal' && (() => {
        const victimCouple = room.victimId ? room.couples.find(c => c.id === room.victimId) : null;
        return (
          <div style={{ marginBottom: '20px', textAlign: 'center' }}>
            {renderSpotifyControls()}
            <h3 style={{ color: 'var(--neon-purple)', marginBottom: '15px' }}>KILL REVEALED</h3>
            {victimCouple ? (
              <>
                <p style={{ color: 'var(--neon-red)', fontSize: '1.2rem', marginBottom: '20px' }}>
                  💀 <strong>{victimCouple.name}</strong> were eliminated!
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                  <button className="cyber-button pulse-animation" onClick={handleStartDiscussion} style={{ width: '100%', fontSize: '1.2rem', padding: '15px' }}>
                    START DISCUSSION PHASE
                  </button>
                  <button className="cyber-button" onClick={handleProceedToVoting} style={{ width: '100%', background: 'transparent', color: 'var(--text-muted)' }}>
                    PROCEED TO VOTING (SKIP)
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: 'var(--neon-blue)', fontSize: '1.2rem', marginBottom: '20px' }}>
                  ✨ Nobody was eliminated!
                </p>
                <button className="cyber-button pulse-animation" onClick={handleStartDancing} style={{ width: '100%', fontSize: '1.2rem', padding: '15px' }}>
                  START NEXT DANCE ROUND
                </button>
              </>
            )}
          </div>
        );
      })()}

      {/* DISCUSSION PHASE */}
      {room.status === 'discussion' && (
        <div style={{ marginBottom: '20px' }}>
          {renderSpotifyControls()}
          <h3 style={{ color: 'var(--neon-purple)', marginBottom: '15px' }}>DISCUSSION PHASE</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: '30px' }}>The dancers can now discuss who the killers might be.</p>
          <button className="cyber-button pulse-animation" onClick={handleProceedToVoting} style={{ width: '100%', fontSize: '1.2rem', padding: '15px' }}>
            PROCEED TO VOTING
          </button>
        </div>
      )}

      {/* VOTING PHASE */}
      {room.status === 'voting' && (
        <div style={{ marginBottom: '20px' }}>
          {renderSpotifyControls()}
          <h3 style={{ color: 'var(--neon-purple)', marginBottom: '10px' }}>VOTING PHASE</h3>
          <div className="couple-list">
            {aliveCouples.map(couple => {
              const hasVoted = Object.keys(room.votes || {}).includes(couple.id);
              return (
                <div key={couple.id} style={{ display: 'flex', flexDirection: 'column', gap: '5px', padding: '10px', border: '1px solid var(--neon-purple)', borderRadius: '8px', background: 'rgba(0,0,0,0.5)', minWidth: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minWidth: 0 }}>
                    {renderTruncatedNames(couple.name)}
                    <span style={{ color: hasVoted ? 'var(--neon-blue)' : 'var(--text-muted)', fontSize: '0.9rem', margin: '0 10px', flexShrink: 0 }}>
                      {hasVoted ? '[✓ Voted]' : '[... Waiting]'}
                    </span>
                    <strong style={{ color: 'var(--neon-purple)', flexShrink: 0 }}>{getVoteCount(couple.id)} Votes</strong>
                  </div>
                  <button className="cyber-button danger" style={{ padding: '8px', fontSize: '0.9rem' }} onClick={() => handleExecuteVoteSafe(couple.id)}>
                    KICK & NEXT ROUND
                  </button>
                </div>
              );
            })}
          </div>
          <button className="cyber-button" style={{ marginTop: '15px' }} onClick={() => handleExecuteVoteSafe(null)}>
            TIE / KICK NOBODY (NEXT ROUND)
          </button>
        </div>
      )}

      {room.status === 'ended' && (() => {
        const winners = room.couples.filter(c => c.status === 'alive');
        const killersWon = winners.some(c => c.role === 'killer');
        const killerCouple = room.couples.find(c => c.role === 'killer');
        return (
          <div style={{ marginTop: '30px', padding: '20px', background: killersWon ? 'rgba(255,0,85,0.1)' : 'rgba(0,240,255,0.1)', border: `2px solid ${killersWon ? 'var(--neon-red)' : 'var(--neon-blue)'}`, borderRadius: '10px', textAlign: 'center' }}>
            <h3 style={{ color: killersWon ? 'var(--neon-red)' : 'var(--neon-blue)', marginBottom: '20px' }}>
              {killersWon ? 'SIEG DER KILLER' : 'SIEG DER TÄNZER'}
            </h3>
            {killerCouple && (
              <p style={{ fontSize: '1.2rem', marginBottom: '15px', color: 'white' }}>
                Killer: <strong style={{ color: 'var(--neon-red)' }}>{killerCouple.name}</strong>
              </p>
            )}
            <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>
              Das Spiel ist beendet.
            </p>
            <button className="cyber-button pulse-animation" style={{ width: '100%' }} onClick={handleResetGame}>
              ZURÜCK ZUR LOBBY / NEUE RUNDE
            </button>
          </div>
        );
      })()}

      {/* ALWAYS SHOW ALL COUPLES/PLAYERS IF PAST LOBBY */}
      {room.status !== 'lobby' && (
        <div style={{ marginTop: '30px' }}>
          <h3 style={{ marginBottom: '15px', color: 'var(--text-muted)' }}>ALL COUPLES ({room.couples.length})</h3>
          <div className="couple-list">
            {room.couples.map(couple => (
              <div key={couple.id} style={{ 
                padding: '15px', 
                background: 'rgba(0,0,0,0.5)', 
                border: `1px solid ${couple.status === 'eliminated' ? 'var(--neon-red)' : 'var(--neon-blue)'}`,
                borderRadius: '8px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: '10px',
                minWidth: 0
              }}>
                <strong style={{ fontSize: '1.1rem', color: couple.status === 'eliminated' ? 'var(--text-muted)' : 'white', display: 'flex', minWidth: 0, flex: 1 }} className={couple.status === 'eliminated' ? 'status-eliminated' : ''}>
                  {renderTruncatedNames(couple.name)}
                </strong>
                {room.status !== 'lobby' && room.status !== 'paired' && (
                  <span className={`role-${couple.role}`} style={{ fontSize: '0.8rem', textTransform: 'uppercase', flexShrink: 0 }}>
                    {couple.role}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      <ConfirmModal 
        isOpen={!!confirmState}
        message={confirmState?.message}
        onConfirm={() => {
          if (confirmState && confirmState.onConfirm) {
            confirmState.onConfirm();
          }
          setConfirmState(null);
        }}
        onCancel={() => setConfirmState(null)}
      />

      {showSpotifyModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100%', height: '100%', background: 'rgba(0,0,0,0.8)', zIndex: 9999, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <div className="cyber-card" style={{ maxWidth: '600px', width: '90%', margin: '0 20px', border: '1px solid #1db954', position: 'relative' }}>
            <button 
              onClick={() => setShowSpotifyModal(false)}
              style={{ position: 'absolute', top: '15px', right: '15px', background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.5rem', cursor: 'pointer' }}
            >
              ✖
            </button>
            {renderSpotifyControls(false, true)}
          </div>
        </div>
      )}
    </div>
  );
}

export default GMDashboard;
