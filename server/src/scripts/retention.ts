import { config } from '../config.js';
import { openDatabase } from '../db/index.js';
import { deleteExpiredBookings } from '../db/bookings.js';
import { deleteExpiredSessions } from '../db/sessions.js';
import { deleteOldAudit } from '../db/audit.js';
import { nowIso } from '../lib/time.js';

const db = openDatabase(config.dbPath);

try {
  const now = nowIso();
  const bookings = deleteExpiredBookings(db, now);
  const sessions = deleteExpiredSessions(db, now);
  const auditCutoff = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();
  const audit = deleteOldAudit(db, auditCutoff);

  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.exec('VACUUM');

  console.info(`Retention done: bookings=${bookings}, sessions=${sessions}, audit=${audit}`);
} finally {
  db.close();
}
