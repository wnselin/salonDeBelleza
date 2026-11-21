import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addDaysToIsoDate, todayInSalonTimeZone } from '../src/lib/time.js';
import { adminListQuerySchema } from '../src/lib/validation.js';
import { listBookings } from '../src/db/bookings.js';
import {
  bookingPayload,
  closeApp,
  makeApp,
  nextIp,
  type TestContext
} from './helpers.js';

let context: TestContext;

beforeAll(async () => {
  context = await makeApp();
});

afterAll(async () => {
  await closeApp(context);
});

async function postBooking(payload: Record<string, unknown>, ip = nextIp()) {
  return context.app.inject({
    method: 'POST',
    url: '/api/bookings',
    headers: { 'content-type': 'application/json' },
    payload,
    remoteAddress: ip
  });
}

describe('POST /api/bookings', () => {
  it('creates a booking and stores consent metadata', async () => {
    const response = await postBooking(bookingPayload());
    expect(response.statusCode).toBe(201);
    expect(response.json()).toEqual({ ok: true });

    const row = context.db
      .prepare('SELECT * FROM bookings ORDER BY id DESC LIMIT 1')
      .get() as {
      name: string;
      phone: string;
      phone_normalized: string;
      consent_at: string;
      consent_version: string;
      expires_at: string;
      created_at: string;
    };

    expect(row.name).toBe('Иван Петров');
    expect(row.phone_normalized).toBe('+79141234567');
    expect(row.consent_version).toBe('test-2026-11-04');
    expect(Date.parse(row.consent_at)).toBeGreaterThan(0);

    const lifetimeDays =
      (Date.parse(row.expires_at) - Date.parse(row.created_at)) / (24 * 60 * 60 * 1000);
    expect(Math.round(lifetimeDays)).toBe(90);
  });

  it('rejects bookings without consent', async () => {
    const response = await postBooking(bookingPayload({ consent: false }));
    expect(response.statusCode).toBe(400);
    const body = response.json() as { fields: Record<string, string> };
    expect(body.fields.consent).toMatch(/согласие/i);
  });

  it('rejects medical categories submitted directly to the API', async () => {
    for (const category of ['cosmetology', 'traumatology']) {
      const response = await postBooking(
        bookingPayload({ serviceCategory: category, service: 'Медицинская услуга' })
      );
      expect(response.statusCode).toBe(400);
      const body = response.json() as { fields: Record<string, string> };
      expect(body.fields.serviceCategory).toMatch(/только запись по телефону/i);
    }
  });

  it('rejects an invalid phone number', async () => {
    const response = await postBooking(bookingPayload({ phone: '12345' }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects a date in the past', async () => {
    const yesterday = addDaysToIsoDate(todayInSalonTimeZone(), -1);
    const response = await postBooking(bookingPayload({ preferredDate: yesterday }));
    expect(response.statusCode).toBe(400);
  });

  it('rejects a date more than a year ahead', async () => {
    const far = addDaysToIsoDate(todayInSalonTimeZone(), 400);
    const response = await postBooking(bookingPayload({ preferredDate: far }));
    expect(response.statusCode).toBe(400);
  });

  it('silently drops honeypot submissions', async () => {
    const before = (context.db.prepare('SELECT COUNT(*) AS c FROM bookings').get() as { c: number }).c;
    const response = await postBooking(
      bookingPayload({ phone: '+7 (914) 999-99-01', website: 'https://spam.example' })
    );
    expect(response.statusCode).toBe(201);
    const after = (context.db.prepare('SELECT COUNT(*) AS c FROM bookings').get() as { c: number }).c;
    expect(after).toBe(before);
  });

  it('does not create a duplicate within the window', async () => {
    const first = await postBooking(
      bookingPayload({ phone: '+7 (914) 999-99-02', service: 'Маникюр — Маникюр аппаратный' })
    );
    const second = await postBooking(
      bookingPayload({ phone: '+7 (914) 999-99-02', service: 'Маникюр — Маникюр аппаратный' })
    );
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);

    const count = context.db
      .prepare("SELECT COUNT(*) AS c FROM bookings WHERE phone_normalized = '+79149999902'")
      .get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('stores markup as text and never returns HTML', async () => {
    const payload = bookingPayload({
      name: '<script>alert(1)</script>',
      phone: '+7 (914) 999-99-03',
      service: '<img src=x onerror=alert(1)>',
      comment: '<svg onload=alert(1)>'
    });

    const response = await postBooking(payload);
    expect(response.statusCode).toBe(201);
    expect(response.headers['content-type']).toMatch(/application\/json/);

    const row = context.db
      .prepare("SELECT name, service, comment FROM bookings WHERE phone_normalized = '+79149999903'")
      .get() as { name: string; service: string; comment: string };

    expect(row.name).toBe('<script>alert(1)</script>');
    expect(row.service).toBe('<img src=x onerror=alert(1)>');
    expect(row.comment).toBe('<svg onload=alert(1)>');
  });

  it('does not let SQL injection in a name alter other rows', async () => {
    const before = (context.db.prepare('SELECT COUNT(*) AS c FROM bookings').get() as { c: number }).c;
    const response = await postBooking(
      bookingPayload({
        name: "Robert'); DROP TABLE bookings;--",
        phone: '+7 (914) 999-99-04'
      })
    );
    expect(response.statusCode).toBe(201);

    const after = (context.db.prepare('SELECT COUNT(*) AS c FROM bookings').get() as { c: number }).c;
    expect(after).toBe(before + 1);

    const row = context.db
      .prepare("SELECT name FROM bookings WHERE phone_normalized = '+79149999904'")
      .get() as { name: string };
    expect(row.name).toBe("Robert'); DROP TABLE bookings;--");
  });

  it('applies a per-IP rate limit', async () => {
    const ip = '203.0.113.77';
    const statuses: number[] = [];

    for (let index = 0; index < 6; index += 1) {
      const response = await postBooking(
        bookingPayload({ phone: `+7 (914) 888-77-${String(index).padStart(2, '0')}` }),
        ip
      );
      statuses.push(response.statusCode);
    }

    expect(statuses.slice(0, 5).every((status) => status === 201)).toBe(true);
    expect(statuses[5]).toBe(429);
  });
});

describe('search safety', () => {
  it('treats SQL metacharacters as literal text', async () => {
    const query = adminListQuerySchema.parse({ q: "' OR 1=1 --", limit: 30 });
    const result = listBookings(context.db, query);
    expect(result.items).toEqual([]);
  });

  it('escapes LIKE wildcards', async () => {
    const query = adminListQuerySchema.parse({ q: '%', limit: 30 });
    const result = listBookings(context.db, query);
    expect(result.items).toEqual([]);
  });
});
