import { config } from '../config.js';
import { openDatabase, runMigrations } from '../db/index.js';

const db = openDatabase(config.dbPath);
try {
  const result = runMigrations(db, config.migrationsDir);
  if (result.applied.length) {
    console.info(`Applied: ${result.applied.join(', ')}`);
  } else {
    console.info('Database is up to date');
  }
} finally {
  db.close();
}
