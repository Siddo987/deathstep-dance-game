import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Skull, Heart } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import {
  fetchAdminOverrides, addPairOverride, removePairOverride,
  addKillerOverride, removeKillerOverride,
} from '../admin.js';

// Hidden owner-only control, reachable only via the admin menu item in
// GMDashboard.jsx's kebab menu (itself only rendered for a currentUser
// listed in admin_users - see server/db.js/server/admin.js). Lets the site
// owner pre-decide, live and per round, who dances with whom (during the
// room's lobby phase) and who becomes the killer (once paired, before the GM
// starts the game) - see gameStore.applyPairOverrides/startGame. Deliberately
// re-set fresh every round rather than a standing per-account rule: a
// persistent "account X always wins" setup would eventually produce a
// noticeable pattern for regular players. Only takes effect when the GM
// randomizes; a GM who assigns pairing/killer by hand is never touched, and
// never sees this modal or its effects as anything but "how the dice landed".
function AdminOverridesModal({ room, onClose }) {
  const { t } = useLanguage();
  const [pairOverrides, setPairOverrides] = useState([]);
  const [killerOverridePlayerIds, setKillerOverridePlayerIds] = useState([]);
  const [actionError, setActionError] = useState('');
  const [selectedPlayerIds, setSelectedPlayerIds] = useState([]);

  const load = async () => {
    const result = await fetchAdminOverrides(room.id);
    if (!result.error) {
      setPairOverrides(result.pairOverrides || []);
      setKillerOverridePlayerIds(result.killerOverridePlayerIds || []);
    }
  };

  useEffect(() => { load(); }, [room.id]);

  const translateError = (code) => t(`admin.error.${code}`) || t('admin.error.generic');

  const togglePlayerSelection = (playerId) => {
    setSelectedPlayerIds(prev => {
      if (prev.includes(playerId)) return prev.filter(id => id !== playerId);
      if (prev.length >= 2) return [playerId];
      return [...prev, playerId];
    });
  };

  const handleForcePair = async () => {
    if (selectedPlayerIds.length !== 2) return;
    setActionError('');
    const result = await addPairOverride(room.id, selectedPlayerIds[0], selectedPlayerIds[1]);
    if (result.error) { setActionError(translateError(result.error)); return; }
    setSelectedPlayerIds([]);
    setPairOverrides(result.pairOverrides);
  };

  const handleRemovePair = async (index) => {
    const result = await removePairOverride(room.id, index);
    if (!result.error) setPairOverrides(result.pairOverrides);
  };

  const handleMakeKiller = async (playerId) => {
    setActionError('');
    const result = await addKillerOverride(room.id, playerId);
    if (result.error) { setActionError(translateError(result.error)); return; }
    setKillerOverridePlayerIds(result.killerOverridePlayerIds);
  };

  const handleRemoveKiller = async (playerId) => {
    const result = await removeKillerOverride(room.id, playerId);
    if (!result.error) setKillerOverridePlayerIds(result.killerOverridePlayerIds);
  };

  const playerName = (id) => room.players.find(p => p.id === id)?.name || '?';

  return createPortal(
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card cyber-card" style={{ maxWidth: '600px', border: '1px solid var(--neon-red)', background: '#111' }} onClick={(e) => e.stopPropagation()}>
        <button onClick={onClose} className="icon-btn modal-close-btn">
          <X size={20} />
        </button>
        <h3 style={{ marginBottom: '20px', color: 'var(--neon-red)' }}>{t('admin.modalTitle')}</h3>

        {actionError && (
          <div className="panel panel--danger" style={{ marginBottom: '20px' }}>
            <p style={{ margin: 0, color: 'white' }}>{actionError}</p>
          </div>
        )}

        {room.status === 'lobby' && (
          <>
            <h4 style={{ color: 'var(--neon-blue)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <Heart size={16} className="icon-inline" />
              {t('admin.pairsTitle')}
            </h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '15px' }}>{t('admin.pairsHint')}</p>

            <div className="couple-list" style={{ marginBottom: '15px' }}>
              {pairOverrides.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('admin.pairsEmpty')}</p>}
              {pairOverrides.map((o, i) => (
                <div key={i} className="list-item">
                  <span style={{ flex: 1, color: 'white' }}>{playerName(o.playerIdA)} &amp; {playerName(o.playerIdB)}</span>
                  <button className="icon-btn" title={t('admin.remove')} onClick={() => handleRemovePair(i)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '10px' }}>{t('admin.selectTwoHint')}</p>
            <div className="couple-list" style={{ marginBottom: '15px' }}>
              {room.players.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('admin.noPlayers')}</p>}
              {room.players.map(p => (
                <div
                  key={p.id}
                  className={`list-item ${selectedPlayerIds.includes(p.id) ? 'list-item--active' : ''}`}
                  onClick={() => togglePlayerSelection(p.id)}
                  style={{ cursor: 'pointer' }}
                >
                  <span style={{ flex: 1, color: 'white' }}>{p.name}</span>
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{p.danceRole}</span>
                </div>
              ))}
            </div>
            <button
              className={selectedPlayerIds.length === 2 ? 'cyber-button' : 'cyber-button disabled'}
              disabled={selectedPlayerIds.length !== 2}
              onClick={handleForcePair}
              style={{ width: '100%', opacity: selectedPlayerIds.length === 2 ? 1 : 0.5 }}
            >
              {t('admin.forcePair')}
            </button>
          </>
        )}

        {room.status === 'paired' && (
          <>
            <h4 style={{ color: 'var(--neon-red)', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '5px' }}>
              <Skull size={16} className="icon-inline" />
              {t('admin.killersTitle')}
            </h4>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '15px' }}>{t('admin.killersHint')}</p>

            <div className="couple-list" style={{ marginBottom: '15px' }}>
              {killerOverridePlayerIds.length === 0 && <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t('admin.killersEmpty')}</p>}
              {killerOverridePlayerIds.map((id, i) => (
                <div key={id} className="list-item">
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginRight: '8px' }}>#{i + 1}</span>
                  <span style={{ flex: 1, color: 'white' }}>{playerName(id)}</span>
                  <button className="icon-btn" title={t('admin.remove')} onClick={() => handleRemoveKiller(id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>

            <div className="couple-list">
              {room.couples.map(c => (
                <div key={c.id} className="list-item">
                  <span style={{ flex: 1, color: 'white' }}>{c.name}</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    {c.playerIds.map(id => (
                      <button
                        key={id}
                        className="cyber-button"
                        disabled={killerOverridePlayerIds.includes(id)}
                        onClick={() => handleMakeKiller(id)}
                        style={{ width: 'auto', padding: '6px 10px', fontSize: '0.8rem', border: '1px solid var(--neon-red)', color: 'var(--neon-red)', background: 'transparent', opacity: killerOverridePlayerIds.includes(id) ? 0.4 : 1 }}
                      >
                        {t('admin.makeKiller', { name: playerName(id) })}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {room.status !== 'lobby' && room.status !== 'paired' && (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center' }}>{t('admin.noControlsForPhase')}</p>
        )}
      </div>
    </div>,
    document.body
  );
}

export default AdminOverridesModal;
