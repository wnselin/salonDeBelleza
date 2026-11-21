import type { AdminUser } from '../types.js';
import type { Db } from './index.js';

interface UserRow {
  id: number;
  username: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

export interface UserWithHash extends AdminUser {
  passwordHash: string;
}

function toUser(row: UserRow): UserWithHash {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash
  };
}

export function findUserByUsername(db: Db, username: string): UserWithHash | null {
  const row = db
    .prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE')
    .get(username) as UserRow | undefined;
  return row ? toUser(row) : null;
}

export function findUserById(db: Db, id: number): AdminUser | null {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  return row ? { id: row.id, username: row.username } : null;
}

export function createUser(
  db: Db,
  username: string,
  passwordHash: string,
  nowIso: string
): AdminUser {
  const result = db
    .prepare(
      'INSERT INTO users (username, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?)'
    )
    .run(username, passwordHash, nowIso, nowIso);
  return { id: Number(result.lastInsertRowid), username };
}

export function updateUserPassword(
  db: Db,
  userId: number,
  passwordHash: string,
  nowIso: string
): boolean {
  const result = db
    .prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?')
    .run(passwordHash, nowIso, userId);
  return result.changes > 0;
}

export function countUsers(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  return row.count;
}
