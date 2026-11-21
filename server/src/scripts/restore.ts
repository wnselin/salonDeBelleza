import fs from 'node:fs';
import path from 'node:path';
import { confirm } from '@inquirer/prompts';
import { config } from '../config.js';
import { decryptBackup, verifySqliteFile } from '../lib/backup.js';

const inputFile = process.argv[2];

if (!inputFile) {
  console.error('Использование: npm run restore -- /path/to/backup.db.enc');
  process.exit(1);
}

if (!config.backupKey) {
  console.error('BACKUP_KEY is not set');
  process.exit(1);
}

if (!fs.existsSync(inputFile)) {
  console.error('Файл бэкапа не найден');
  process.exit(1);
}

if (config.isProduction) {
  console.warn('ВНИМАНИЕ: остановите приложение перед восстановлением базы.');
}

const proceed = await confirm({
  message: `Заменить текущую базу ${config.dbPath} данными из ${inputFile}?`,
  default: false
});

if (!proceed) {
  console.info('Отменено');
  process.exit(0);
}

const tempFile = path.join(config.dataDir, `.restore-${Date.now()}.db`);

try {
  decryptBackup(path.resolve(inputFile), tempFile, config.backupKey);
  verifySqliteFile(tempFile);

  if (fs.existsSync(config.dbPath)) {
    const safety = `${config.dbPath}.before-restore-${Date.now()}`;
    fs.copyFileSync(config.dbPath, safety);
    console.info(`Текущая база сохранена: ${safety}`);
  }

  fs.copyFileSync(tempFile, config.dbPath);
  for (const suffix of ['-wal', '-shm']) {
    fs.rmSync(`${config.dbPath}${suffix}`, { force: true });
  }
  console.info('База восстановлена. Запустите приложение.');
} finally {
  fs.rmSync(tempFile, { force: true });
}
