import React from 'react';
import { openCookieSettings } from './CookieBanner.jsx';
import { useLanguage } from '../i18n.jsx';

const h3Style = { color: 'var(--text-main)', marginTop: '20px', marginBottom: '10px' };
const pStyle = { color: 'var(--text-muted)', lineHeight: 1.6 };
const ulStyle = { color: 'var(--text-muted)', lineHeight: 1.8, marginTop: '10px', paddingLeft: '20px' };

function GermanContent() {
  return (
    <>
      <h3 style={h3Style}>1. Verantwortlicher</h3>
      <p style={pStyle}>
        Jakob Lukas Sidowski<br />
        Ellerhofstraße 1<br />
        34121 Kassel<br />
        Deutschland<br />
        Telefon: <a href="tel:+4915732342373" style={{ color: 'var(--neon-blue)' }}>+49 1573 2342373</a><br />
        E-Mail: <a href="mailto:kontakt@jakob.sidowski.de" style={{ color: 'var(--neon-blue)' }}>kontakt@jakob.sidowski.de</a>
      </p>

      <h3 style={h3Style}>2. Technisch notwendige Speicherung im Browser</h3>
      <p style={pStyle}>
        Deathstep verwendet keine klassischen Cookies, sondern speichert einige wenige Informationen im
        <em> lokalen Speicher (localStorage)</em> deines Browsers. Rechtlich wird dies wie Cookies behandelt
        (§ 25 TTDSG). Diese Daten sind technisch zwingend erforderlich, um die von dir aktiv aufgerufene Funktion
        (Beitritt zu einem Ballroom, Fortsetzen deiner Rolle nach einem Neuladen der Seite) überhaupt bereitzustellen,
        und werden nicht an Dritte weitergegeben:
      </p>
      <ul style={ulStyle}>
        <li><code>deathstep_client_id</code> – zufällige, anonyme Kennung deines Geräts, damit dich das Spiel nach einem Neuladen wiedererkennt</li>
        <li><code>deathstep_room_id</code>, <code>deathstep_view</code> – welchem Ballroom du zuletzt beigetreten bist und in welcher Rolle (Spieler/Spielleiter)</li>
        <li><code>deathstep_privacy_mode</code> – Anzeige-Einstellung des Spielleiters (Namen ausblenden)</li>
        <li><code>deathstep_language</code> – deine gewählte Sprache (Deutsch/Englisch)</li>
        <li><code>deathstep_cookie_consent</code> – deine Auswahl in diesem Cookie-Banner</li>
      </ul>

      <h3 style={h3Style}>3. Optionale Spotify-Integration</h3>
      <p style={pStyle}>
        Ein Spielleiter kann optional eine Spotify-Integration aktivieren, um Musik direkt aus der App zu steuern.
        Nur wenn diese Funktion aktiv eingeschaltet wird, lädt die Seite das Spotify-Player-Skript von Spotifys
        Servern nach und speichert folgende Werte lokal im Browser des Spielleiters:
      </p>
      <ul style={ulStyle}>
        <li><code>spotify_access_token</code>, <code>spotify_refresh_token</code>, <code>spotify_token_expires_at</code> – Zugangsdaten deiner Spotify-Anmeldung</li>
        <li><code>spotify_code_verifier</code> – technischer Wert des Anmeldevorgangs (OAuth)</li>
        <li><code>deathstep_use_spotify</code>, <code>deathstep_selected_track</code>, <code>deathstep_playback_state</code> – deine Einstellungen zur Musikwiedergabe</li>
      </ul>
      <p style={{ ...pStyle, marginTop: '10px' }}>
        Dabei werden Daten an Spotify (Spotify AB, Schweden) übertragen. Es gilt zusätzlich die Datenschutzerklärung
        von Spotify: <a href="https://www.spotify.com/de/legal/privacy-policy/" target="_blank" rel="noreferrer" style={{ color: 'var(--neon-blue)' }}>spotify.com/de/legal/privacy-policy</a>.
      </p>

      <h3 style={h3Style}>4. Verarbeitung auf dem Server</h3>
      <ul style={{ ...ulStyle, marginTop: 0 }}>
        <li>Spielstand (Namen, Rollen, Paare, Punkte) wird nur im Arbeitsspeicher des Servers gehalten, solange ein Ballroom aktiv ist, und beim Schließen des Ballrooms gelöscht. Es gibt keine dauerhafte Datenbank-Speicherung der Spielinhalte.</li>
        <li>Das Feedback-Formular speichert deinen (optionalen) Namen und deine Nachricht in einer Textdatei auf dem Server, damit wir Rückmeldungen auswerten können.</li>
        <li>Die Seite wird auf meinem eigenen Server gehostet. Dabei werden technisch bedingte Protokolldaten (Server-Logfiles) verarbeitet, wie z.B. IP-Adresse, Browsertyp und Uhrzeit des Zugriffs. Dies ist notwendig, um die Sicherheit und Stabilität des Servers zu gewährleisten.</li>
      </ul>
      <p style={{ ...pStyle, marginTop: '10px' }}>
        Deathstep wird privat betrieben und ausschließlich für private Veranstaltungen genutzt (kein kommerzielles Angebot).
      </p>

      <h3 style={h3Style}>5. Schriftarten</h3>
      <p style={pStyle}>
        Alle verwendeten Schriftarten (Orbitron, Inter) werden lokal von diesem Server ausgeliefert. Es findet
        keine Verbindung zu Google Fonts oder anderen externen Schriftart-Anbietern statt.
      </p>

      <h3 style={h3Style}>6. Deine Rechte</h3>
      <p style={pStyle}>
        Du hast nach der DSGVO das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung
        deiner Daten sowie ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde. Da die meisten hier
        beschriebenen Daten ausschließlich lokal in deinem Browser gespeichert werden, kannst du sie jederzeit
        selbst über die Browsereinstellungen ("Browserdaten löschen") entfernen.
      </p>
    </>
  );
}

function EnglishContent() {
  return (
    <>
      <h3 style={h3Style}>1. Controller</h3>
      <p style={pStyle}>
        Jakob Lukas Sidowski<br />
        Ellerhofstraße 1<br />
        34121 Kassel<br />
        Germany<br />
        Phone: <a href="tel:+4915732342373" style={{ color: 'var(--neon-blue)' }}>+49 1573 2342373</a><br />
        Email: <a href="mailto:kontakt@jakob.sidowski.de" style={{ color: 'var(--neon-blue)' }}>kontakt@jakob.sidowski.de</a>
      </p>

      <h3 style={h3Style}>2. Technically necessary storage in your browser</h3>
      <p style={pStyle}>
        Deathstep does not use classic cookies but stores a small amount of information in your browser's
        <em> local storage (localStorage)</em>. Legally, this is treated like cookies (§ 25 TTDSG, German law).
        This data is strictly necessary to provide the function you actively requested (joining a ballroom,
        resuming your role after reloading the page) and is not shared with third parties:
      </p>
      <ul style={ulStyle}>
        <li><code>deathstep_client_id</code> – a random, anonymous identifier of your device so the game recognizes you after a reload</li>
        <li><code>deathstep_room_id</code>, <code>deathstep_view</code> – which ballroom you last joined and in which role (player/GM)</li>
        <li><code>deathstep_privacy_mode</code> – a display setting of the GM (hide names)</li>
        <li><code>deathstep_language</code> – your chosen language (German/English)</li>
        <li><code>deathstep_cookie_consent</code> – your selection in the cookie banner</li>
      </ul>

      <h3 style={h3Style}>3. Optional Spotify integration</h3>
      <p style={pStyle}>
        A GM can optionally enable a Spotify integration to control music directly from the app.
        Only when this feature is actively switched on does the page load the Spotify player script from
        Spotify's servers and store the following values locally in the GM's browser:
      </p>
      <ul style={ulStyle}>
        <li><code>spotify_access_token</code>, <code>spotify_refresh_token</code>, <code>spotify_token_expires_at</code> – credentials of your Spotify login</li>
        <li><code>spotify_code_verifier</code> – a technical value of the login process (OAuth)</li>
        <li><code>deathstep_use_spotify</code>, <code>deathstep_selected_track</code>, <code>deathstep_playback_state</code> – your music playback settings</li>
      </ul>
      <p style={{ ...pStyle, marginTop: '10px' }}>
        In doing so, data is transferred to Spotify (Spotify AB, Sweden). Spotify's privacy policy also applies:{' '}
        <a href="https://www.spotify.com/legal/privacy-policy/" target="_blank" rel="noreferrer" style={{ color: 'var(--neon-blue)' }}>spotify.com/legal/privacy-policy</a>.
      </p>

      <h3 style={h3Style}>4. Processing on the server</h3>
      <ul style={{ ...ulStyle, marginTop: 0 }}>
        <li>Game state (names, roles, couples, scores) is only kept in the server's memory while a ballroom is active and is deleted when the ballroom is closed. There is no permanent database storage of game content.</li>
        <li>The feedback form stores your (optional) name and your message in a text file on the server so we can evaluate feedback.</li>
        <li>The site is hosted on my own server. Technically required log data (server log files) is processed, such as IP address, browser type, and time of access. This is necessary to ensure the security and stability of the server.</li>
      </ul>
      <p style={{ ...pStyle, marginTop: '10px' }}>
        Deathstep is operated privately and used exclusively for private events (not a commercial offering).
      </p>

      <h3 style={h3Style}>5. Fonts</h3>
      <p style={pStyle}>
        All fonts used (Orbitron, Inter) are served locally from this server. No connection is made to
        Google Fonts or other external font providers.
      </p>

      <h3 style={h3Style}>6. Your rights</h3>
      <p style={pStyle}>
        Under the GDPR, you have the right to access, rectification, erasure, and restriction of the processing
        of your data, as well as the right to lodge a complaint with a data protection supervisory authority.
        Since most of the data described here is stored exclusively locally in your browser, you can remove it
        yourself at any time via your browser settings ("clear browsing data").
      </p>
    </>
  );
}

function Datenschutz() {
  const { lang, t } = useLanguage();

  return (
    <div className="app-container" style={{ padding: '20px', paddingBottom: '80px' }}>
      <div className="cyber-card" style={{ maxWidth: '750px', margin: '0 auto', textAlign: 'left' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px' }}>
          {lang === 'de' ? 'Datenschutzerklärung' : 'Privacy Policy'}
        </h2>

        <button
          className="cyber-button"
          style={{ background: 'transparent', border: '1px solid var(--neon-purple)', color: 'var(--neon-purple)', marginBottom: '20px' }}
          onClick={openCookieSettings}
        >
          🍪 {lang === 'de' ? 'Cookie-Einstellungen ändern' : 'Change cookie settings'}
        </button>

        {lang === 'de' ? <GermanContent /> : <EnglishContent />}

        <div style={{ textAlign: 'center', marginTop: '30px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>{t('common.backToGame')}</a>
        </div>
      </div>
    </div>
  );
}

export default Datenschutz;
