import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { findUserByUsername } from '../db/users.js';
import type { Db } from '../db/index.js';
import type { AuthContext } from '../services/auth.js';
import {
  clearLoginFailures,
  checkLoginAllowed,
  hasValidCsrf,
  isSameOrigin,
  issueSession,
  loginThrottleKey,
  logoutSession,
  recordLoginFailure,
  resolveSession
} from '../services/auth.js';
import { burnPasswordTime, verifyPassword } from '../lib/security.js';
import { adminLoginSchema } from '../lib/validation.js';
import { nowIso } from '../lib/time.js';
import { writeAudit } from '../db/audit.js';

declare module 'fastify' {
  interface FastifyRequest {
    admin?: AuthContext;
  }
}

export function sendError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string
): FastifyReply {
  return reply.code(statusCode).send({ error: { code, message } });
}

export function readSessionToken(request: FastifyRequest): string | null {
  const value = request.cookies[config.cookieName];
  return typeof value === 'string' && value.length > 20 ? value : null;
}

/**
 * Pre-handler factory. With csrf=true it also enforces same-origin and a
 * valid CSRF header for state-changing requests.
 */
export function requireAdmin(db: Db, options: { csrf?: boolean } = {}) {
  return async function preHandler(
    request: FastifyRequest,
    reply: FastifyReply
  ): Promise<void> {
    const token = readSessionToken(request);
    if (!token) {
      await sendError(reply, 401, 'unauthorized', 'Требуется вход');
      return;
    }

    const session = resolveSession(db, token);
    if (!session) {
      reply.clearCookie(config.cookieName, { path: '/' });
      await sendError(reply, 401, 'unauthorized', 'Сессия истекла');
      return;
    }

    if (options.csrf) {
      if (!isSameOrigin(request)) {
        await sendError(reply, 403, 'forbidden', 'Запрос отклонён');
        return;
      }
      if (!hasValidCsrf(request, session.csrfToken)) {
        await sendError(reply, 403, 'csrf', 'Неверный CSRF-токен');
        return;
      }
    }

    request.admin = session;
  };
}

export function setSessionCookie(reply: FastifyReply, token: string): void {
  reply.setCookie(config.cookieName, token, {
    path: '/',
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: 'strict',
    maxAge: Math.floor(config.sessionAbsoluteMs / 1000)
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(config.cookieName, { path: '/', httpOnly: true, sameSite: 'strict' });
}

export async function handleLogin(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!isSameOrigin(request)) {
    await sendError(reply, 403, 'forbidden', 'Запрос отклонён');
    return;
  }

  const parsed = adminLoginSchema.safeParse(request.body);
  if (!parsed.success) {
    await sendError(reply, 400, 'invalid_input', 'Проверьте логин и пароль');
    return;
  }

  const { username, password } = parsed.data;
  const throttleKey = loginThrottleKey(request, username);
  const throttle = checkLoginAllowed(throttleKey);

  if (!throttle.allowed) {
    reply.header('Retry-After', String(throttle.retryAfterSec));
    await sendError(reply, 429, 'too_many_requests', 'Слишком много попыток, попробуйте позже');
    return;
  }

  const user = findUserByUsername(db, username);

  if (!user) {
    await burnPasswordTime(password);
    recordLoginFailure(throttleKey);
    await sendError(reply, 401, 'invalid_credentials', 'Неверный логин или пароль');
    return;
  }

  const valid = await verifyPassword(user.passwordHash, password);

  if (!valid) {
    recordLoginFailure(throttleKey);
    writeAudit(
      db,
      { actorId: null, action: 'login_failed', entity: 'user', entityId: String(user.id) },
      nowIso()
    );
    await sendError(reply, 401, 'invalid_credentials', 'Неверный логин или пароль');
    return;
  }

  clearLoginFailures(throttleKey);
  const session = issueSession(db, user.id);
  setSessionCookie(reply, session.token);
  writeAudit(
    db,
    { actorId: user.id, action: 'login', entity: 'user', entityId: String(user.id) },
    nowIso()
  );

  await reply.send({
    ok: true,
    user: { id: user.id, username: user.username },
    csrfToken: session.csrfToken
  });
}

export async function handleLogout(
  db: Db,
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  const admin = request.admin;
  if (admin) {
    logoutSession(db, admin.tokenHash);
    writeAudit(
      db,
      { actorId: admin.userId, action: 'logout', entity: 'user', entityId: String(admin.userId) },
      nowIso()
    );
  }
  clearSessionCookie(reply);
  await reply.send({ ok: true });
}
