import { config } from './config.js';
import { buildApp } from './app.js';
import { openDatabase, runMigrations } from './db/index.js';
import { deleteExpiredBookings } from './db/bookings.js';
import { deleteExpiredSessions } from './db/sessions.js';
import { deleteOldAudit } from './db/audit.js';
import { pruneLoginThrottle } from './services/auth.js';
import { nowIso } from './lib/time.js';

async function main(): Promise<void> {
  const db = openDatabase(config.dbPath);
  const migrations = runMigrations(db, config.migrationsDir);

  if (migrations.applied.length) {
    console.info(`Applied migrations: ${migrations.applied.join(', ')}`);
  }

  const app = await buildApp(db);

  const maintenance = setInterval(() => {
    try {
      const now = nowIso();
      const removedBookings = deleteExpiredBookings(db, now);
      const removedSessions = deleteExpiredSessions(db, now);
      const auditCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
      const removedAudit = deleteOldAudit(db, auditCutoff);

      pruneLoginThrottle();

      if (removedBookings > 0) {
        // secure_delete wipes pages; VACUUM compacts the file after deletions.
        db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
        db.exec('VACUUM');
      }

      if (removedBookings || removedSessions || removedAudit) {
        console.info(
          `Maintenance: bookings=${removedBookings}, sessions=${removedSessions}, audit=${removedAudit}`
        );
      }
    } catch (error) {
      console.error('Maintenance failed', error);
    }
  }, 6 * 60 * 60 * 1000);

  maintenance.unref();

  const shutdown = async (signal: string): Promise<void> => {
    console.info(`Received ${signal}, shutting down`);
    clearInterval(maintenance);
    try {
      await app.close();
    } finally {
      db.close();
    }
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ host: config.host, port: config.port });
  console.info(`Listening on http://${config.host}:${config.port} (${config.env})`);
}

main().catch((error) => {
  console.error('Fatal startup error', error);
  process.exit(1);
});
