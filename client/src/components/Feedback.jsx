import React, { useState } from 'react';
import { useLanguage } from '../i18n.jsx';

function Feedback() {
  const { t } = useLanguage();
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  // Status is stored as a locale key so it re-renders in the right language
  const [statusKey, setStatusKey] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatusKey('feedback.sending');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message, timestamp: new Date().toISOString() })
      });
      if (response.ok) {
        setStatusKey('feedback.thanks');
        setName('');
        setMessage('');
      } else {
        setStatusKey('feedback.error');
      }
    } catch (err) {
      setStatusKey('feedback.error');
    }
  };

  return (
    <div className="app-container" style={{ padding: '20px' }}>
      <div className="cyber-card" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px', textAlign: 'center' }}>{t('feedback.title')}</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label style={{ color: 'var(--text-muted)' }}>{t('feedback.nameLabel')}</label>
            <input
              type="text"
              className="cyber-input"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder={t('feedback.namePlaceholder')}
            />
          </div>
          <div>
            <label style={{ color: 'var(--text-muted)' }}>{t('feedback.messageLabel')}</label>
            <textarea
              className="cyber-input"
              style={{ minHeight: '150px', resize: 'vertical' }}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder={t('feedback.messagePlaceholder')}
              required
            />
          </div>
          <button type="submit" className="cyber-button pulse-animation" style={{ marginTop: '10px' }}>
            {t('feedback.submit')}
          </button>
        </form>
        {statusKey && (
          <p style={{ marginTop: '20px', textAlign: 'center', color: statusKey === 'feedback.thanks' ? 'var(--neon-blue)' : 'var(--neon-red)' }}>
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

export default Feedback;
