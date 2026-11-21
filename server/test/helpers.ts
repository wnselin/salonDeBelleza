import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../src/app.js';
import { openDatabase, runMigrations, type Db } from '../src/db/index.js';
import { createUser } from '../src/db/users.js';
import { hashPassword } from '../src/lib/security.js';
import { addDaysToIsoDate, todayInSalonTimeZone } from '../src/lib/time.js';

export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'TestPassword-2026!';
export const TEST_ORIGIN = 'http://localhost:3000';

export interface TestContext {
  app: FastifyInstance;
  db: Db;
}

export async function makeApp(): Promise<TestContext> {
  const db = openDatabase(':memory:');
  runMigrations(db, path.resolve('migrations'));

  const app = await buildApp(db, { logger: false });

  const hash = await hashPassword(ADMIN_PASSWORD);
  createUser(db, ADMIN_USERNAME, hash, new Date().toISOString());

  return { app, db };
}

export interface LoginResult {
  cookie: string;
  csrfToken: string;
  statusCode: number;
}

export async function login(
  app: FastifyInstance,
  remoteAddress = '10.10.0.1',
  password = ADMIN_PASSWORD
): Promise<LoginResult> {
  const response = await app.inject({
    method: 'POST',
    url: '/api/admin/login',
    headers: { origin: TEST_ORIGIN },
    payload: { username: ADMIN_USERNAME, password },
    remoteAddress
  });

  const cookie = response.cookies.map((item) => `${item.name}=${item.value}`).join('; ');
  const body = response.json() as { csrfToken?: string };

  return {
    cookie,
    csrfToken: body.csrfToken ?? '',
    statusCode: response.statusCode
  };
}

export function bookingPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: 'Иван Петров',
    phone: '+7 (914) 123-45-67',
    serviceCategory: 'manicure',
    service: 'Маникюр — Маникюр аппаратный',
    preferredDate: addDaysToIsoDate(todayInSalonTimeZone(), 7),
    comment: 'После 18:00',
    consent: true,
    website: '',
    ...overrides
  };
}

let ipCounter = 1;

/** Unique IP per request, so the public rate limit does not affect other tests. */
export function nextIp(): string {
  ipCounter += 1;
  return `198.51.100.${ipCounter % 250}`;
}

export async function closeApp(context: TestContext): Promise<void> {
  await context.app.close();
  context.db.close();
}
