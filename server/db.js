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
