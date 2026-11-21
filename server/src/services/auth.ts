import type { FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { createSession, findSession, revokeSession, touchSession } from '../db/sessions.js';
import type { Db } from '../db/index.js';
import { generateHexToken, generateToken, originOf, safeEqual, sha256Hex } from '../lib/security.js';
import { nowIso } from '../lib/time.js';

export interface AuthContext {
  userId: number;
  username: string;
  tokenHash: string;
  csrfToken: string;
  lastSeenAt: string;
  expiresAt: string;
}

export interface IssuedSession {
  token: string;
  tokenHash: string;
  csrfToken: string;
  expiresAt: string;
}

export function issueSession(db: Db, userId: number): IssuedSession {
  const token = generateToken(32);
  const tokenHash = sha256Hex(token);
  const csrfToken = generateHexToken(32);
  const createdAt = nowIso();
  const expiresAt = new Date(Date.now() + config.sessionAbsoluteMs).toISOString();

  createSession(db, { tokenHash, userId, csrfToken, createdAt, expiresAt });

  return { token, tokenHash, csrfToken, expiresAt };
}

export function resolveSession(db: Db, token: string): AuthContext | null {
  const tokenHash = sha256Hex(token);
  const session = findSession(db, tokenHash);
  if (!session) return null;

  const now = Date.now();
  const idleDeadline = Date.parse(session.lastSeenAt) + config.sessionIdleMs;
  const absoluteDeadline = Date.parse(session.expiresAt);

  if (now >= idleDeadline || now >= absoluteDeadline) {
    revokeSession(db, tokenHash, nowIso());
    return null;
  }

  // Throttle writes: refreshing the idle timer once a minute is enough.
  if (now - Date.parse(session.lastSeenAt) > 60_000) {
    touchSession(db, tokenHash, nowIso());
  }

  return {
    userId: session.userId,
    username: session.username,
    tokenHash,
    csrfToken: session.csrfToken,
    lastSeenAt: session.lastSeenAt,
    expiresAt: session.expiresAt
  };
}

export function logoutSession(db: Db, tokenHash: string): void {
  revokeSession(db, tokenHash, nowIso());
}

/** Request must come from our own origin (Origin, or Referer as a fallback). */
export function isSameOrigin(request: FastifyRequest): boolean {
  const origin = originOf(request.headers.origin);
  if (origin) return origin === config.appOrigin;

  const referer = originOf(request.headers.referer);
  if (referer) return referer === config.appOrigin;

  return false;
}

export function hasValidCsrf(request: FastifyRequest, expected: string): boolean {
  const provided = request.headers[config.csrfHeader];
  if (typeof provided !== 'string' || provided.length < 32) return false;
  return safeEqual(provided, expected);
}

/* ---------- Login throttling (single instance, in-memory) ---------- */

interface AttemptState {
  count: number;
  windowStartedAt: number;
  blockedUntil: number;
}

const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;

const attempts = new Map<string, AttemptState>();

export function loginThrottleKey(request: FastifyRequest, username: string): string {
  return `${request.ip}|${username.toLocaleLowerCase('ru-RU')}`;
}

export function checkLoginAllowed(key: string): { allowed: boolean; retryAfterSec: number } {
  const state = attempts.get(key);
  const now = Date.now();
  if (!state) return { allowed: true, retryAfterSec: 0 };

  if (state.blockedUntil > now) {
    return { allowed: false, retryAfterSec: Math.ceil((state.blockedUntil - now) / 1000) };
  }

  if (now - state.windowStartedAt > WINDOW_MS) {
    attempts.delete(key);
    return { allowed: true, retryAfterSec: 0 };
  }

  return { allowed: true, retryAfterSec: 0 };
}

export function recordLoginFailure(key: string): void {
  const now = Date.now();
  const state = attempts.get(key);

  if (!state || now - state.windowStartedAt > WINDOW_MS) {
    attempts.set(key, { count: 1, windowStartedAt: now, blockedUntil: 0 });
    return;
  }

  state.count += 1;
  if (state.count >= MAX_ATTEMPTS) {
    state.blockedUntil = now + BLOCK_MS;
  }
}

export function clearLoginFailures(key: string): void {
  attempts.delete(key);
}

/** Removes stale throttle records to keep memory bounded. */
export function pruneLoginThrottle(): void {
  const now = Date.now();
  for (const [key, state] of attempts) {
    const expired =
      state.blockedUntil < now && now - state.windowStartedAt > WINDOW_MS;
    if (expired) attempts.delete(key);
  }
}
