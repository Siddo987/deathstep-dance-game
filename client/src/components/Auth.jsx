import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, LogIn, UserPlus, KeyRound } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import { login, register, loginWithGoogle, forgotPassword } from '../auth.js';

const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const GOOGLE_SCRIPT_SRC = 'https://accounts.google.com/gsi/client';

let googleScriptPromise = null;
function loadGoogleScript() {
  if (googleScriptPromise) return googleScriptPromise;
  googleScriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.id) return resolve();
    const script = document.createElement('script');
    script.src = GOOGLE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return googleScriptPromise;
}

// "Login with Google" only ever appears when the app was built with a
// VITE_GOOGLE_CLIENT_ID - without it this quietly renders nothing instead of
// showing a broken button (the Google Cloud project may not exist yet).
function GoogleButton({ onCredential }) {
  const buttonRef = useRef(null);
  // onCredential is a fresh closure on every AuthModal render (e.g. every
  // keystroke) - read it via a ref instead of depending on it directly, so
  // the effect below only ever runs once per mount instead of re-running
  // google.accounts.id.initialize() (and triggering its "called multiple
  // times" warning) on every re-render.
  const onCredentialRef = useRef(onCredential);
  onCredentialRef.current = onCredential;

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    let cancelled = false;
    loadGoogleScript().then(() => {
      if (cancelled || !buttonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: (response) => onCredentialRef.current(response.credential),
      });
      window.google.accounts.id.renderButton(buttonRef.current, {
        theme: 'filled_black',
        size: 'large',
        width: 280,
      });
    }).catch(() => { /* Google script blocked/unreachable - button just stays empty */ });
    return () => { cancelled = true; };
  }, []);

  if (!GOOGLE_CLIENT_ID) return null;
  return <div ref={buttonRef} style={{ display: 'flex', justifyContent: 'center', margin: '15px 0' }} />;
}

export function AuthModal({ isOpen, onClose, onAuthenticated }) {
  const { t } = useLanguage();
  const [mode, setMode] = useState('login'); // 'login' | 'register' | 'forgot'
  const [identifier, setIdentifier] = useState(''); // login: email or username
  const [email, setEmail] = useState(''); // register: optional
  const [username, setUsername] = useState(''); // register: required login handle
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [forgotIdentifier, setForgotIdentifier] = useState('');
  const [forgotSent, setForgotSent] = useState(false);
  const [errorKey, setErrorKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const resetAndClose = () => {
    setIdentifier('');
    setEmail('');
    setUsername('');
    setPassword('');
    setDisplayName('');
    setForgotIdentifier('');
    setForgotSent(false);
    setErrorKey('');
    setMode('login');
    setIsSubmitting(false);
    onClose();
  };

  const handleResult = (result) => {
    if (result.error) {
      setErrorKey(`auth.error.${result.error}`);
      setIsSubmitting(false);
      return;
    }
    onAuthenticated(result.user);
    resetAndClose();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorKey('');
    setIsSubmitting(true);
    try {
      const result = mode === 'login'
        ? await login(identifier, password)
        : await register(email, username, password, displayName, localStorage.getItem('deathstep_ref_code'));
      if (!result.error) localStorage.removeItem('deathstep_ref_code');
      handleResult(result);
    } catch (err) {
      setErrorKey('auth.error.unknown_error');
      setIsSubmitting(false);
    }
  };

  // Always resolves to success - the server deliberately never reveals
  // whether forgotIdentifier matched an account (see server/auth.js's
  // /forgot-password), so this only ever shows the same generic
  // "check your inbox" state, never an error tied to a specific account.
  const handleForgotSubmit = async (e) => {
    e.preventDefault();
    setErrorKey('');
    setIsSubmitting(true);
    try {
      await forgotPassword(forgotIdentifier);
    } catch (err) {
      // Even a network hiccup shouldn't leak anything - just show the same
      // generic confirmation as a real success.
    }
    setIsSubmitting(false);
    setForgotSent(true);
  };

  const handleGoogleCredential = async (credential) => {
    setErrorKey('');
    setIsGoogleSubmitting(true);
    try {
      const result = await loginWithGoogle(credential, localStorage.getItem('deathstep_ref_code'));
      if (!result.error) localStorage.removeItem('deathstep_ref_code');
      handleResult(result);
    } catch (err) {
      setErrorKey('auth.error.unknown_error');
    } finally {
      setIsGoogleSubmitting(false);
    }
  };

  return createPortal(
    <div className="modal-overlay" onClick={resetAndClose}>
      <div
        className="modal-card cyber-card"
        style={{ maxWidth: '400px', border: '1px solid var(--neon-blue)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="icon-btn modal-close-btn" onClick={resetAndClose}>
          <X size={20} />
        </button>

        <h3 style={{ color: 'var(--neon-blue)', marginBottom: '20px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          {mode === 'login' && <LogIn size={22} />}
          {mode === 'register' && <UserPlus size={22} />}
          {mode === 'forgot' && <KeyRound size={22} />}
          {mode === 'login' && t('auth.loginTitle')}
          {mode === 'register' && t('auth.registerTitle')}
          {mode === 'forgot' && t('auth.forgotPasswordTitle')}
        </h3>

        {mode !== 'forgot' && (
          <>
            <div style={{ position: 'relative' }}>
              <GoogleButton onCredential={handleGoogleCredential} />
              {isGoogleSubmitting && (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,0.55)', borderRadius: '4px' }}>
                  <span style={{ color: 'var(--text-main)', fontSize: '0.85rem' }}>{t('auth.processing')}</span>
                </div>
              )}
            </div>

            <div style={{ margin: '15px 0', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.85rem' }}>
              <span style={{ flex: 1, height: '1px', background: 'rgba(136,146,176,0.25)' }} />
              {t('home.or')}
              <span style={{ flex: 1, height: '1px', background: 'rgba(136,146,176,0.25)' }} />
            </div>
          </>
        )}

        {mode === 'forgot' ? (
          forgotSent ? (
            <p style={{ color: 'var(--neon-green)', fontSize: '0.9rem', textAlign: 'center' }}>{t('auth.forgotPasswordSent')}</p>
          ) : (
            <form onSubmit={handleForgotSubmit}>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginBottom: '10px' }}>{t('auth.forgotPasswordHint')}</p>
              <input
                type="text"
                className="cyber-input"
                placeholder={t('auth.identifierPlaceholder')}
                value={forgotIdentifier}
                onChange={(e) => setForgotIdentifier(e.target.value)}
                required
              />

              {errorKey && (
                <p style={{ color: 'var(--neon-red)', fontSize: '0.85rem', marginTop: '5px' }}>{t(errorKey)}</p>
              )}

              <button type="submit" className="cyber-button pulse-animation" style={{ width: '100%', marginTop: '15px' }} disabled={isSubmitting}>
                {t('auth.forgotPasswordSubmit')}
              </button>
            </form>
          )
        ) : (
          <form onSubmit={handleSubmit}>
            {mode === 'login' ? (
              <input
                type="text"
                className="cyber-input"
                placeholder={t('auth.identifierPlaceholder')}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
              />
            ) : (
              <>
                <input
                  type="text"
                  className="cyber-input"
                  placeholder={t('auth.usernamePlaceholder')}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  minLength={3}
                  maxLength={30}
                  required
                />
                <input
                  type="email"
                  className="cyber-input"
                  placeholder={t('auth.emailOptionalPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <input
                  type="text"
                  className="cyber-input"
                  placeholder={t('auth.displayNamePlaceholder')}
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                  required
                />
              </>
            )}
            <input
              type="password"
              className="cyber-input"
              placeholder={t('auth.passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />

            {mode === 'login' && (
              <button
                type="button"
                onClick={() => { setMode('forgot'); setErrorKey(''); }}
                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', marginTop: '8px', fontSize: '0.8rem', padding: 0 }}
              >
                {t('auth.forgotPasswordLink')}
              </button>
            )}

            {errorKey && (
              <p style={{ color: 'var(--neon-red)', fontSize: '0.85rem', marginTop: '5px' }}>{t(errorKey)}</p>
            )}

            <button type="submit" className="cyber-button pulse-animation" style={{ width: '100%', marginTop: '15px' }} disabled={isSubmitting}>
              {mode === 'login' ? t('auth.loginSubmit') : t('auth.registerSubmit')}
            </button>
          </form>
        )}

        <button
          onClick={() => {
            setErrorKey('');
            setForgotSent(false);
            setMode(mode === 'register' ? 'login' : (mode === 'forgot' ? 'login' : 'register'));
          }}
          style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', textDecoration: 'underline', cursor: 'pointer', marginTop: '15px', width: '100%', fontSize: '0.85rem' }}
        >
          {mode === 'login' && t('auth.switchToRegister')}
          {mode === 'register' && t('auth.switchToLogin')}
          {mode === 'forgot' && t('auth.backToLogin')}
        </button>
      </div>
    </div>,
    document.body
  );
}
