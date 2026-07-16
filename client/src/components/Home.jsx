import React, { useEffect, useState } from 'react';
import { Users, Crown, LogIn, LogOut, Repeat, ArrowLeft, Globe, UserCircle2, Trophy, BarChart3, Settings as SettingsIcon, Music2 } from 'lucide-react';
import { openCookieSettings } from './CookieBanner.jsx';
import { fetchMyStats } from '../auth.js';
import { useLanguage } from '../i18n.jsx';

function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();

  const langButton = (code, label) => (
    <button
      onClick={() => setLang(code)}
      style={{
        background: lang === code ? 'rgba(0,240,255,0.12)' : 'transparent',
        border: lang === code ? '1px solid var(--neon-blue)' : '1px solid rgba(136,146,176,0.4)',
        color: lang === code ? 'var(--neon-blue)' : 'var(--text-muted)',
        padding: '5px 12px',
        borderRadius: '4px',
        cursor: 'pointer',
        fontSize: '0.8rem',
        letterSpacing: '1px',
        fontWeight: lang === code ? 'bold' : 'normal',
      }}
    >
      {label}
    </button>
  );

  return (
    <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px', marginBottom: '20px' }}>
      <Globe size={16} className="icon-inline" style={{ color: 'var(--text-muted)' }} />
      {langButton('en', 'EN')}
      {langButton('de', 'DE')}
    </div>
  );
}

function AccountBar({ currentUser, onLoginClick, onLogout }) {
  const { t } = useLanguage();
  const [stats, setStats] = useState(null);

  useEffect(() => {
    if (!currentUser) { setStats(null); return; }
    let cancelled = false;
    fetchMyStats().then((s) => { if (!cancelled) setStats(s); });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', marginBottom: '15px' }}>
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '10px', fontSize: '0.85rem' }}>
        <UserCircle2 size={16} className="icon-inline" style={{ color: 'var(--text-muted)' }} />
        {currentUser ? (
          <>
            <span style={{ color: 'var(--text-main)' }}>{t('auth.greeting', { name: currentUser.displayName })}</span>
            <button
              onClick={onLogout}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
            >
              <LogOut size={14} className="icon-inline" />
              {t('auth.logout')}
            </button>
          </>
        ) : (
          <button
            onClick={onLoginClick}
            style={{ background: 'transparent', border: 'none', color: 'var(--neon-blue)', textDecoration: 'underline', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
          >
            <LogIn size={14} className="icon-inline" />
            {t('auth.loginOrRegister')}
          </button>
        )}
      </div>

      {currentUser && stats && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Trophy size={14} className="icon-inline" />
            {t('stats.winsSummary', { wins: stats.wins, games: stats.gamesPlayed })}
          </span>
          {stats.gamesHosted > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Crown size={14} className="icon-inline" />
              {t('stats.hostedSummary', { count: stats.gamesHosted })}
            </span>
          )}
        </div>
      )}

      {currentUser && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '15px', fontSize: '0.8rem' }}>
          <a href="/stats" style={{ color: 'var(--text-muted)', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <BarChart3 size={14} className="icon-inline" />
            {t('stats.pageLink')}
          </a>
          <a href="/settings" style={{ color: 'var(--text-muted)', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <SettingsIcon size={14} className="icon-inline" />
            {t('settings.pageLink')}
          </a>
          <a href="/playlists" style={{ color: 'var(--text-muted)', textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: '4px' }}>
            <Music2 size={14} className="icon-inline" />
            {t('playlists.pageLink')}
          </a>
        </div>
      )}
    </div>
  );
}

function Home({ onCreateRoom, onJoinRoom, currentUser, onLoginClick, onLogout }) {
  const { t } = useLanguage();
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [danceRole, setDanceRole] = useState('lead'); // 'lead' or 'follow'
  const [isFlexible, setIsFlexible] = useState(false);
  const [view, setView] = useState('main'); // main, join

  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const roomParam = params.get('room');
    if (roomParam) {
      setRoomId(roomParam);
      setView('join');
    }
  }, []);

  // Pre-fill the join form from the logged-in account's saved defaults
  // (Settings page) - only fills in the name if it's still empty, so it
  // never overwrites something the player already typed.
  React.useEffect(() => {
    if (!currentUser) return;
    if (currentUser.defaultDanceRole) setDanceRole(currentUser.defaultDanceRole);
    setIsFlexible(!!currentUser.defaultIsFlexible);
    setPlayerName((prev) => prev || currentUser.displayName || '');
  }, [currentUser?.id]);

  if (view === 'main') {
    return (
      <div className="cyber-card phase-enter" style={{ textAlign: 'center' }}>
        <AccountBar currentUser={currentUser} onLoginClick={onLoginClick} onLogout={onLogout} />
        <LanguageSwitcher />
        <h2 style={{ marginBottom: '8px', color: 'var(--neon-blue)' }}>{t('home.title')}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '30px', fontSize: '0.95rem' }}>
          {t('home.subtitle')}
        </p>

        <button
          className="cyber-button pulse-animation"
          style={{ marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
          onClick={() => setView('join')}
        >
          <LogIn size={20} className="icon-inline" />
          {t('home.join')}
        </button>

        <div style={{ margin: '30px 0', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ flex: 1, height: '1px', background: 'rgba(136,146,176,0.25)' }} />
          {t('home.or')}
          <span style={{ flex: 1, height: '1px', background: 'rgba(136,146,176,0.25)' }} />
        </div>

        <button
          className="cyber-button"
          style={{ background: 'transparent', border: '1px solid var(--neon-purple)', color: 'var(--neon-purple)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
          onClick={onCreateRoom}
        >
          <Crown size={20} className="icon-inline" />
          {t('home.create')}
        </button>

        <div style={{ marginTop: '30px', display: 'flex', flexWrap: 'wrap', gap: '8px 15px', justifyContent: 'center' }}>
          <a
            href="/leaderboard"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            {t('leaderboard.pageLink')}
          </a>
          <a
            href="/feedback"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            {t('home.feedbackLink')}
          </a>
          <a
            href="/datenschutz"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            {t('home.privacyLink')}
          </a>
          <a
            href="/impressum"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            {t('home.imprintLink')}
          </a>
          <button
            onClick={openCookieSettings}
            style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {t('home.cookieSettings')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="cyber-card phase-enter">
      <h2 style={{ marginBottom: '20px', color: 'var(--neon-purple)', display: 'flex', alignItems: 'center', gap: '10px' }}>
        <Users size={26} className="icon-inline" />
        {t('home.joinTitle')}
      </h2>

      <input
        type="text"
        className="cyber-input"
        placeholder={t('home.codePlaceholder')}
        value={roomId}
        onChange={(e) => setRoomId(e.target.value)}
        maxLength={4}
      />

      <input
        type="text"
        className="cyber-input"
        placeholder={t('home.namePlaceholder')}
        value={playerName}
        onChange={(e) => setPlayerName(e.target.value)}
      />

      <div className="segmented-control" style={{ margin: '15px 0 5px 0' }}>
        <button
          className={`segmented-option accent-blue ${danceRole === 'lead' ? 'is-active' : ''}`}
          onClick={() => setDanceRole('lead')}
        >
          {t('home.iAmLead')}
        </button>
        <button
          className={`segmented-option accent-purple ${danceRole === 'follow' ? 'is-active' : ''}`}
          onClick={() => setDanceRole('follow')}
        >
          {t('home.iAmFollow')}
        </button>
      </div>

      <label className="check-row" style={{ marginBottom: '20px', padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)' }}>
        <input
          type="checkbox"
          checked={isFlexible}
          onChange={(e) => setIsFlexible(e.target.checked)}
        />
        <Repeat size={16} className="icon-inline" style={{ color: 'var(--text-muted)' }} />
        <span style={{ color: 'white', fontSize: '0.9rem' }}>
          {t('home.flexible')}
        </span>
      </label>

      <button
        className="cyber-button pulse-animation"
        style={{ marginTop: '10px', marginBottom: '10px', width: '100%' }}
        onClick={() => onJoinRoom(roomId, playerName, danceRole, isFlexible)}
        disabled={!roomId || !playerName}
      >
        {t('home.connect')}
      </button>

      <button
        className="cyber-button"
        style={{ background: 'transparent', color: 'var(--text-muted)', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}
        onClick={() => setView('main')}
      >
        <ArrowLeft size={18} className="icon-inline" />
        {t('common.back')}
      </button>
    </div>
  );
}

export default Home;
