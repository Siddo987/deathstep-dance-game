import React from 'react';
import { openCookieSettings } from './CookieBanner.jsx';

function Datenschutz() {
  return (
    <div className="app-container" style={{ padding: '20px', paddingBottom: '80px' }}>
      <div className="cyber-card" style={{ maxWidth: '750px', margin: '0 auto', textAlign: 'left' }}>
        <h2 style={{ color: 'var(--neon-blue)', marginBottom: '20px' }}>Datenschutzerklärung</h2>

        <button
          className="cyber-button"
          style={{ background: 'transparent', border: '1px solid var(--neon-purple)', color: 'var(--neon-purple)', marginBottom: '20px' }}
          onClick={openCookieSettings}
        >
          🍪 Cookie-Einstellungen ändern
        </button>

        <h3 style={{ color: 'var(--text-main)', marginTop: '20px', marginBottom: '10px' }}>1. Verantwortlicher</h3>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Jakob Lukas Sidowski<br />
          Ellerhofstraße 1<br />
          34121 Kassel<br />
          Deutschland<br />
          Telefon: <a href="tel:+4915732342373" style={{ color: 'var(--neon-blue)' }}>+49 1573 2342373</a><br />
          E-Mail: <a href="mailto:kontakt@jakob.sidowski.de" style={{ color: 'var(--neon-blue)' }}>kontakt@jakob.sidowski.de</a>
        </p>

        <h3 style={{ color: 'var(--text-main)', marginTop: '20px', marginBottom: '10px' }}>2. Technisch notwendige Speicherung im Browser</h3>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Deathstep verwendet keine klassischen Cookies, sondern speichert einige wenige Informationen im
          <em> lokalen Speicher (localStorage)</em> deines Browsers. Rechtlich wird dies wie Cookies behandelt
          (§ 25 TTDSG). Diese Daten sind technisch zwingend erforderlich, um die von dir aktiv aufgerufene Funktion
          (Beitritt zu einem Ballroom, Fortsetzen deiner Rolle nach einem Neuladen der Seite) überhaupt bereitzustellen,
          und werden nicht an Dritte weitergegeben:
        </p>
        <ul style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginTop: '10px', paddingLeft: '20px' }}>
          <li><code>deathstep_client_id</code> – zufällige, anonyme Kennung deines Geräts, damit dich das Spiel nach einem Neuladen wiedererkennt</li>
          <li><code>deathstep_room_id</code>, <code>deathstep_view</code> – welchem Ballroom du zuletzt beigetreten bist und in welcher Rolle (Spieler/Spielleiter)</li>
          <li><code>deathstep_privacy_mode</code> – Anzeige-Einstellung des Spielleiters (Namen ausblenden)</li>
          <li><code>deathstep_cookie_consent</code> – deine Auswahl in diesem Cookie-Banner</li>
        </ul>

        <h3 style={{ color: 'var(--text-main)', marginTop: '20px', marginBottom: '10px' }}>3. Optionale Spotify-Integration</h3>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Ein Spielleiter kann optional eine Spotify-Integration aktivieren, um Musik direkt aus der App zu steuern.
          Nur wenn diese Funktion aktiv eingeschaltet wird, lädt die Seite das Spotify-Player-Skript von Spotifys
          Servern nach und speichert folgende Werte lokal im Browser des Spielleiters:
        </p>
        <ul style={{ color: 'var(--text-muted)', lineHeight: 1.8, marginTop: '10px', paddingLeft: '20px' }}>
          <li><code>spotify_access_token</code>, <code>spotify_refresh_token</code>, <code>spotify_token_expires_at</code> – Zugangsdaten deiner Spotify-Anmeldung</li>
          <li><code>spotify_code_verifier</code> – technischer Wert des Anmeldevorgangs (OAuth)</li>
          <li><code>deathstep_use_spotify</code>, <code>deathstep_selected_track</code>, <code>deathstep_playback_state</code> – deine Einstellungen zur Musikwiedergabe</li>
        </ul>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '10px' }}>
          Dabei werden Daten an Spotify (Spotify AB, Schweden) übertragen. Es gilt zusätzlich die Datenschutzerklärung
          von Spotify: <a href="https://www.spotify.com/de/legal/privacy-policy/" target="_blank" rel="noreferrer" style={{ color: 'var(--neon-blue)' }}>spotify.com/de/legal/privacy-policy</a>.
        </p>

        <h3 style={{ color: 'var(--text-main)', marginTop: '20px', marginBottom: '10px' }}>4. Verarbeitung auf dem Server</h3>
        <ul style={{ color: 'var(--text-muted)', lineHeight: 1.8, paddingLeft: '20px' }}>
          <li>Spielstand (Namen, Rollen, Paare, Punkte) wird nur im Arbeitsspeicher des Servers gehalten, solange ein Ballroom aktiv ist, und beim Schließen des Ballrooms gelöscht. Es gibt keine dauerhafte Datenbank-Speicherung der Spielinhalte.</li>
          <li>Das Feedback-Formular speichert deinen (optionalen) Namen und deine Nachricht in einer Textdatei auf dem Server, damit wir Rückmeldungen auswerten können.</li>
          <li>Die Seite wird auf meinem eigenen Server gehostet. Dabei werden technisch bedingte Protokolldaten (Server-Logfiles) verarbeitet, wie z.B. IP-Adresse, Browsertyp und Uhrzeit des Zugriffs. Dies ist notwendig, um die Sicherheit und Stabilität des Servers zu gewährleisten.</li>
        </ul>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, marginTop: '10px' }}>
          Deathstep wird privat betrieben und ausschließlich für private Veranstaltungen genutzt (kein kommerzielles Angebot).
        </p>

        <h3 style={{ color: 'var(--text-main)', marginTop: '20px', marginBottom: '10px' }}>5. Schriftarten</h3>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Alle verwendeten Schriftarten (Orbitron, Inter) werden lokal von diesem Server ausgeliefert. Es findet
          keine Verbindung zu Google Fonts oder anderen externen Schriftart-Anbietern statt.
        </p>

        <h3 style={{ color: 'var(--text-main)', marginTop: '20px', marginBottom: '10px' }}>6. Deine Rechte</h3>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6 }}>
          Du hast nach der DSGVO das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung
          deiner Daten sowie ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde. Da die meisten hier
          beschriebenen Daten ausschließlich lokal in deinem Browser gespeichert werden, kannst du sie jederzeit
          selbst über die Browsereinstellungen ("Browserdaten löschen") entfernen.
        </p>

        <div style={{ textAlign: 'center', marginTop: '30px' }}>
          <a href="/" style={{ color: 'var(--text-muted)', textDecoration: 'underline' }}>Zurück zum Spiel</a>
        </div>
      </div>
    </div>
  );
}

export default Datenschutz;
