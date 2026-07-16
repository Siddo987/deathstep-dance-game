import React, { useEffect, useState } from 'react';
import { Trophy, Crown, LogIn } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import { fetchLeaderboard } from '../auth.js';

const RANK_COLORS = { 1: '#FFD700', 2: '#C0C0C0', 3: '#CD7F32' };

function RankBadge({ rank }) {
  return (
    <span style={{ width: '24px', textAlign: 'center', fontWeight: 'bold', color: RANK_COLORS[rank] || 'var(--text-muted)' }}>
      {rank}
    </span>
  );
}

function rowStyle(isOwn) {
  return {
    display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 14px',
    background: isOwn ? 'rgba(0,240,255,0.1)' : 'rgba(255,255,255,0.05)',
    border: isOwn ? '1px solid var(--neon-blue)' : '1px solid transparent',
    borderRadius: 'var(--radius-sm)',
  };
}

function PlayerRow({ rank, entry, isOwn, t }) {
  const winRate = entry.gamesPlayed > 0 ? Math.round((entry.wins / entry.gamesPlayed) * 100) : 0;
  return (
    <div style={rowStyle(isOwn)}>
      <RankBadge rank={rank} />
      <span style={{ flex: 1, color: 'var(--text-main)' }}>{entry.displayName}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{t('leaderboard.winsGames', { wins: entry.wins, games: entry.gamesPlayed })}</span>
      <span style={{ color: 'var(--neon-green)', fontSize: '0.85rem', minWidth: '40px', textAlign: 'right' }}>{winRate}%</span>
    </div>
  );
}

function HostRow({ rank, entry, isOwn, t }) {
  return (
    <div style={rowStyle(isOwn)}>
      <RankBadge rank={rank} />
      <span style={{ flex: 1, color: 'var(--text-main)' }}>{entry.displayName}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', whiteSpace: 'nowrap' }}>{t('leaderboard.hostedCount', { count: entry.gamesHosted })}</span>
    </div>
  );
}

function LeaderboardSection({ icon, title, entries, emptyKey, renderRow, currentUser, t }) {
  return (
    <div style={{ marginBottom: '25px' }}>
      <h3 style={{ color: 'var(--text-main)', fontSize: '1rem', marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        {icon}
        {title}
      </h3>
      {entries.length === 0 ? (
        <p style={{ textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.9rem' }}>{t(emptyKey)}</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {entries.map((entry, i) => renderRow({ rank: i + 1, entry, isOwn: currentUser?.id === entry.id, t }))}
        </div>
      )}
    </div>
  );
}

function Leaderboard({ currentUser, onLoginClick }) {
  const { t } = useLanguage();
  const [data, setData] = useState({ players: [], hosts: [] });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchLeaderboard().then((d) => { if (!cancelled) { setData(d || { players: [], hosts: [] }); setLoading(false); } });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="app-container" style={{ padding: '20px' }}>
      <div className="cyber-card" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '10px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          <Trophy size={24} className="icon-inline" />
          {t('leaderboard.pageTitle')}
        </h2>
        <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginBottom: '20px', fontSize: '0.9rem' }}>
          {t('leaderboard.subtitle')}
        </p>

        {loading && <p style={{ textAlign: 'center', color: 'var(--text-muted)' }}>{t('stats.loading')}</p>}

        {!loading && (
          <>
            <LeaderboardSection
              icon={<Trophy size={18} className="icon-inline" style={{ color: 'var(--neon-green)' }} />}
              title={t('leaderboard.playersTitle')}
              entries={data.players}
              emptyKey="leaderboard.empty"
              renderRow={(props) => <PlayerRow key={props.entry.id} {...props} />}
              currentUser={currentUser}
              t={t}
            />
            <LeaderboardSection
              icon={<Crown size={18} className="icon-inline" style={{ color: 'var(--neon-purple)' }} />}
              title={t('leaderboard.hostsTitle')}
              entries={data.hosts}
              emptyKey="leaderboard.emptyHosts"
              renderRow={(props) => <HostRow key={props.entry.id} {...props} />}
              currentUser={currentUser}
              t={t}
            />
          </>
        )}

        <div style={{ marginTop: '10px', textAlign: 'center', fontSize: '0.85rem' }}>
          {!currentUser && (
            <>
              <p style={{ color: 'var(--text-muted)', marginBottom: '10px' }}>{t('leaderboard.joinPromptLoggedOut')}</p>
              <button
                className="cyber-button"
                style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}
                onClick={onLoginClick}
              >
                <LogIn size={16} className="icon-inline" />
                {t('auth.loginOrRegister')}
              </button>
            </>
          )}
          {currentUser && !currentUser.leaderboardOptIn && (
            <p style={{ color: 'var(--text-muted)' }}>
              {t('leaderboard.joinPromptLoggedIn')}{' '}
              <a href="/settings" style={{ color: 'var(--neon-blue)', textDecoration: 'underline' }}>{t('settings.pageLink')}</a>
            </p>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '10px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</a>
        </div>
      </div>
    </div>
  );
}

export default Leaderboard;
