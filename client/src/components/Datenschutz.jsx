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
        <li><code>deathstep_session_secret</code> – ein Sicherheits-Nachweis, dass ein Wiederverbinden zu einem Ballroom wirklich von dir kommt (kein anderer Spieler kann sich damit als du ausgeben)</li>
        <li><code>deathstep_privacy_mode</code> – Anzeige-Einstellung des Spielleiters (Namen ausblenden)</li>
        <li><code>deathstep_auto_random_song</code> – Einstellung des Spielleiters zur automatischen Musikauswahl</li>
        <li><code>deathstep_ref_code</code> – falls du über einen Einladungslink gekommen bist: die Kennung des einladenden Accounts, bis du dich (optional) registrierst</li>
        <li><code>deathstep_language</code> – deine gewählte Sprache (Deutsch/Englisch/Russisch/Ukrainisch/Niederländisch/Französisch)</li>
        <li><code>deathstep_cookie_consent</code> – deine Auswahl in diesem Cookie-Banner</li>
      </ul>

      <h3 style={h3Style}>3. Registrierung / Nutzerkonto (optional)</h3>
      <p style={pStyle}>
        Ein Nutzerkonto ist nicht erforderlich, um mitzuspielen - nur für Zusatzfunktionen wie eigene Statistiken,
        gespeicherte Playlists, Achievements oder das kontoweite Verknüpfen von Spotify. Bei der Registrierung
        werden gespeichert: deine E-Mail-Adresse, dein Passwort (als bcrypt-Hash, niemals im Klartext) sowie dein
        gewählter Anzeigename. Bei Registrierung über "Mit Google anmelden" stattdessen deine Google-Konto-ID und
        die von Google übermittelte E-Mail-Adresse/Name, ohne Passwort. Zusätzlich, je nachdem was du in den
        Einstellungen festlegst: bevorzugte Tanzrolle, ob du auf der öffentlichen Bestenliste erscheinen möchtest
        (Opt-in, standardmäßig aus), ob dein Spotify-Zugang automatisch mit Räumen geteilt wird, und - falls du über
        einen Einladungslink registriert hast - welcher Account dich eingeladen hat. Nach dem Login setzt der Server
        ein Sitzungs-Cookie (<code>deathstep_token</code>, nur technisch lesbar, 30 Tage gültig), damit du eingeloggt
        bleibst.
      </p>

      <h3 style={h3Style}>4. Optionale Spotify-Integration</h3>
      <p style={pStyle}>
        Ein Spielleiter kann optional eine Spotify-Integration aktivieren, um Musik direkt aus der App zu steuern.
        Nur wenn diese Funktion aktiv eingeschaltet wird, lädt die Seite das Spotify-Player-Skript von Spotifys
        Servern nach. Dafür gibt es zwei Varianten:
      </p>
      <ul style={ulStyle}>
        <li>
          <strong>Nur für diesen Ballroom (ohne Nutzerkonto):</strong> Zugangsdaten (<code>spotify_access_token</code>,{' '}
          <code>spotify_refresh_token</code>, <code>spotify_token_expires_at</code>, <code>spotify_code_verifier</code>)
          und Wiedergabe-Einstellungen (<code>deathstep_use_spotify</code>, <code>deathstep_selected_track</code>,{' '}
          <code>deathstep_playback_state</code>) werden ausschließlich lokal im Browser gespeichert.
        </li>
        <li>
          <strong>Kontoweite Verknüpfung (mit Nutzerkonto, z.B. über "Playlists"/"Einstellungen"):</strong> Der
          Zugangs-Token wird stattdessen serverseitig in unverschlüsselter Form deinem Konto zugeordnet gespeichert
          (Spotify-Anzeigename und eine interne Spotify-Konto-Kennung ebenso), damit du dich nicht bei jedem Ballroom
          neu anmelden musst und deine Verbindung optional mit einem Ballroom teilen ("leihen") kannst, in dem du
          mitspielst. Diese Speicherung bleibt bestehen, bis du die Verbindung selbst trennst.
        </li>
      </ul>
      <p style={{ ...pStyle, marginTop: '10px' }}>
        In beiden Fällen werden Daten an Spotify (Spotify AB, Schweden) übertragen. Es gilt zusätzlich die
        Datenschutzerklärung von Spotify:{' '}
        <a href="https://www.spotify.com/de/legal/privacy-policy/" target="_blank" rel="noreferrer" style={{ color: 'var(--neon-blue)' }}>spotify.com/de/legal/privacy-policy</a>.
      </p>

      <h3 style={h3Style}>5. Verarbeitung auf dem Server</h3>
      <ul style={{ ...ulStyle, marginTop: 0 }}>
        <li>Während ein Ballroom läuft, wird der aktuelle Spielstand (Namen, Rollen, Paare) nur im Arbeitsspeicher des Servers gehalten - keine Datenbank-Speicherung während des laufenden Spiels.</li>
        <li>Sobald ein Spiel endet oder abgebrochen wird, wird der vollständige Rundenverlauf dauerhaft in einer Datenbank gespeichert: Ballroom-Code, Kill-Modus, alle Paare mit den Namen ihrer Mitglieder, wer Killer/Tänzer war, jede Runde mit Kills, Abstimmungen, Verdächtigungen und Kill-Meldungen sowie die gespielten Lieder. Diese Historie ist nur für den Betreiber über einen versteckten, zugangsbeschränkten Bereich einsehbar (zur Fehlersuche und Weiterentwicklung) und wird bislang nicht automatisch gelöscht. War ein Spieler beim Spielen eingeloggt, kann sein Konto mit seinem Auftritt in dieser Historie sowie mit privaten Sieg/Niederlage-Statistiken auf seiner eigenen Profilseite verknüpft werden.</li>
        <li>Das Feedback-Formular speichert deinen (optionalen) Namen und deine Nachricht in einer Datenbank, damit wir Rückmeldungen einsehen und auswerten können - warst du beim Absenden eingeloggt, wird dein Konto mit gespeichert.</li>
        <li>Nutzt du die Playlists-Funktion, werden die von dir angelegten Playlist-Namen und Titellisten deinem Konto zugeordnet gespeichert.</li>
        <li>Mit Nutzerkonto werden automatisch Statistiken (gespielte Spiele, Siege/Niederlagen, geleitete Ballrooms) und erreichte Achievements deinem Konto zugeordnet gespeichert - unabhängig vom Opt-in für die öffentliche Bestenliste, der nur steuert, ob du dort öffentlich auftauchst.</li>
        <li>Die Seite wird auf meinem eigenen Server gehostet. Dabei werden technisch bedingte Protokolldaten (Server-Logfiles) verarbeitet, wie z.B. IP-Adresse, Browsertyp und Uhrzeit des Zugriffs. Dies ist notwendig, um die Sicherheit und Stabilität des Servers zu gewährleisten.</li>
      </ul>
      <p style={{ ...pStyle, marginTop: '10px' }}>
        Deathstep wird privat betrieben und ausschließlich für private Veranstaltungen genutzt (kein kommerzielles Angebot).
      </p>

      <h3 style={h3Style}>6. Schriftarten</h3>
      <p style={pStyle}>
        Alle verwendeten Schriftarten (Orbitron, Inter) werden lokal von diesem Server ausgeliefert. Es findet
        keine Verbindung zu Google Fonts oder anderen externen Schriftart-Anbietern statt.
      </p>

      <h3 style={h3Style}>7. Deine Rechte</h3>
      <p style={pStyle}>
        Du hast nach der DSGVO das Recht auf Auskunft, Berichtigung, Löschung und Einschränkung der Verarbeitung
        deiner Daten sowie ein Beschwerderecht bei einer Datenschutzaufsichtsbehörde. Daten, die ausschließlich
        lokal in deinem Browser gespeichert werden, kannst du jederzeit selbst über die Browsereinstellungen
        ("Browserdaten löschen") entfernen. Für alles, was serverseitig gespeichert wird (Nutzerkonto, Spielhistorie,
        Feedback, Playlists, kontoweite Spotify-Verknüpfung) - es gibt aktuell keine automatische
        Selbstbedienungs-Löschfunktion in der App - wende dich einfach an die Kontaktadresse unter Punkt 1, dann
        kümmere ich mich manuell darum.
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
        <li><code>deathstep_session_secret</code> – proof that reconnecting to a ballroom really is you (no other player can impersonate you with it)</li>
        <li><code>deathstep_privacy_mode</code> – a display setting of the GM (hide names)</li>
        <li><code>deathstep_auto_random_song</code> – a GM setting for automatic music selection</li>
        <li><code>deathstep_ref_code</code> – if you arrived via an invite link: the inviting account's identifier, until you (optionally) register</li>
        <li><code>deathstep_language</code> – your chosen language (German/English/Russian/Ukrainian/Dutch/French)</li>
        <li><code>deathstep_cookie_consent</code> – your selection in the cookie banner</li>
      </ul>

      <h3 style={h3Style}>3. Registration / user account (optional)</h3>
      <p style={pStyle}>
        A user account is not required to play - only for extra features like your own stats, saved playlists,
        achievements, or linking Spotify account-wide. On registration, we store: your email address, your
        password (as a bcrypt hash, never in plain text), and your chosen display name. If you register via
        "Sign in with Google" instead, we store your Google account ID and the email/name Google provides, with no
        password. Additionally, depending on what you set in Settings: your preferred dance role, whether you want
        to appear on the public leaderboard (opt-in, off by default), whether your Spotify connection is
        automatically shared with rooms, and - if you registered via an invite link - which account invited you.
        After logging in, the server sets a session cookie (<code>deathstep_token</code>, not readable by
        JavaScript, valid for 30 days) to keep you signed in.
      </p>

      <h3 style={h3Style}>4. Optional Spotify integration</h3>
      <p style={pStyle}>
        A GM can optionally enable a Spotify integration to control music directly from the app.
        Only when this feature is actively switched on does the page load the Spotify player script from
        Spotify's servers. There are two variants:
      </p>
      <ul style={ulStyle}>
        <li>
          <strong>For this ballroom only (no user account):</strong> Credentials (<code>spotify_access_token</code>,{' '}
          <code>spotify_refresh_token</code>, <code>spotify_token_expires_at</code>, <code>spotify_code_verifier</code>)
          and playback settings (<code>deathstep_use_spotify</code>, <code>deathstep_selected_track</code>,{' '}
          <code>deathstep_playback_state</code>) are stored exclusively locally in your browser.
        </li>
        <li>
          <strong>Account-wide linking (with a user account, e.g. via "Playlists"/"Settings"):</strong> The access
          token is instead stored server-side, unencrypted, tied to your account (along with your Spotify display
          name and an internal Spotify account identifier), so you don't have to log in again for every ballroom
          and can optionally share ("lend") your connection to a room you're playing in. This storage persists
          until you disconnect it yourself.
        </li>
      </ul>
      <p style={{ ...pStyle, marginTop: '10px' }}>
        In both cases, data is transferred to Spotify (Spotify AB, Sweden). Spotify's privacy policy also applies:{' '}
        <a href="https://www.spotify.com/legal/privacy-policy/" target="_blank" rel="noreferrer" style={{ color: 'var(--neon-blue)' }}>spotify.com/legal/privacy-policy</a>.
      </p>

      <h3 style={h3Style}>5. Processing on the server</h3>
      <ul style={{ ...ulStyle, marginTop: 0 }}>
        <li>While a ballroom is running, the current game state (names, roles, couples) is only kept in the server's memory - no database storage while the game is in progress.</li>
        <li>Once a game ends or is aborted, the full round-by-round history is permanently stored in a database: ballroom code, kill mode, every couple with its members' names, who was killer/dancer, every round's kills, votes, suspicions and kill claims, and the songs played. This history is only viewable by the operator through a hidden, access-restricted area (for debugging and improving the game) and is not currently deleted automatically. If a player was logged in while playing, their account may be linked to their entry in this history, as well as to private win/loss stats on their own profile page.</li>
        <li>The feedback form stores your (optional) name and your message in a database so we can review and evaluate it - if you were logged in when submitting, your account is stored alongside it.</li>
        <li>If you use the Playlists feature, the playlist names and track lists you create are stored tied to your account.</li>
        <li>With a user account, stats (games played, wins/losses, ballrooms hosted) and earned achievements are automatically stored tied to your account - independent of the public-leaderboard opt-in, which only controls whether you appear there publicly.</li>
        <li>The site is hosted on my own server. Technically required log data (server log files) is processed, such as IP address, browser type, and time of access. This is necessary to ensure the security and stability of the server.</li>
      </ul>
      <p style={{ ...pStyle, marginTop: '10px' }}>
        Deathstep is operated privately and used exclusively for private events (not a commercial offering).
      </p>

      <h3 style={h3Style}>6. Fonts</h3>
      <p style={pStyle}>
        All fonts used (Orbitron, Inter) are served locally from this server. No connection is made to
        Google Fonts or other external font providers.
      </p>

      <h3 style={h3Style}>7. Your rights</h3>
      <p style={pStyle}>
        Under the GDPR, you have the right to access, rectification, erasure, and restriction of the processing
        of your data, as well as the right to lodge a complaint with a data protection supervisory authority.
        Data stored exclusively locally in your browser can be removed by you at any time via your browser
        settings ("clear browsing data"). For anything stored server-side (user account, game history, feedback,
        playlists, account-wide Spotify link) - there is currently no automatic self-service deletion in the app -
        just reach out to the contact address under point 1 and I'll take care of it manually.
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
