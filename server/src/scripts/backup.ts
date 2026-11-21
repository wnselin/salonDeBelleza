import { config } from '../config.js';
import { openDatabase } from '../db/index.js';
import { createEncryptedBackup } from '../lib/backup.js';

if (!config.backupKey) {
  console.error('BACKUP_KEY is not set');
  process.exit(1);
}

const db = openDatabase(config.dbPath);

try {
  const result = createEncryptedBackup(db, {
    backupDir: config.backupDir,
    keyHex: config.backupKey,
    retentionDays: config.backupRetentionDays
  });
  console.info(`Backup created: ${result.file} (${result.bytes} bytes)`);
} finally {
  db.close();
}
