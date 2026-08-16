import mysql from 'mysql2/promise';

// Auth is optional infrastructure on top of the core (DB-free) party game, so
// a missing/unreachable DB must never crash the server - it should just mean
// the auth routes answer 503 while rooms/sockets keep working normally.
let pool = null;
let initPromise = null;

function isConfigured() {
  return !!(process.env.DB_HOST && process.env.DB_USER && process.env.DB_NAME);
}

async function migrate(activePool) {
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) UNIQUE NULL,
      password_hash VARCHAR(255) NULL,
      google_id VARCHAR(255) UNIQUE NULL,
      display_name VARCHAR(100) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // Added after the initial users table shipped, so existing installs need
  // ALTER ... ADD COLUMN IF NOT EXISTS instead of CREATE TABLE IF NOT EXISTS
  // (which is a no-op once the table already exists).
  await activePool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_dance_role ENUM('lead','follow') NULL`);
  await activePool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS default_is_flexible TINYINT(1) NOT NULL DEFAULT 0`);
  await activePool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS leaderboard_opt_in TINYINT(1) NOT NULL DEFAULT 0`);
  // Set once, at registration time, from the ?ref=<userId> query param of
  // whatever invite link was used (see server/auth.js's register/google
  // routes) - null for anyone who signed up without one. No FK constraint
  // (consistent with the other optional columns here) since a dangling id
  // from a since-changed account is harmless: it just never matches anyone's
  // own "how many people I invited" count.
  await activePool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS referred_by_user_id INT NULL`);
  // Login handle for password accounts now that email is optional at
  // registration (see server/auth.js's /register and /login) - stored
  // lowercase like email, unique, but nullable since every account that
  // existed before this shipped has none and keeps logging in via email/
  // Google as before. New password registrations always set one; login
  // matches on either this or email. Not shown anywhere in the app (the
  // public-facing name is still display_name) so it never needs to change.
  await activePool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username VARCHAR(50) NULL`);
  await activePool.query(`ALTER TABLE users ADD UNIQUE INDEX IF NOT EXISTS idx_username (username)`);
  // "Forgot password" tokens (see server/auth.js's /forgot-password and
  // /reset-password) - only ever issued for an account with an email on
  // file (there's nowhere to send one otherwise). token_hash stores a SHA-256
  // digest, never the raw token itself, same reasoning as password_hash -
  // the raw token only ever exists in the emailed link and the requesting
  // browser's memory, so a DB read alone can never be used to reset someone's
  // password. used_at marks a token spent (checked, never deleted, so a
  // replay attempt is distinguishable from an unknown token in logs); expired/
  // spent rows are cheap enough to just leave rather than sweeping.
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      token_hash VARCHAR(64) NOT NULL,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_password_reset_token_hash (token_hash)
    )
  `);
  // Account-wide default: when set, a player with their own linked Spotify
  // connection automatically requests to share it into any room they join as
  // a player (still subject to the GM's explicit accept - see
  // gameStore.requestSpotifyShare) instead of doing it by hand every room.
  await activePool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_share_spotify TINYINT(1) NOT NULL DEFAULT 0`);
  // Grants access to the hidden in-game admin menu item (see server/admin.js,
  // client/src/components/GMDashboard.jsx's kebab menu) - never set through
  // any UI, deliberately: the site owner inserts a row for their own account
  // (and nobody else's) directly in the DB, consistent with this app's
  // existing "trusted small deployment" posture elsewhere (plaintext Spotify
  // refresh tokens, etc.). A dedicated table rather than a users column so
  // the permission is a plain, explicit list of user ids.
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS admin_users (
      user_id INT PRIMARY KEY,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS game_participations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      room_id VARCHAR(10) NOT NULL,
      role ENUM('killer','dancer') NOT NULL,
      won TINYINT(1) NOT NULL,
      played_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS gm_sessions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      room_id VARCHAR(10) NOT NULL,
      hosted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  // Refresh token is stored unencrypted, consistent with this app's existing
  // security posture (plaintext DB credentials in .env) - a deliberate
  // simplification for a small, trusted-friend-group deployment, not an oversight.
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS spotify_accounts (
      user_id INT PRIMARY KEY,
      spotify_user_id VARCHAR(255) NULL,
      display_name VARCHAR(255) NULL,
      refresh_token VARCHAR(512) NOT NULL,
      connected_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  // A Spotify account may only ever be linked to one Deathstep account
  // (server/spotify.js's /connect route also checks this explicitly, for a
  // translatable error instead of a raw DB error on the rare case both
  // requests race) - wrapped in try/catch since any pre-existing duplicate
  // from before this constraint existed would otherwise fail migration for
  // every route, not just Spotify's. NULL is exempt from MySQL's uniqueness
  // check, so this can't break rows where spotify_user_id hasn't been set.
  try {
    await activePool.query(`ALTER TABLE spotify_accounts ADD UNIQUE INDEX IF NOT EXISTS idx_spotify_user_id (spotify_user_id)`);
  } catch (err) {
    console.error('Could not add spotify_accounts.spotify_user_id unique index (likely pre-existing duplicates):', err.message);
  }
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS playlists (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      name VARCHAR(100) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  // Set when a playlist was imported from Spotify - marks it as live-linked
  // (new adds push to Spotify, and reads pull in anything added there since).
  // Unique per (user, spotify playlist) so the same Spotify playlist can't be
  // imported twice - NULL is exempt from the uniqueness check, so app-only
  // playlists (no Spotify link) are unaffected.
  await activePool.query(`ALTER TABLE playlists ADD COLUMN IF NOT EXISTS spotify_playlist_id VARCHAR(255) NULL`);
  await activePool.query(`ALTER TABLE playlists ADD UNIQUE INDEX IF NOT EXISTS idx_user_spotify_playlist (user_id, spotify_playlist_id)`);
  // Spotify bumps a playlist's snapshot_id on every edit (add/remove/reorder).
  // server/playlists.js's pullTracksFromSpotify compares the last snapshot_id
  // seen here against a single cheap lookup before deciding whether a full
  // (possibly multi-page) re-fetch of every track is actually necessary -
  // this is what lets the 8s on-read throttle and the 3-minute background
  // sync loop poll every linked playlist without burning a full paginated
  // fetch each time nothing actually changed, which is the common case.
  await activePool.query(`ALTER TABLE playlists ADD COLUMN IF NOT EXISTS spotify_snapshot_id VARCHAR(255) NULL`);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS playlist_tracks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      playlist_id INT NOT NULL,
      track_uri VARCHAR(255) NOT NULL,
      track_name VARCHAR(255) NOT NULL,
      artist_name VARCHAR(255) NOT NULL,
      position INT NOT NULL,
      FOREIGN KEY (playlist_id) REFERENCES playlists(id) ON DELETE CASCADE
    )
  `);
  // On a Spotify-linked playlist, every change - in the app or on Spotify -
  // is staged/flagged rather than applied silently, and only actually
  // reconciled once confirmed on whichever side initiated it:
  //  - 'pending_add': added in the app, not yet on Spotify. Resolves to
  //    'synced' once the user adds it on Spotify themselves (next pull-sync
  //    notices), or pushes it immediately via the app's own confirm action.
  //  - 'pending_delete': removed in the app, not yet removed from Spotify.
  //    Resolves (row purged) once it's also gone from Spotify, or the user
  //    pushes the removal immediately via the app's own confirm action.
  //  - 'removed_on_spotify': was 'synced', the pull-sync noticed it's gone
  //    from the real Spotify playlist. Stays flagged until the user
  //    acknowledges it (removes it locally too) or it reappears on Spotify.
  // Tracks in app-only (non-linked) playlists just stay 'synced' - the
  // status only matters once a spotify_playlist_id is set. MODIFY COLUMN
  // (not ADD COLUMN IF NOT EXISTS) since this widens an existing enum -
  // safe to re-run identically on every boot.
  await activePool.query(`ALTER TABLE playlist_tracks ADD COLUMN IF NOT EXISTS sync_status ENUM('synced','pending_add','pending_delete','removed_on_spotify') NOT NULL DEFAULT 'synced'`);
  await activePool.query(`ALTER TABLE playlist_tracks MODIFY COLUMN sync_status ENUM('synced','pending_add','pending_delete','removed_on_spotify') NOT NULL DEFAULT 'synced'`);
  // A track may only appear once per playlist - the /tracks route (see
  // server/playlists.js) already checks this before inserting; this is the
  // DB-level backstop against a race between two concurrent adds. Wrapped in
  // try/catch like the spotify_user_id index above, since existing
  // duplicates from before this constraint existed would otherwise fail
  // migration on every boot.
  try {
    await activePool.query(`ALTER TABLE playlist_tracks ADD UNIQUE INDEX IF NOT EXISTS idx_playlist_uri (playlist_id, track_uri)`);
  } catch (err) {
    console.error('Could not add playlist_tracks unique index (likely pre-existing duplicates):', err.message);
  }

  // Full game history - every round, who was in which couple, who was
  // killer/dancer, who voted for whom, who claimed which kill (silent mode),
  // and what was played, with a Spotify link. Fully normalized (not JSON
  // blobs) so any of it is directly queryable later once a frontend exists
  // to browse it - this migration only ever writes it, see
  // recordGameConclusion() in server/stats.js for the one place that does.
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS games (
      id INT AUTO_INCREMENT PRIMARY KEY,
      room_id VARCHAR(10) NOT NULL,
      gm_user_id INT NULL,
      kill_mode ENUM('classic','silent') NOT NULL,
      started_at DATETIME NOT NULL,
      ended_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      aborted TINYINT(1) NOT NULL DEFAULT 0,
      killers_won TINYINT(1) NULL,
      FOREIGN KEY (gm_user_id) REFERENCES users(id) ON DELETE SET NULL,
      INDEX idx_games_room_id (room_id)
    )
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS game_couples (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_id INT NOT NULL,
      couple_key VARCHAR(50) NOT NULL,
      name VARCHAR(100) NOT NULL,
      role ENUM('dancer','killer') NOT NULL,
      final_status ENUM('alive','eliminated') NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  // Added after the initial game_couples table shipped, for the special-role
  // system (see SPECIAL_ROLE_KEYS in server/gameStore.js). special_role is a
  // plain string rather than an ENUM on purpose - that list is expected to
  // keep growing, and widening a MySQL ENUM needs a MODIFY COLUMN migration
  // per addition (see playlist_tracks.sync_status above), which a free-form
  // column validated server-side avoids. eliminated_by records whether the
  // couple's final_status='eliminated' came from a kill or a vote - used by
  // the Märtyrer special role's win condition; stays NULL for couples that
  // finished 'alive' or were force-eliminated by an aborted game.
  await activePool.query(`ALTER TABLE game_couples ADD COLUMN IF NOT EXISTS special_role VARCHAR(20) NULL`);
  await activePool.query(`ALTER TABLE game_couples ADD COLUMN IF NOT EXISTS eliminated_by ENUM('kill','vote') NULL`);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS game_couple_members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_couple_id INT NOT NULL,
      player_name VARCHAR(100) NOT NULL,
      user_id INT NULL,
      dance_role ENUM('lead','follow','spectator') NOT NULL,
      FOREIGN KEY (game_couple_id) REFERENCES game_couples(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS game_rounds (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_id INT NOT NULL,
      round_number INT NOT NULL,
      completed TINYINT(1) NOT NULL DEFAULT 1,
      eliminated_by_vote_couple_id INT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
      FOREIGN KEY (eliminated_by_vote_couple_id) REFERENCES game_couples(id) ON DELETE SET NULL
    )
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS game_round_kills (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_round_id INT NOT NULL,
      killed_couple_id INT NOT NULL,
      FOREIGN KEY (game_round_id) REFERENCES game_rounds(id) ON DELETE CASCADE,
      FOREIGN KEY (killed_couple_id) REFERENCES game_couples(id) ON DELETE CASCADE
    )
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS game_round_votes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_round_id INT NOT NULL,
      voter_couple_id INT NOT NULL,
      voting_player_name VARCHAR(100) NULL,
      suspect_couple_id INT NULL,
      FOREIGN KEY (game_round_id) REFERENCES game_rounds(id) ON DELETE CASCADE,
      FOREIGN KEY (voter_couple_id) REFERENCES game_couples(id) ON DELETE CASCADE,
      FOREIGN KEY (suspect_couple_id) REFERENCES game_couples(id) ON DELETE SET NULL
    )
  `);
  // Silent kill-mode only - stays empty for classic-mode games.
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS game_round_kill_claims (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_round_id INT NOT NULL,
      killer_couple_id INT NOT NULL,
      victim_couple_id INT NULL,
      FOREIGN KEY (game_round_id) REFERENCES game_rounds(id) ON DELETE CASCADE,
      FOREIGN KEY (killer_couple_id) REFERENCES game_couples(id) ON DELETE CASCADE,
      FOREIGN KEY (victim_couple_id) REFERENCES game_couples(id) ON DELETE SET NULL
    )
  `);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS game_round_victim_reports (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_round_id INT NOT NULL,
      couple_id INT NOT NULL,
      felt_killed TINYINT(1) NOT NULL,
      suspect_couple_id INT NULL,
      FOREIGN KEY (game_round_id) REFERENCES game_rounds(id) ON DELETE CASCADE,
      FOREIGN KEY (couple_id) REFERENCES game_couples(id) ON DELETE CASCADE,
      FOREIGN KEY (suspect_couple_id) REFERENCES game_couples(id) ON DELETE SET NULL
    )
  `);
  // Feedback used to be appended to a flat server/data/feedback.txt file with
  // no way to review it in the app - now stored so a developer account (see
  // requireSuperAdmin, same admin_users gate as the pairing/killer override
  // tool) can browse/triage it from the hidden Dev Dashboard. user_id is only
  // ever set if the submitter happened to be logged in - the public feedback
  // form (client/src/components/Feedback.jsx) works with no account too.
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS feedback (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      name VARCHAR(100) NULL,
      message TEXT NOT NULL,
      is_read TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    )
  `);
  // Single-row table (id is always 1) of small tunable numbers a developer
  // can adjust live from the Dev Dashboard instead of needing a code
  // change/redeploy - currently just the killer-count suggestion's divisor
  // (suggested killers = round(totalPlayers / killer_ratio_divisor), see
  // gameStore.startGame and GMDashboard.jsx). Whether the dev has ever opened
  // the dashboard or not, the row must already exist so the public
  // /api/dev-settings/killer-ratio read (every GM's dashboard depends on it)
  // never has to special-case a missing row.
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS dev_settings (
      id INT PRIMARY KEY,
      killer_ratio_divisor INT NOT NULL DEFAULT 8
    )
  `);
  await activePool.query(`INSERT IGNORE INTO dev_settings (id, killer_ratio_divisor) VALUES (1, 8)`);
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS game_played_songs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      game_id INT NOT NULL,
      round_number INT NULL,
      track_uri VARCHAR(255) NOT NULL,
      spotify_url VARCHAR(255) NULL,
      track_name VARCHAR(255) NOT NULL,
      artist_name VARCHAR(255) NOT NULL,
      played_at DATETIME NOT NULL,
      FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
    )
  `);
  // Dev-curated fallback tracks (see server/index.js's GET /api/fallback-
  // songs/random) - offered to a GM who bypasses the "song ready" lock
  // (client/src/components/GMDashboard.jsx's bypassSongReady) with no track
  // selected at all, so the room still gets real music instead of silence.
  // Managed from the hidden Dev Dashboard, same admin_users gate as the rest
  // of it - not per-GM configurable, this is a shared house playlist.
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS fallback_songs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      track_uri VARCHAR(255) NOT NULL UNIQUE,
      track_name VARCHAR(255) NOT NULL,
      artist_name VARCHAR(255) NOT NULL,
      added_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  // News posts written from the hidden Dev Dashboard (see server/admin.js) -
  // optionally emailed out to every registered account with an email on file
  // at write time. sent_at/recipient_count stay NULL for a post saved
  // without emailing anyone; once set they're a permanent record of what
  // actually went out, not recomputed later even if the user list changes.
  // No public listing route - this is a one-way announcement channel, not a
  // changelog visitors browse (that's what roadmap_items below is for).
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS news_posts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      body TEXT NOT NULL,
      sent_at DATETIME NULL,
      recipient_count INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Per-recipient send log for the news post above - lets a dev look back
  // later at exactly who a given announcement went to and when (the post's
  // own recipient_count is just a total, this is the actual list). One row
  // per address attempted; success reflects sendMail()'s own result so a
  // bounce/typo'd address is visible here instead of silently vanishing into
  // the aggregate count. No FK: deleting a news_posts row (see the
  // /news/:id DELETE route) explicitly deletes its news_recipients rows too
  // in application code instead - nothing ever queries this table
  // independent of news_posts, so leaving them behind would just orphan
  // them as permanently invisible dead rows, not any kind of surviving
  // history.
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS news_recipients (
      id INT AUTO_INCREMENT PRIMARY KEY,
      news_post_id INT NOT NULL,
      email VARCHAR(255) NOT NULL,
      success TINYINT(1) NOT NULL DEFAULT 0,
      sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_news_recipients_post (news_post_id)
    )
  `);

  // Public roadmap (see the /roadmap page and its dev-panel editor in
  // DevDashboard.jsx). status drives which of the three columns an item
  // renders under; sort_order is a plain integer position within its own
  // status column (0-based, reassigned in bulk by the dev-panel's move-up/
  // move-down buttons - see the /roadmap-items/:id/move route) rather than
  // needing gaps or fractional inserts.
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS roadmap_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(200) NOT NULL,
      description TEXT NULL,
      status ENUM('planned','in_progress','done') NOT NULL DEFAULT 'planned',
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  // One-time seed of everything already shipped before the roadmap page
  // existed to record it, so /roadmap isn't empty-looking on first deploy.
  // Guarded on the table being completely empty, not on some separate
  // "already seeded" flag - if a dev clears every item out via the editor
  // later, that's a deliberate reset, not a signal to seed again.
  const [[{ roadmapCount }]] = await activePool.query('SELECT COUNT(*) AS roadmapCount FROM roadmap_items');
  if (roadmapCount === 0) {
    const seedItems = [
      ['News & Roadmap', 'Der Dev-Bereich kann jetzt Neuigkeiten per E-Mail verschicken, und diese Seite hier zeigt, woran gearbeitet wurde und wird.'],
      ['Faire Songlängen im Max-Kills-Modus', 'Zu kurze Songs benachteiligen kein Paar mehr - sie werden im Max-Kills-Modus gar nicht erst zur Auswahl angeboten.'],
      ['Mehrere Spezialrollen gleichzeitig', 'Die Anzahl jeder Spezialrolle (Wächter, Seher, Berührer, Märtyrer, Rätsel) lässt sich jetzt einzeln einstellen, statt nur an/aus.'],
      ['Sprachumschalter im Spiel', 'Deathstep ist jetzt auf Deutsch, Englisch, Russisch, Ukrainisch, Niederländisch und Französisch spielbar - umschaltbar direkt während des Spiels.'],
      ['Achievements', 'Für besondere Leistungen (z. B. viele Siege, viele gehostete Spiele) gibt es jetzt Bronze-, Silber- und Gold-Erfolge auf der eigenen Profilseite.'],
      ['Chaos- und Max-Kills-Modus', 'Zwei neue Spielmodi neben dem Standard-Modus: Chaos verteilt Rollen jede Runde neu, Max Kills ist ein rundenbasiertes Killer-Turnier.'],
      ['Spezialrollen', 'Fünf neue Rollen mit eigenen Fähigkeiten (Wächter, Seher, Berührer, Märtyrer, Rätsel) bringen mehr Abwechslung ins Standard-Spiel.'],
      ['Mehrere Spielleiter gleichzeitig', 'Ein Raum kann jetzt von mehreren Personen gemeinsam geleitet werden, inklusive Übergabe der Leitung.'],
      ['Passwort vergessen & optionale E-Mail', 'Registrierung braucht nur noch einen Benutzernamen, die E-Mail-Adresse ist optional - wer eine hinterlegt, kann sein Passwort selbst zurücksetzen.'],
      ['Songvorschläge & Playlist-Freigabe', 'Spieler können während des Spiels Songs vorschlagen, und Spielleiter können ihre Spotify-Playlist mit anderen teilen.'],
      ['Bestenliste & Statistiken', 'Vergangene Spiele fließen jetzt in eine Bestenliste und persönliche Statistiken ein.'],
      ['Feedback direkt im Spiel', 'Über einen Feedback-Knopf können Fehler und Wünsche jederzeit direkt aus der App heraus gemeldet werden.'],
      ['Stabilere Verbindung', 'Wer die Verbindung verliert (z. B. schwaches WLAN), kann jetzt zuverlässig wieder ins laufende Spiel zurückfinden.'],
      ['Schnellere Ladezeiten', 'Die App lädt beim Start jetzt deutlich schneller, da nur noch der gerade benötigte Teil nachgeladen wird.'],
    ];
    await activePool.query(
      'INSERT INTO roadmap_items (title, description, status, sort_order) VALUES ?',
      [seedItems.map(([title, description], i) => [title, description, 'done', i])]
    );
  }

  // Lifetime per-account achievement counters (see server/achievements.js) -
  // one row per (user, achievement type) ever earned, bumped by exactly 1
  // per concluded game that earned it. count alone derives the bronze/silver/
  // gold tier (10/50/100) client-side, so there's no separate tier column to
  // keep in sync.
  await activePool.query(`
    CREATE TABLE IF NOT EXISTS achievement_progress (
      user_id INT NOT NULL,
      achievement_key VARCHAR(50) NOT NULL,
      count INT NOT NULL DEFAULT 0,
      first_earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_earned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, achievement_key),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
}

// Lazily creates the pool and runs migrations at most once. Safe to call
// repeatedly (e.g. from every auth request) - later calls just await the
// same in-flight/completed init.
export async function getPool() {
  if (!isConfigured()) return null;
  if (pool) return pool;
  if (!initPromise) {
    initPromise = (async () => {
      const newPool = mysql.createPool({
        host: process.env.DB_HOST,
        port: process.env.DB_PORT ? Number(process.env.DB_PORT) : undefined,
        user: process.env.DB_USER,
        password: process.env.DB_PASS,
        database: process.env.DB_NAME,
        waitForConnections: true,
        connectionLimit: 5,
      });
      await migrate(newPool);
      pool = newPool;
      return pool;
    })().catch(err => {
      console.error('Database init failed, auth routes will be unavailable:', err.message);
      initPromise = null; // allow a retry on the next request
      return null;
    });
  }
  return initPromise;
}

// Every route that needs the DB should fail the same way (503) if it's not
// configured/reachable, instead of each router repeating the check.
export async function requireDb(req, res, next) {
  const pool = await getPool();
  if (!pool) return res.status(503).json({ error: 'auth_unavailable' });
  req.db = pool;
  next();
}
