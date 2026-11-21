import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

const booleanString = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    APP_ORIGIN: z.string().url(),
    PUBLIC_DIR: z.string().min(1).default('./public'),
    MIGRATIONS_DIR: z.string().min(1).default('./migrations'),
    DATA_DIR: z.string().min(1).default('./data'),
    COOKIE_SECURE: booleanString,
    TRUST_PROXY: booleanString,
    SESSION_IDLE_HOURS: z.coerce.number().int().min(1).max(720).default(12),
    SESSION_ABSOLUTE_DAYS: z.coerce.number().int().min(1).max(365).default(7),
    RATE_LIMIT_DISABLED: booleanString,
    CONSENT_VERSION: z.string().min(1).max(32).default('2026-11-04'),
    BOOKING_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
    BACKUP_DIR: z.string().min(1).default('./data/backups'),
    BACKUP_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(7),
    BACKUP_KEY: z
      .string()
      .regex(/^[0-9a-fA-F]{64}$/, 'BACKUP_KEY must be 64 hex characters')
      .optional(),
    // Preferred in Docker: read the key from a mounted secret file.
    BACKUP_KEY_FILE: z.string().min(1).optional(),
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info')
  });

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
  // Do not print secret values, only names of problematic variables.
  throw new Error(`Invalid environment configuration:\n${issues.join('\n')}`);
}

const env = parsed.data;

function resolveBackupKey(): string | undefined {
  if (env.BACKUP_KEY) return env.BACKUP_KEY;

  if (env.BACKUP_KEY_FILE) {
    const file = path.resolve(env.BACKUP_KEY_FILE);
    let value: string;
    try {
      value = fs.readFileSync(file, 'utf8').trim();
    } catch {
      throw new Error('BACKUP_KEY_FILE is set but the file cannot be read');
    }
    if (!/^[0-9a-fA-F]{64}$/.test(value)) {
      throw new Error('BACKUP_KEY_FILE must contain exactly 64 hex characters');
    }
    return value;
  }

  return undefined;
}

export const config = {
  env: env.NODE_ENV,
  isProduction: env.NODE_ENV === 'production',
  isTest: env.NODE_ENV === 'test',
  host: env.HOST,
  port: env.PORT,
  appOrigin: new URL(env.APP_ORIGIN).origin,
  publicDir: path.resolve(env.PUBLIC_DIR),
  migrationsDir: path.resolve(env.MIGRATIONS_DIR),
  dataDir: path.resolve(env.DATA_DIR),
  dbPath: path.resolve(env.DATA_DIR, 'app.db'),
  backupDir: path.resolve(env.BACKUP_DIR),
  backupRetentionDays: env.BACKUP_RETENTION_DAYS,
  backupKey: resolveBackupKey(),
  cookieSecure: env.COOKIE_SECURE,
  cookieName: env.COOKIE_SECURE ? '__Host-salon_admin' : 'salon_admin',
  trustProxy: env.TRUST_PROXY,
  sessionIdleHours: env.SESSION_IDLE_HOURS,
  sessionAbsoluteDays: env.SESSION_ABSOLUTE_DAYS,
  sessionIdleMs: env.SESSION_IDLE_HOURS * 60 * 60 * 1000,
  sessionAbsoluteMs: env.SESSION_ABSOLUTE_DAYS * 24 * 60 * 60 * 1000,
  rateLimitDisabled: env.RATE_LIMIT_DISABLED,
  consentVersion: env.CONSENT_VERSION,
  bookingRetentionDays: env.BOOKING_RETENTION_DAYS,
  logLevel: env.LOG_LEVEL,
  csrfHeader: 'x-csrf-token'
} as const;

export type AppConfig = typeof config;
