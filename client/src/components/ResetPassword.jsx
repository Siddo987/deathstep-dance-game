import React, { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { useLanguage } from '../i18n.jsx';
import { resetPassword } from '../auth.js';

// Standalone page for the link emailed by "Passwort vergessen" (see
// server/auth.js's /forgot-password, Auth.jsx's forgot-password mode) -
// reached directly from an email client, never from in-app navigation, so it
// can't assume any app state (a room, a logged-in session, ...) beyond the
// ?token= query param.
function ResetPassword({ onAuthenticated }) {
  const { t } = useLanguage();
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [errorKey, setErrorKey] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErrorKey('');
    if (newPassword !== confirmPassword) {
      setErrorKey('auth.error.passwords_do_not_match');
      return;
    }
    setIsSubmitting(true);
    try {
      const result = await resetPassword(token, newPassword);
      if (result.error) {
        setErrorKey(`auth.error.${result.error}`);
        setIsSubmitting(false);
        return;
      }
      onAuthenticated?.(result.user);
      setSuccess(true);
    } catch (err) {
      setErrorKey('auth.error.unknown_error');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="app-container" style={{ padding: '20px' }}>
      <div className="cyber-card" style={{ maxWidth: '400px', margin: '0 auto' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
          <KeyRound size={22} />
          {t('auth.resetPasswordTitle')}
        </h2>

        {!token ? (
          <p style={{ color: 'var(--neon-red)', textAlign: 'center' }}>{t('auth.error.invalid_or_expired_token')}</p>
        ) : success ? (
          <p style={{ color: 'var(--neon-green)', textAlign: 'center' }}>{t('auth.resetPasswordSuccess')}</p>
        ) : (
          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <input
              type="password"
              className="cyber-input"
              placeholder={t('auth.newPasswordPlaceholder')}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              minLength={8}
              required
            />
            <input
              type="password"
              className="cyber-input"
              placeholder={t('auth.confirmPasswordPlaceholder')}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              minLength={8}
              required
            />

            {errorKey && (
              <p style={{ color: 'var(--neon-red)', fontSize: '0.85rem' }}>{t(errorKey)}</p>
            )}

            <button type="submit" className="cyber-button pulse-animation" disabled={isSubmitting}>
              {t('auth.resetPasswordSubmit')}
            </button>
          </form>
        )}

        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</a>
        </div>
      </div>
    </div>
  );
}

export default ResetPassword;
