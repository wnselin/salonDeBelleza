import type { Db } from './index.js';

export interface SessionRecord {
  tokenHash: string;
  userId: number;
  username: string;
  csrfToken: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: string;
}

interface SessionRow {
  token_hash: string;
  user_id: number;
  username: string;
  csrf_token: string;
  created_at: string;
  last_seen_at: string;
  expires_at: string;
  revoked_at: string | null;
}

export function createSession(
  db: Db,
  session: {
    tokenHash: string;
    userId: number;
    csrfToken: string;
    createdAt: string;
    expiresAt: string;
  }
): void {
  db.prepare(
    `INSERT INTO sessions (token_hash, user_id, csrf_token, created_at, last_seen_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(
    session.tokenHash,
    session.userId,
    session.csrfToken,
    session.createdAt,
    session.createdAt,
    session.expiresAt
  );
}

export function findSession(db: Db, tokenHash: string): SessionRecord | null {
  const row = db
    .prepare(
      `SELECT s.token_hash, s.user_id, u.username, s.csrf_token,
              s.created_at, s.last_seen_at, s.expires_at, s.revoked_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?`
    )
    .get(tokenHash) as SessionRow | undefined;

  if (!row || row.revoked_at) return null;

  return {
    tokenHash: row.token_hash,
    userId: row.user_id,
    username: row.username,
    csrfToken: row.csrf_token,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    expiresAt: row.expires_at
  };
}

export function touchSession(db: Db, tokenHash: string, lastSeenAt: string): void {
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?').run(
    lastSeenAt,
    tokenHash
  );
}

export function revokeSession(db: Db, tokenHash: string, revokedAt: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL').run(
    revokedAt,
    tokenHash
  );
}

export function revokeAllUserSessions(db: Db, userId: number, revokedAt: string): void {
  db.prepare('UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(
    revokedAt,
    userId
  );
}

export function deleteExpiredSessions(db: Db, nowIso: string): number {
  const result = db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(nowIso);
  return result.changes;
}
