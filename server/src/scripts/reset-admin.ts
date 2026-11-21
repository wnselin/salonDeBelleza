import { input, password as passwordPrompt } from '@inquirer/prompts';
import { config } from '../config.js';
import { findUserByUsername, updateUserPassword } from '../db/users.js';
import { revokeAllUserSessions } from '../db/sessions.js';
import { openDatabase, runMigrations } from '../db/index.js';
import { hashPassword } from '../lib/security.js';
import { nowIso } from '../lib/time.js';
import { passwordProblem } from './password.js';

const db = openDatabase(config.dbPath);

try {
  runMigrations(db, config.migrationsDir);

  const username = (
    await input({ message: 'Логин администратора:' })
  ).trim();

  const user = findUserByUsername(db, username);
  if (!user) {
    console.error('Пользователь не найден');
    process.exit(1);
  }

  const once = await passwordPrompt({ message: 'Новый пароль:', mask: '*' });
  const problem = passwordProblem(once, user.username);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  const twice = await passwordPrompt({ message: 'Повторите пароль:', mask: '*' });
  if (once !== twice) {
    console.error('Пароли не совпадают');
    process.exit(1);
  }

  const now = nowIso();
  updateUserPassword(db, user.id, await hashPassword(once), now);
  revokeAllUserSessions(db, user.id, now);
  console.info(`Пароль обновлён, все сессии пользователя "${user.username}" завершены.`);
} finally {
  db.close();
}
