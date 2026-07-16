import React, { useEffect, useState } from 'react';
import { Trophy, Crown, Skull, Sparkles, LogIn } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import { fetchMyStats } from '../auth.js';

function StatRow({ icon, label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)' }}>
        {icon}
        {label}
      </span>
      <strong style={{ color: 'var(--text-main)' }}>{value}</strong>
    </div>
  );
}

function Stats({ currentUser, onLoginClick }) {
  const { t } = useLanguage();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (!currentUser) { setLoading(false); return; }
    let cancelled = false;
    setLoading(true);
    setLoadError(false);
    fetchMyStats().then((s) => {
      if (cancelled) return;
      if (s) setStats(s); else setLoadError(true);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  if (!currentUser) {
    return (
      <div className="app-container" style={{ padding: '20px' }}>
        <div className="cyber-card" style={{ maxWidth: '500px', margin: '0 auto', textAlign: 'center' }}>
          <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px' }}>{t('stats.pageTitle')}</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>{t('stats.loginRequired')}</p>
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

  return (
    <div className="app-container" style={{ padding: '20px' }}>
      <div className="cyber-card" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px', textAlign: 'center' }}>{t('stats.pageTitle')}</h2>

        {loading && <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{t('stats.loading')}</p>}

        {!loading && loadError && (
          <p style={{ textAlign: 'center', color: 'var(--neon-red)' }}>{t('stats.loadError')}</p>
        )}

        {!loading && stats && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <StatRow icon={<Trophy size={18} className="icon-inline" />} label={t('stats.totalGames')} value={stats.gamesPlayed} />
            <StatRow icon={<Trophy size={18} className="icon-inline" style={{ color: 'var(--neon-green)' }} />} label={t('stats.totalWins')} value={stats.wins} />
            <StatRow icon={<Skull size={18} className="icon-inline" style={{ color: 'var(--neon-red)' }} />} label={t('stats.killerRounds')} value={t('stats.roundsWithWins', { games: stats.killerGames, wins: stats.killerWins })} />
            <StatRow icon={<Sparkles size={18} className="icon-inline" style={{ color: 'var(--neon-blue)' }} />} label={t('stats.dancerRounds')} value={t('stats.roundsWithWins', { games: stats.dancerGames, wins: stats.dancerWins })} />
            <StatRow icon={<Crown size={18} className="icon-inline" style={{ color: 'var(--neon-purple)' }} />} label={t('stats.gamesHosted')} value={stats.gamesHosted} />
          </div>
        )}

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</a>
        </div>
      </div>
    </div>
  );
}

export default Stats;
