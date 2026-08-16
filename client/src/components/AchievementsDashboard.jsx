import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Award, Lock, LogIn, Users, X } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import { Link } from '../router.jsx';
import { fetchMyAchievements, fetchAchievementPlayers } from '../achievements.js';

const TIER_COLORS = {
  gold: '#ffd700',
  silver: '#c0c0c0',
  bronze: '#cd7f32',
  base: 'var(--neon-blue)',
};

// Next threshold an in-progress achievement is working towards, for the
// progress bar - null once already at the top tier (100+).
const TIER_THRESHOLDS = [1, 10, 50, 100];
function nextThreshold(count) {
  return TIER_THRESHOLDS.find(t => count < t) ?? null;
}

function AchievementCard({ achievement, t, onClick }) {
  const { key, count, tier } = achievement;
  const locked = tier === null;
  const color = locked ? 'var(--text-muted)' : TIER_COLORS[tier];
  const next = nextThreshold(count);

  return (
    <button
      onClick={() => onClick(achievement)}
      disabled={count === 0}
      style={{
        textAlign: 'left', display: 'flex', flexDirection: 'column', gap: '8px',
        padding: '14px', borderRadius: 'var(--radius-sm)',
        border: `1px solid ${locked ? 'rgba(136,146,176,0.3)' : color}`,
        background: locked ? 'rgba(255,255,255,0.03)' : `${color}1a`,
        cursor: count === 0 ? 'default' : 'pointer',
        opacity: locked ? 0.6 : 1,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        {locked ? <Lock size={20} style={{ color, flexShrink: 0 }} /> : <Award size={20} style={{ color, flexShrink: 0 }} />}
        <strong style={{ color: locked ? 'var(--text-muted)' : 'white', flex: 1, minWidth: 0 }}>
          {t(`achievements.${key}Title`)}
        </strong>
        {!locked && (
          <span style={{ fontSize: '0.75rem', textTransform: 'uppercase', fontWeight: 'bold', color, whiteSpace: 'nowrap' }}>
            {tier === 'base' ? t('achievements.tierEarned') : t(`achievements.tier_${tier}`)}
          </span>
        )}
      </div>
      <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.85rem' }}>{t(`achievements.${key}Desc`)}</p>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        <span>{t('achievements.countLabel', { count })}</span>
        {next !== null && <span>{t('achievements.nextTierProgress', { next })}</span>}
      </div>
    </button>
  );
}

function PlayersModal({ achievementKey, onClose, t }) {
  const [players, setPlayers] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAchievementPlayers(achievementKey).then(r => {
      if (cancelled) return;
      if (r.error) setError(true); else setPlayers(r.players);
    });
    return () => { cancelled = true; };
  }, [achievementKey]);

  return createPortal(
    <div className="modal-overlay">
      <div className="modal-card cyber-card" style={{ maxWidth: '450px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px' }}>
          <h3 style={{ color: 'var(--neon-blue)', margin: 0, display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Users size={18} className="icon-inline" /> {t(`achievements.${achievementKey}Title`)}
          </h3>
          <button className="icon-btn" onClick={onClose}><X size={20} /></button>
        </div>

        {players === null && !error && <p style={{ color: 'var(--text-muted)', textAlign: 'center' }}>{t('common.loading')}</p>}
        {error && <p style={{ color: 'var(--neon-red)', textAlign: 'center' }}>{t('achievements.loadError')}</p>}
        {players && players.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontStyle: 'italic', textAlign: 'center' }}>{t('achievements.noPlayersYet')}</p>
        )}
        {players && players.length > 0 && (
          <div className="couple-list">
            {players.map(p => (
              <div key={p.id} className="list-item">
                <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: 'white' }}>{p.displayName}</span>
                <span style={{ fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 'bold', color: p.tier ? TIER_COLORS[p.tier] : 'var(--text-muted)' }}>
                  {p.tier === 'base' ? t('achievements.tierEarned') : t(`achievements.tier_${p.tier}`)}
                </span>
                <span className="badge" style={{ marginLeft: '8px' }}>{p.count}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

function AchievementsDashboard({ currentUser, authLoading, onLoginClick }) {
  const { t } = useLanguage();
  const [achievements, setAchievements] = useState(null);
  const [loadError, setLoadError] = useState(false);
  const [openPlayersFor, setOpenPlayersFor] = useState(null); // achievement key | null

  useEffect(() => {
    if (!currentUser) { setAchievements(null); return; }
    let cancelled = false;
    fetchMyAchievements().then(r => {
      if (cancelled) return;
      if (r.error) setLoadError(true); else setAchievements(r.achievements);
    });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  if (authLoading) {
    return (
      <div className="app-container" style={{ padding: '20px' }}>
        <div className="cyber-card" style={{ maxWidth: '700px', margin: '0 auto', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-muted)' }}>{t('common.loading')}</p>
        </div>
      </div>
    );
  }

  if (!currentUser) {
    return (
      <div className="app-container" style={{ padding: '20px' }}>
        <div className="cyber-card" style={{ maxWidth: '500px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px' }}>{t('achievements.pageTitle')}</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>{t('achievements.loginRequired')}</p>
          <button
            className="cyber-button pulse-animation"
            style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%' }}
            onClick={onLoginClick}
          >
            <LogIn size={20} className="icon-inline" />
            {t('auth.loginOrRegister')}
          </button>
          <Link to="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container" style={{ padding: '20px' }}>
      <div className="cyber-card" style={{ maxWidth: '700px', margin: '0 auto' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '8px', textAlign: 'center' }}>{t('achievements.pageTitle')}</h2>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', fontSize: '0.85rem', marginBottom: '20px' }}>{t('achievements.pageHint')}</p>

        {achievements === null && !loadError && <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{t('common.loading')}</p>}
        {loadError && <p style={{ textAlign: 'center', color: 'var(--neon-red)' }}>{t('achievements.loadError')}</p>}

        {achievements && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '12px' }}>
            {achievements.map(a => (
              <AchievementCard key={a.key} achievement={a} t={t} onClick={(ach) => ach.count > 0 && setOpenPlayersFor(ach.key)} />
            ))}
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <Link to="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</Link>
        </div>
      </div>

      {openPlayersFor && (
        <PlayersModal achievementKey={openPlayersFor} onClose={() => setOpenPlayersFor(null)} t={t} />
      )}
    </div>
  );
}

export default AchievementsDashboard;
