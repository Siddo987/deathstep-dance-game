import React, { useState } from 'react';

function Feedback() {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setStatus('Sende...');
    try {
      const response = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, message, timestamp: new Date().toISOString() })
      });
      if (response.ok) {
        setStatus('Vielen Dank für dein Feedback!');
        setName('');
        setMessage('');
      } else {
        setStatus('Fehler beim Senden.');
      }
    } catch (err) {
      setStatus('Fehler beim Senden.');
    }
  };

  return (
    <div className="app-container" style={{ padding: '20px' }}>
      <div className="cyber-card" style={{ maxWidth: '600px', margin: '0 auto' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px', textAlign: 'center' }}>Feedback</h2>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
          <div>
            <label style={{ color: 'var(--text-muted)' }}>Name (optional)</label>
            <input 
              type="text" 
              className="cyber-input" 
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Dein Name"
            />
          </div>
          <div>
            <label style={{ color: 'var(--text-muted)' }}>Nachricht</label>
            <textarea 
              className="cyber-input" 
              style={{ minHeight: '150px', resize: 'vertical' }}
              value={message}
              onChange={e => setMessage(e.target.value)}
              placeholder="Was können wir verbessern?"
              required
            />
          </div>
          <button type="submit" className="cyber-button pulse-animation" style={{ marginTop: '10px' }}>
            Absenden
          </button>
        </form>
        {status && (
          <p style={{ marginTop: '20px', textAlign: 'center', color: status.includes('Vielen Dank') ? 'var(--neon-blue)' : 'var(--neon-red)' }}>
            {status}
          </p>
        )}
        <div style={{ textAlign: 'center', marginTop: '20px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>Zurück zum Spiel</a>
        </div>
      </div>
    </div>
  );
}

export default Feedback;
