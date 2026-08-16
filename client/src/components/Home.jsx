import React, { useEffect, useState } from 'react';
import { Users, Crown, LogIn, LogOut, Repeat, ArrowLeft, Globe, UserCircle2, Trophy, BarChart3, Settings as SettingsIcon, Music2, Wrench, Award, HelpCircle } from 'lucide-react';
import { openCookieSettings } from './CookieBanner.jsx';
import { fetchMyStats } from '../auth.js';
import { fetchUnreadFeedbackCount } from '../admin.js';
import { useLanguage, SUPPORTED_LANGS } from '../i18n.jsx';
import { HowToPlayModal } from './Modal.jsx';
import { Link } from '../router.jsx';

// "Wie funktioniert's?" trigger - a plain underlined text link (not a
// cyber-button) so it reads as secondary to the actual join/create actions,
// consistent with the other small text links already on the home screen
// (feedback/privacy/imprint). Shared between the main screen and the join
// view below, since a player who scanned a QR code lands directly on the
// join view and never sees the main screen at all.
// iconOnly drops the text label down to a bare "?" icon button - used where
// this sits in a corner next to a heading (the join view below) instead of
// its own centered line (the main screen), where the full label would either
// crowd the heading or force it to wrap on a phone-width screen.
function HowToPlayLink({ onClick, iconOnly = false }) {
  const { t } = useLanguage();
  return (
    <button
      onClick={onClick}
      title={iconOnly ? t('howto.linkLabel') : undefined}
      style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--neon-blue)', fontSize: '0.85rem', textDecoration: iconOnly ? 'none' : 'underline', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px', margin: iconOnly ? 0 : '0 auto', flexShrink: 0 }}
    >
      <HelpCircle size={iconOnly ? 22 : 14} className="icon-inline" />
      {!iconOnly && t('howto.linkLabel')}
    </button>
  );
}

function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();

  const langButton = (code, label) => (
    <button
      key={code}
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
    <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '8px', rowGap: '6px', marginBottom: '20px' }}>
      <Globe size={16} className="icon-inline" style={{ color: 'var(--text-muted)' }} />
      {SUPPORTED_LANGS.map(code => langButton(code, code.toUpperCase()))}
    </div>
  );
}

function AccountBar({ currentUser, authLoading, onLoginClick, onLogout }) {
  const { t } = useLanguage();
  const [stats, setStats] = useState(null);
  const [unreadFeedback, setUnreadFeedback] = useState(0);

  useEffect(() => {
    if (!currentUser) { setStats(null); return; }
    let cancelled = false;
    fetchMyStats().then((s) => { if (!cancelled) setStats(s); });
    return () => { cancelled = true; };
  }, [currentUser?.id]);

  // Hidden Dev Dashboard entry point (see components/DevDashboard.jsx) only
  // ever renders for a currentUser.isSuperAdmin account - the unread count
  // is what turns it from a plain link into a "there's something to look at"
  // notification, checked once on every home-screen visit.
  useEffect(() => {
    if (!currentUser?.isSuperAdmin) { setUnreadFeedback(0); return; }
    let cancelled = false;
    fetchUnreadFeedbackCount().then((r) => { if (!cancelled && !r.error) setUnreadFeedback(r.count); });
    return () => { cancelled = true; };
  }, [currentUser?.isSuperAdmin]);

  // fetchMe() is still in flight - stay blank rather than flashing "Login /
  // Register" at an already-logged-in visitor for a moment.
  if (authLoading) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px', marginBottom: '15px' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', alignItems: 'center', gap: '8px 10px', fontSize: '0.85rem' }}>
        <UserCircle2 size={16} className="icon-inline" style={{ color: 'var(--text-muted)' }} />
        {currentUser ? (
          <>
            <span style={{ color: 'var(--text-main)' }}>{t('auth.greeting', { name: currentUser.displayName })}</span>
            <button
              onClick={onLogout}
              style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
            >
              <LogOut size={14} className="icon-inline" />
              {t('auth.logout')}
            </button>
          </>
        ) : (
          <button
            onClick={onLoginClick}
            style={{ background: 'transparent', border: 'none', color: 'var(--neon-blue)', textDecoration: 'underline', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}
          >
            <LogIn size={14} className="icon-inline" />
            {t('auth.loginOrRegister')}
          </button>
        )}
      </div>

      {currentUser && stats && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px 16px', color: 'var(--text-muted)', fontSize: '0.8rem' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
            <Trophy size={14} className="icon-inline" />
            {t('stats.winsSummary', { wins: stats.wins, games: stats.gamesPlayed })}
          </span>
          {stats.gamesHosted > 0 && (
            <span style={{ display: 'flex', alignItems: 'center', gap: '4px', whiteSpace: 'nowrap' }}>
              <Crown size={14} className="icon-inline" />
              {t('stats.hostedSummary', { count: stats.gamesHosted })}
            </span>
          )}
        </div>
      )}

      {currentUser && (
        <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: '6px' }}>
          <Link to="/stats" className="nav-pill">
            <BarChart3 size={14} className="icon-inline" />
            {t('stats.pageLink')}
          </Link>
          <Link to="/settings" className="nav-pill">
            <SettingsIcon size={14} className="icon-inline" />
            {t('settings.pageLink')}
          </Link>
          <Link to="/playlists" className="nav-pill">
            <Music2 size={14} className="icon-inline" />
            {t('playlists.pageLink')}
          </Link>
          <Link to="/achievements" className="nav-pill">
            <Award size={14} className="icon-inline" />
            {t('achievements.pageLink')}
          </Link>
          {currentUser.isSuperAdmin && (
            <Link
              to="/dev"
              className="nav-pill"
              style={unreadFeedback > 0 ? { color: 'var(--neon-red)', borderColor: 'var(--neon-red)', fontWeight: 'bold' } : undefined}
            >
              <Wrench size={14} className="icon-inline" />
              {t('dev.pageLink')}{unreadFeedback > 0 ? ` (${unreadFeedback})` : ''}
            </Link>
          )}
        </div>
      )}
    </div>
  );
}

function Home({ onCreateRoom, onJoinRoom, currentUser, authLoading, onLoginClick, onLogout, hasActiveGame, onRejoinGame }) {
  const { t } = useLanguage();
  const [roomId, setRoomId] = useState('');
  const [playerName, setPlayerName] = useState('');
  const [danceRole, setDanceRole] = useState('lead'); // 'lead' or 'follow'
  const [isFlexible, setIsFlexible] = useState(false);
  const [view, setView] = useState('main'); // main, join
  const [showHowTo, setShowHowTo] = useState(false);

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
        <AccountBar currentUser={currentUser} authLoading={authLoading} onLoginClick={onLoginClick} onLogout={onLogout} />
        <LanguageSwitcher />
        <h2 style={{ marginBottom: '8px', color: 'var(--neon-blue)' }}>{t('home.title')}</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '15px', fontSize: '0.95rem' }}>
          {t('home.subtitle')}
        </p>
        <div style={{ marginBottom: '25px' }}>
          <HowToPlayLink onClick={() => setShowHowTo(true)} />
        </div>

        {hasActiveGame && (
          <div style={{ margin: '0 0 25px 0' }}>
            <button
              className="cyber-button pulse-animation"
              style={{ background: 'var(--neon-green)', borderColor: 'var(--neon-green)', color: 'black', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}
              onClick={onRejoinGame}
            >
              <Repeat size={20} className="icon-inline" />
              {t('home.rejoinGame')}
            </button>
          </div>
        )}

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
          <Link
            to="/leaderboard"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            {t('leaderboard.pageLink')}
          </Link>
          <Link
            to="/roadmap"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            {t('roadmap.pageLink')}
          </Link>
          <Link
            to="/feedback"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            {t('home.feedbackLink')}
          </Link>
          <Link
            to="/datenschutz"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            {t('home.privacyLink')}
          </Link>
          <Link
            to="/impressum"
            style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', whiteSpace: 'nowrap' }}
          >
            {t('home.imprintLink')}
          </Link>
          <button
            onClick={openCookieSettings}
            style={{ background: 'transparent', border: 'none', padding: 0, color: 'var(--text-muted)', fontSize: '0.85rem', textDecoration: 'underline', cursor: 'pointer', whiteSpace: 'nowrap' }}
          >
            {t('home.cookieSettings')}
          </button>
        </div>

        <HowToPlayModal isOpen={showHowTo} onClose={() => setShowHowTo(false)} />
      </div>
    );
  }

  return (
    <div className="cyber-card phase-enter">
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '10px', marginBottom: '20px' }}>
        <h2 style={{ margin: 0, color: 'var(--neon-purple)', display: 'flex', alignItems: 'center', gap: '10px' }}>
          <Users size={26} className="icon-inline" />
          {t('home.joinTitle')}
        </h2>
        <HowToPlayLink onClick={() => setShowHowTo(true)} iconOnly />
      </div>

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

      <div className="segmented-control" style={{ margin: '15px 0 18px 0' }}>
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

      <HowToPlayModal isOpen={showHowTo} onClose={() => setShowHowTo(false)} />
    </div>
  );
}

export default Home;
