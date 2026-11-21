import { input, password as passwordPrompt } from '@inquirer/prompts';
import { config } from '../config.js';
import { createUser, findUserByUsername } from '../db/users.js';
import { openDatabase, runMigrations } from '../db/index.js';
import { hashPassword } from '../lib/security.js';
import { nowIso } from '../lib/time.js';
import { passwordProblem } from './password.js';

const db = openDatabase(config.dbPath);

try {
  runMigrations(db, config.migrationsDir);

  const username = (
    await input({
      message: 'Логин администратора (латиница, цифры, . _ -):',
      validate: (value) =>
        /^[a-zA-Z0-9_.-]{3,64}$/.test(value) ? true : 'От 3 до 64 символов: a-z A-Z 0-9 . _ -'
    })
  ).trim();

  if (findUserByUsername(db, username)) {
    console.error('Пользователь с таким логином уже существует. Используйте npm run admin:reset');
    process.exit(1);
  }

  const once = await passwordPrompt({ message: 'Пароль:', mask: '*' });
  const problem = passwordProblem(once, username);
  if (problem) {
    console.error(problem);
    process.exit(1);
  }

  const twice = await passwordPrompt({ message: 'Повторите пароль:', mask: '*' });
  if (once !== twice) {
    console.error('Пароли не совпадают');
    process.exit(1);
  }

  const hash = await hashPassword(once);
  const user = createUser(db, username, hash, nowIso());
  console.info(`Администратор "${user.username}" создан (id ${user.id}).`);
} finally {
  db.close();
}
