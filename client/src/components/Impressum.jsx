import React from 'react';

function Impressum() {
  return (
    <div className="app-container" style={{ padding: '20px', paddingBottom: '80px' }}>
      <div className="cyber-card" style={{ maxWidth: '750px', margin: '0 auto', textAlign: 'left' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px' }}>Impressum</h2>

        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text-main)' }}>Angaben gemäß § 5 TMG:</strong>
        </p>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '10px' }}>
          Jakob Lukas Sidowski<br />
          Ellerhofstraße 1<br />
          34121 Kassel<br />
          Deutschland
        </p>

        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '20px' }}>
          <strong style={{ color: 'var(--text-main)' }}>Kontakt:</strong><br />
          Telefon: <a href="tel:+4915732342373" style={{ color: 'var(--neon-blue)' }}>+49 1573 2342373</a><br />
          E-Mail: <a href="mailto:kontakt@jakob.sidowski.de" style={{ color: 'var(--neon-blue)' }}>kontakt@jakob.sidowski.de</a>
        </p>

        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '20px' }}>
          Deathstep wird privat betrieben und ausschließlich für private Veranstaltungen genutzt (kein kommerzielles Angebot).
        </p>

        <div style={{ textAlign: 'center', marginTop: '30px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>Zurück zum Spiel</a>
        </div>
      </div>
    </div>
  );
}

export default Impressum;
