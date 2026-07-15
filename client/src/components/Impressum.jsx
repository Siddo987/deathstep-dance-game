import React from 'react';
import { useLanguage } from '../i18n.jsx';

function Impressum() {
  const { lang, t } = useLanguage();

  const contact = (
    <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '10px' }}>
      Jakob Lukas Sidowski<br />
      Ellerhofstraße 1<br />
      34121 Kassel<br />
      {lang === 'de' ? 'Deutschland' : 'Germany'}
    </p>
  );

  return (
    <div className="app-container" style={{ padding: '20px', paddingBottom: '80px' }}>
      <div className="cyber-card" style={{ maxWidth: '750px', margin: '0 auto', textAlign: 'left' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px' }}>{lang === 'de' ? 'Impressum' : 'Legal Notice (Impressum)'}</h2>

        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <strong style={{ color: 'var(--text-main)' }}>
            {lang === 'de' ? 'Angaben gemäß § 5 TMG:' : 'Information according to § 5 TMG (German Telemedia Act):'}
          </strong>
        </p>
        {contact}

        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '20px' }}>
          <strong style={{ color: 'var(--text-main)' }}>{lang === 'de' ? 'Kontakt:' : 'Contact:'}</strong><br />
          {lang === 'de' ? 'Telefon' : 'Phone'}: <a href="tel:+4915732342373" style={{ color: 'var(--neon-blue)' }}>+49 1573 2342373</a><br />
          {lang === 'de' ? 'E-Mail' : 'Email'}: <a href="mailto:kontakt@jakob.sidowski.de" style={{ color: 'var(--neon-blue)' }}>kontakt@jakob.sidowski.de</a>
        </p>

        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '20px' }}>
          {lang === 'de'
            ? 'Deathstep wird privat betrieben und ausschließlich für private Veranstaltungen genutzt (kein kommerzielles Angebot).'
            : 'Deathstep is operated privately and used exclusively for private events (not a commercial offering).'}
        </p>

        <div style={{ textAlign: 'center', marginTop: '30px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</a>
        </div>
      </div>
    </div>
  );
}

export default Impressum;
