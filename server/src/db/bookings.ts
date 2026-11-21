import type { AdminBooking, BookingCounts, BookingListResult, BookingStatus } from '../types.js';
import type { AdminListQuery } from '../lib/validation.js';
import type { Db } from './index.js';

interface BookingRow {
  id: number;
  name: string;
  phone: string;
  phone_normalized: string;
  service_category: string | null;
  service: string | null;
  preferred_date: string | null;
  comment: string | null;
  status: BookingStatus;
  created_at: string;
  updated_at: string;
}

export interface NewBooking {
  name: string;
  phone: string;
  phoneNormalized: string;
  serviceCategory: string | null;
  service: string | null;
  preferredDate: string | null;
  comment: string | null;
  consentAt: string;
  consentVersion: string;
  createdAt: string;
  expiresAt: string;
}

export function normalizeSearchText(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function toAdminBooking(row: BookingRow): AdminBooking {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    serviceCategory: row.service_category,
    service: row.service,
    preferredDate: row.preferred_date,
    comment: row.comment,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

export function createBooking(db: Db, booking: NewBooking): AdminBooking {
  const searchText = normalizeSearchText(
    [
      booking.name,
      booking.phone,
      booking.phoneNormalized,
      booking.service ?? '',
      booking.serviceCategory ?? ''
    ].join(' ')
  );

  const result = db
    .prepare(
      `INSERT INTO bookings (
        name, phone, phone_normalized, service_category, service,
        preferred_date, comment, consent_at, consent_version, search_text,
        created_at, updated_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      booking.name,
      booking.phone,
      booking.phoneNormalized,
      booking.serviceCategory,
      booking.service,
      booking.preferredDate,
      booking.comment,
      booking.consentAt,
      booking.consentVersion,
      searchText,
      booking.createdAt,
      booking.createdAt,
      booking.expiresAt
    );

  const id = Number(result.lastInsertRowid);
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as BookingRow;
  return toAdminBooking(row);
}

/** Detects an identical phone+service submission inside the window. */
export function findRecentDuplicate(
  db: Db,
  phoneNormalized: string,
  service: string | null,
  sinceIso: string
): number | null {
  const row = db
    .prepare(
      `SELECT id FROM bookings
       WHERE phone_normalized = ? AND COALESCE(service, '') = ? AND created_at >= ?
       ORDER BY id DESC LIMIT 1`
    )
    .get(phoneNormalized, service ?? '', sinceIso) as { id: number } | undefined;
  return row?.id ?? null;
}

export function getBooking(db: Db, id: number): AdminBooking | null {
  const row = db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as BookingRow | undefined;
  return row ? toAdminBooking(row) : null;
}

export function countBookings(db: Db): BookingCounts {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN status = 'new' THEN 1 ELSE 0 END), 0) AS new
       FROM bookings`
    )
    .get() as { total: number; new: number };
  return { total: row.total, new: row.new };
}

export function listBookings(db: Db, query: AdminListQuery): BookingListResult {
  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (query.status) {
    conditions.push('status = ?');
    params.push(query.status);
  }

  if (query.q) {
    const normalized = normalizeSearchText(query.q);
    if (normalized) {
      conditions.push("search_text LIKE ? ESCAPE '\\'");
      params.push(`%${escapeLike(normalized)}%`);
    }
  }

  if (query.beforeId) {
    conditions.push('id < ?');
    params.push(query.beforeId);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(`SELECT * FROM bookings ${where} ORDER BY id DESC LIMIT ?`)
    .all(...params, query.limit) as BookingRow[];

  const items = rows.map(toAdminBooking);
  const nextBeforeId = items.length === query.limit ? items[items.length - 1]!.id : null;

  return { items, nextBeforeId, counts: countBookings(db) };
}

export function updateBookingStatus(
  db: Db,
  id: number,
  status: BookingStatus,
  updatedAt: string
): AdminBooking | null {
  const result = db
    .prepare('UPDATE bookings SET status = ?, updated_at = ? WHERE id = ?')
    .run(status, updatedAt, id);
  if (result.changes === 0) return null;
  return getBooking(db, id);
}

export function deleteBooking(db: Db, id: number): boolean {
  const result = db.prepare('DELETE FROM bookings WHERE id = ?').run(id);
  return result.changes > 0;
}

export function deleteExpiredBookings(db: Db, nowIso: string): number {
  const result = db.prepare('DELETE FROM bookings WHERE expires_at <= ?').run(nowIso);
  return result.changes;
}
