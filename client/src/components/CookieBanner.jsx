import React, { useState, useEffect } from 'react';
import { useLanguage } from '../i18n.jsx';

const CONSENT_KEY = 'deathstep_cookie_consent';
const REOPEN_EVENT = 'deathstep-open-cookie-settings';

export function getCookieConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

export function openCookieSettings() {
  window.dispatchEvent(new Event(REOPEN_EVENT));
}

function saveConsent(consent) {
  localStorage.setItem(CONSENT_KEY, JSON.stringify({ ...consent, timestamp: Date.now() }));
}

function CookieBanner() {
  const { t } = useLanguage();
  const [consent, setConsent] = useState(() => getCookieConsent());
  const [forceOpen, setForceOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [spotifyChecked, setSpotifyChecked] = useState(() => getCookieConsent()?.spotify ?? true);

  useEffect(() => {
    const handleReopen = () => {
      setSpotifyChecked(getCookieConsent()?.spotify ?? true);
      setShowDetails(true);
      setForceOpen(true);
    };
    window.addEventListener(REOPEN_EVENT, handleReopen);
    return () => window.removeEventListener(REOPEN_EVENT, handleReopen);
  }, []);

  if (consent && !forceOpen) return null;

  const acceptAll = () => {
    saveConsent({ necessary: true, spotify: true });
    setConsent(getCookieConsent());
    setForceOpen(false);
  };

  const acceptNecessaryOnly = () => {
    saveConsent({ necessary: true, spotify: false });
    setConsent(getCookieConsent());
    setForceOpen(false);
  };

  const saveSelection = () => {
    saveConsent({ necessary: true, spotify: spotifyChecked });
    setConsent(getCookieConsent());
    setForceOpen(false);
  };

  const cancelReopen = () => {
    setForceOpen(false);
    setShowDetails(false);
  };

  return (
    <div className="cookie-banner">
      <div className="cookie-banner-inner">
        {consent && forceOpen && (
          <button
            onClick={cancelReopen}
            title={t('common.close')}
            style={{ position: 'absolute', top: 0, right: 0, background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: '1.3rem', cursor: 'pointer', lineHeight: 1 }}
          >
            ✖
          </button>
        )}

        <p className="cookie-banner-text" style={{ paddingRight: consent && forceOpen ? '26px' : 0 }}>
          {t('cookie.textBefore')}
          <a href="/datenschutz" style={{ color: 'var(--neon-blue)' }}>{t('cookie.privacyPolicy')}</a>
          {t('cookie.textAfter')}
        </p>

        {showDetails && (
          <div style={{ marginBottom: '12px', padding: '10px 12px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px' }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-muted)', marginBottom: '8px', opacity: 0.7, fontSize: '0.85rem' }}>
              <input type="checkbox" checked disabled style={{ transform: 'scale(1.1)', flexShrink: 0 }} />
              {t('cookie.necessary')}
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: '10px', color: 'var(--text-main)', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input
                type="checkbox"
                checked={spotifyChecked}
                onChange={(e) => setSpotifyChecked(e.target.checked)}
                style={{ transform: 'scale(1.1)', flexShrink: 0 }}
              />
              {t('cookie.spotify')}
            </label>
          </div>
        )}

        <div className="cookie-banner-actions">
          <button className="cyber-button pulse-animation" onClick={acceptAll}>
            {t('cookie.acceptAll')}
          </button>
          <button className="cyber-button" style={{ background: 'transparent' }} onClick={acceptNecessaryOnly}>
            {t('cookie.acceptNecessary')}
          </button>
          {!showDetails ? (
            <button
              className="cyber-button"
              style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }}
              onClick={() => setShowDetails(true)}
            >
              {t('cookie.settings')}
            </button>
          ) : (
            <button
              className="cyber-button"
              style={{ background: 'transparent', border: '1px solid var(--text-muted)', color: 'var(--text-muted)' }}
              onClick={saveSelection}
            >
              {t('cookie.saveSelection')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default CookieBanner;
