import React, { useEffect, useState } from 'react';
import { LogIn, Repeat, Save, Trophy, Music2, Trash2, AlertTriangle } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import { updateSettings, deleteAccount } from '../auth.js';

function Settings({ currentUser, authLoading, onUserUpdated, onLoginClick }) {
  const { t } = useLanguage();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [defaultDanceRole, setDefaultDanceRole] = useState(null); // 'lead' | 'follow' | null
  const [defaultIsFlexible, setDefaultIsFlexible] = useState(false);
  const [leaderboardOptIn, setLeaderboardOptIn] = useState(false);
  const [autoShareSpotify, setAutoShareSpotify] = useState(false);
  const [statusKey, setStatusKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  // Account deletion (see server/auth.js's DELETE /me) - two-step on purpose:
  // the button only arms the confirmation panel, nothing is sent until the
  // second, explicitly-labelled click in that panel.
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');
  const [deleteErrorKey, setDeleteErrorKey] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    setDisplayName(currentUser.displayName || '');
    setEmail(currentUser.email || '');
    setDefaultDanceRole(currentUser.defaultDanceRole ?? null);
    setDefaultIsFlexible(!!currentUser.defaultIsFlexible);
    setLeaderboardOptIn(!!currentUser.leaderboardOptIn);
    setAutoShareSpotify(!!currentUser.autoShareSpotify);
  }, [currentUser?.id]);

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
          <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px' }}>{t('settings.pageTitle')}</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: '20px' }}>{t('settings.loginRequired')}</p>
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatusKey('');
    setIsSaving(true);
    const result = await updateSettings({ displayName, email, defaultDanceRole, defaultIsFlexible, leaderboardOptIn, autoShareSpotify });
    setIsSaving(false);
    if (result.error) {
      setStatusKey(`auth.error.${result.error}`);
      return;
    }
    onUserUpdated(result.user);
    setStatusKey('settings.saved');
  };

  const handleDeleteAccount = async () => {
    setDeleteErrorKey('');
    setIsDeleting(true);
    const result = await deleteAccount(deletePassword);
    if (result.error) {
      setIsDeleting(false);
      setDeleteErrorKey(`auth.error.${result.error}`);
      return;
    }
    // The login cookie is already cleared by the response - a full navigation
    // (rather than just clearing currentUser in React state) is the simplest
    // way to guarantee nothing anywhere in the app is still holding the
    // deleted account's data, including a socket that authenticated as it.
    window.location.href = '/';
  };

  return (
    <div className="app-container" style={{ padding: '20px' }}>
      <div className="cyber-card" style={{ maxWidth: '500px', margin: '0 auto' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px', textAlign: 'center' }}>{t('settings.pageTitle')}</h2>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label style={{ color: 'var(--text-muted)' }}>{t('settings.displayNameLabel')}</label>
            <input
              type="text"
              className="cyber-input"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
          </div>

          <div>
            <label style={{ color: 'var(--text-muted)' }}>{t('settings.emailLabel')}</label>
            <input
              type="email"
              className="cyber-input"
              placeholder={t('auth.emailOptionalPlaceholder')}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginTop: '4px' }}>{t('settings.emailHint')}</p>
          </div>

          {currentUser.username && (
            <div>
              <label style={{ color: 'var(--text-muted)' }}>{t('settings.usernameLabel')}</label>
              <input type="text" className="cyber-input" value={currentUser.username} disabled />
            </div>
          )}

          <div>
            <label style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '5px' }}>{t('settings.defaultRoleLabel')}</label>
            <div className="segmented-control">
              <button
                type="button"
                className={`segmented-option accent-blue ${defaultDanceRole === 'lead' ? 'is-active' : ''}`}
                onClick={() => setDefaultDanceRole('lead')}
              >
                {t('home.iAmLead')}
              </button>
              <button
                type="button"
                className={`segmented-option accent-purple ${defaultDanceRole === 'follow' ? 'is-active' : ''}`}
                onClick={() => setDefaultDanceRole('follow')}
              >
                {t('home.iAmFollow')}
              </button>
            </div>
          </div>

          <label className="check-row" style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)' }}>
            <input
              type="checkbox"
              checked={defaultIsFlexible}
              onChange={(e) => setDefaultIsFlexible(e.target.checked)}
            />
            <Repeat size={16} className="icon-inline" style={{ color: 'var(--text-muted)' }} />
            <span style={{ color: 'white', fontSize: '0.9rem' }}>{t('home.flexible')}</span>
          </label>

          <label className="check-row" style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)' }}>
            <input
              type="checkbox"
              checked={leaderboardOptIn}
              onChange={(e) => setLeaderboardOptIn(e.target.checked)}
            />
            <Trophy size={16} className="icon-inline" style={{ color: 'var(--text-muted)' }} />
            <span style={{ color: 'white', fontSize: '0.9rem' }}>{t('settings.leaderboardOptIn')}</span>
          </label>

          <label className="check-row" style={{ padding: '10px', background: 'rgba(255,255,255,0.05)', borderRadius: 'var(--radius-sm)' }}>
            <input
              type="checkbox"
              checked={autoShareSpotify}
              onChange={(e) => setAutoShareSpotify(e.target.checked)}
            />
            <Music2 size={16} className="icon-inline" style={{ color: 'var(--text-muted)' }} />
            <span style={{ color: 'white', fontSize: '0.9rem' }}>{t('settings.autoShareSpotify')}</span>
          </label>

          <button type="submit" className="cyber-button pulse-animation" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }} disabled={isSaving}>
            <Save size={18} className="icon-inline" />
            {t('settings.save')}
          </button>
        </form>

        {statusKey && (
          <p style={{ marginTop: '15px', textAlign: 'center', color: statusKey === 'settings.saved' ? 'var(--neon-green)' : 'var(--neon-red)' }}>
            {t(statusKey)}
          </p>
        )}

        {/* Danger zone - visually separated and last on the page so it can't
            be mistaken for part of the normal save flow above. */}
        <div style={{ marginTop: '30px', paddingTop: '20px', borderTop: '1px solid rgba(255,42,85,0.35)' }}>
          {!showDeleteConfirm ? (
            <button
              type="button"
              className="cyber-button danger"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', background: 'transparent', border: '1px solid var(--neon-red)', color: 'var(--neon-red)' }}
              onClick={() => { setShowDeleteConfirm(true); setDeleteErrorKey(''); }}
            >
              <Trash2 size={18} className="icon-inline" />
              {t('settings.deleteAccount')}
            </button>
          ) : (
            <div className="panel panel--danger" style={{ border: '1px solid var(--neon-red)' }}>
              <h4 style={{ color: 'var(--neon-red)', margin: '0 0 8px 0', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <AlertTriangle size={18} className="icon-inline" /> {t('settings.deleteAccount')}
              </h4>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '12px' }}>
                {t('settings.deleteAccountWarning')}
              </p>
              {currentUser.hasPassword && (
                <input
                  type="password"
                  className="cyber-input"
                  placeholder={t('settings.deleteAccountPasswordPlaceholder')}
                  value={deletePassword}
                  onChange={(e) => setDeletePassword(e.target.value)}
                  autoComplete="current-password"
                />
              )}
              <div className="btn-row">
                <button
                  type="button"
                  className="cyber-button danger"
                  style={{ flex: 1 }}
                  disabled={isDeleting || (currentUser.hasPassword && !deletePassword)}
                  onClick={handleDeleteAccount}
                >
                  {t('settings.deleteAccountConfirm')}
                </button>
                <button
                  type="button"
                  className="cyber-button"
                  style={{ flex: 1, background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }}
                  disabled={isDeleting}
                  onClick={() => { setShowDeleteConfirm(false); setDeletePassword(''); setDeleteErrorKey(''); }}
                >
                  {t('common.cancel')}
                </button>
              </div>
              {deleteErrorKey && (
                <p style={{ color: 'var(--neon-red)', textAlign: 'center', marginTop: '10px', fontSize: '0.9rem' }}>{t(deleteErrorKey)}</p>
              )}
            </div>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</a>
        </div>
      </div>
    </div>
  );
}

export default Settings;
