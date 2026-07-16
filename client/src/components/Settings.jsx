import React, { useEffect, useState } from 'react';
import { LogIn, Repeat, Save, Trophy } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import { updateSettings } from '../auth.js';

function Settings({ currentUser, onUserUpdated, onLoginClick }) {
  const { t } = useLanguage();
  const [displayName, setDisplayName] = useState('');
  const [defaultDanceRole, setDefaultDanceRole] = useState(null); // 'lead' | 'follow' | null
  const [defaultIsFlexible, setDefaultIsFlexible] = useState(false);
  const [leaderboardOptIn, setLeaderboardOptIn] = useState(false);
  const [statusKey, setStatusKey] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!currentUser) return;
    setDisplayName(currentUser.displayName || '');
    setDefaultDanceRole(currentUser.defaultDanceRole ?? null);
    setDefaultIsFlexible(!!currentUser.defaultIsFlexible);
    setLeaderboardOptIn(!!currentUser.leaderboardOptIn);
  }, [currentUser?.id]);

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
    const result = await updateSettings({ displayName, defaultDanceRole, defaultIsFlexible, leaderboardOptIn });
    setIsSaving(false);
    if (result.error) {
      setStatusKey(`auth.error.${result.error}`);
      return;
    }
    onUserUpdated(result.user);
    setStatusKey('settings.saved');
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

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</a>
        </div>
      </div>
    </div>
  );
}

export default Settings;
