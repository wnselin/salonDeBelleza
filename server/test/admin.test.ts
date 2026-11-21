import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  ADMIN_PASSWORD,
  ADMIN_USERNAME,
  TEST_ORIGIN,
  bookingPayload,
  closeApp,
  login,
  makeApp,
  nextIp,
  type TestContext
} from './helpers.js';

let context: TestContext;
let cookie = '';
let csrfToken = '';
let bookingId = 0;

beforeAll(async () => {
  context = await makeApp();

  const created = await context.app.inject({
    method: 'POST',
    url: '/api/bookings',
    headers: { 'content-type': 'application/json' },
    payload: bookingPayload({ phone: '+7 (914) 555-44-33' }),
    remoteAddress: nextIp()
  });
  expect(created.statusCode).toBe(201);

  const row = context.db.prepare('SELECT id FROM bookings ORDER BY id DESC LIMIT 1').get() as {
    id: number;
  };
  bookingId = row.id;

  const session = await login(context.app);
  cookie = session.cookie;
  csrfToken = session.csrfToken;
});

afterAll(async () => {
  await closeApp(context);
});

describe('admin authentication', () => {
  it('rejects unauthenticated access', async () => {
    const response = await context.app.inject({ method: 'GET', url: '/api/admin/bookings' });
    expect(response.statusCode).toBe(401);
  });

  it('rejects a wrong password with a generic message', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin: TEST_ORIGIN },
      payload: { username: ADMIN_USERNAME, password: 'definitely-wrong' },
      remoteAddress: '10.20.0.1'
    });

    expect(response.statusCode).toBe(401);
    expect(response.body).not.toMatch(/пользователь|не найден/i);
  });

  it('rejects login from a foreign origin', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin: 'https://evil.example' },
      payload: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
      remoteAddress: '10.20.0.2'
    });

    expect(response.statusCode).toBe(403);
  });

  it('issues a hardened session cookie and CSRF token', async () => {
    const session = await login(context.app, '10.20.0.3');
    expect(session.statusCode).toBe(200);
    expect(session.csrfToken).toHaveLength(64);

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/admin/login',
      headers: { origin: TEST_ORIGIN },
      payload: { username: ADMIN_USERNAME, password: ADMIN_PASSWORD },
      remoteAddress: '10.20.0.4'
    });

    const sessionCookie = response.cookies.find((item) => item.name === 'salon_admin');
    expect(sessionCookie).toBeTruthy();
    expect(sessionCookie?.httpOnly).toBe(true);
    expect(sessionCookie?.sameSite).toBe('Strict');
  });

  it('returns session data for an authenticated request', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/admin/session',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      user: { username: ADMIN_USERNAME },
      csrfToken
    });
  });

  it('blocks a burst of failed logins', async () => {
    const ip = '10.20.0.9';
    const statuses: number[] = [];

    for (let index = 0; index < 11; index += 1) {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/admin/login',
        headers: { origin: TEST_ORIGIN },
        payload: { username: ADMIN_USERNAME, password: `wrong-${index}` },
        remoteAddress: ip
      });
      statuses.push(response.statusCode);
    }

    expect(statuses[10]).toBe(429);
  });
});

describe('admin bookings API', () => {
  it('lists bookings with counts', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/admin/bookings?limit=10',
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as {
      items: Array<{ id: number; name: string; phone: string }>;
      counts: { total: number; new: number };
    };
    expect(body.items.length).toBeGreaterThan(0);
    expect(body.counts.total).toBe(body.items.length);
    expect(body.items[0]).toHaveProperty('name');
  });

  it('rejects status changes without CSRF', async () => {
    const response = await context.app.inject({
      method: 'PATCH',
      url: `/api/admin/bookings/${bookingId}`,
      headers: { cookie, origin: TEST_ORIGIN },
      payload: { status: 'contacted' }
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects status changes from a foreign origin', async () => {
    const response = await context.app.inject({
      method: 'PATCH',
      url: `/api/admin/bookings/${bookingId}`,
      headers: {
        cookie,
        origin: 'https://evil.example',
        'x-csrf-token': csrfToken
      },
      payload: { status: 'contacted' }
    });

    expect(response.statusCode).toBe(403);
  });

  it('rejects an unknown status value', async () => {
    const response = await context.app.inject({
      method: 'PATCH',
      url: `/api/admin/bookings/${bookingId}`,
      headers: { cookie, origin: TEST_ORIGIN, 'x-csrf-token': csrfToken },
      payload: { status: 'hacked' }
    });

    expect(response.statusCode).toBe(400);
  });

  it('updates a status and writes an audit entry without personal data', async () => {
    const response = await context.app.inject({
      method: 'PATCH',
      url: `/api/admin/bookings/${bookingId}`,
      headers: { cookie, origin: TEST_ORIGIN, 'x-csrf-token': csrfToken },
      payload: { status: 'contacted' }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { booking: { status: string } };
    expect(body.booking.status).toBe('contacted');

    const audit = context.db
      .prepare(
        "SELECT meta_json, entity_id FROM audit_log WHERE action = 'booking_status_changed' ORDER BY id DESC LIMIT 1"
      )
      .get() as { meta_json: string; entity_id: string };

    expect(audit.entity_id).toBe(String(bookingId));
    expect(audit.meta_json).toContain('contacted');
    expect(audit.meta_json).not.toMatch(/Иван|\+7914/);
  });

  it('treats SQL injection in search as text', async () => {
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/admin/bookings',
      query: { q: "' OR 1=1 --", limit: '10' },
      headers: { cookie }
    });

    expect(response.statusCode).toBe(200);
    const body = response.json() as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it('deletes a booking and records the action', async () => {
    const response = await context.app.inject({
      method: 'DELETE',
      url: `/api/admin/bookings/${bookingId}`,
      headers: { cookie, origin: TEST_ORIGIN, 'x-csrf-token': csrfToken }
    });

    expect(response.statusCode).toBe(200);
    const row = context.db.prepare('SELECT id FROM bookings WHERE id = ?').get(bookingId);
    expect(row).toBeUndefined();

    const audit = context.db
      .prepare(
        "SELECT entity_id FROM audit_log WHERE action = 'booking_deleted' ORDER BY id DESC LIMIT 1"
      )
      .get() as { entity_id: string };
    expect(audit.entity_id).toBe(String(bookingId));
  });

  it('rejects a session whose absolute expiry has passed', async () => {
    const session = await login(context.app, '10.20.0.10');
    context.db
      .prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?')
      .run(
        new Date(Date.now() - 1000).toISOString(),
        context.db
          .prepare('SELECT token_hash FROM sessions ORDER BY rowid DESC LIMIT 1')
          .pluck()
          .get()
      );

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/admin/bookings',
      headers: { cookie: session.cookie }
    });

    expect(response.statusCode).toBe(401);
  });

  it('revokes the session on logout', async () => {
    const session = await login(context.app, '10.20.0.11');

    const logout = await context.app.inject({
      method: 'POST',
      url: '/api/admin/logout',
      headers: {
        cookie: session.cookie,
        origin: TEST_ORIGIN,
        'x-csrf-token': session.csrfToken
      }
    });
    expect(logout.statusCode).toBe(200);

    const after = await context.app.inject({
      method: 'GET',
      url: '/api/admin/bookings',
      headers: { cookie: session.cookie }
    });
    expect(after.statusCode).toBe(401);
  });
});
