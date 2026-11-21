import fs from 'node:fs';
import path from 'node:path';
import BetterSqlite3 from 'better-sqlite3';

export type Db = BetterSqlite3.Database;

/**
 * Opens SQLite with the security and concurrency settings used by the app.
 * The database file must live outside the public directory.
 */
export function openDatabase(dbPath: string): Db {
  if (dbPath !== ':memory:') {
    const dir = path.dirname(dbPath);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    // The directory may already exist with looser permissions.
    fs.chmodSync(dir, 0o700);
  }

  const db = new BetterSqlite3(dbPath);

  if (dbPath !== ':memory:') {
    fs.chmodSync(dbPath, 0o600);
  }

  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');
  db.pragma('secure_delete = ON');
  db.pragma('trusted_schema = OFF');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -8000');

  return db;
}

export interface MigrationResult {
  applied: string[];
}

/**
 * Applies pending .sql migrations in filename order, each in its own transaction.
 */
export function runMigrations(db: Db, migrationsDir: string): MigrationResult {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
  `);

  const files = fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b));

  const appliedRows = db
    .prepare('SELECT version FROM schema_migrations ORDER BY version')
    .all() as Array<{ version: string }>;
  const applied = new Set(appliedRows.map((row) => row.version));
  const newlyApplied: string[] = [];

  for (const file of files) {
    if (applied.has(file)) continue;

    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const apply = db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(
        file,
        new Date().toISOString()
      );
    });

    apply();
    newlyApplied.push(file);
  }

  return { applied: newlyApplied };
}
