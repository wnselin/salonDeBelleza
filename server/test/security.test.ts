import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createBooking, deleteExpiredBookings } from '../src/db/bookings.js';
import { createEncryptedBackup, decryptBackup, verifySqliteFile } from '../src/lib/backup.js';
import { createUser, findUserByUsername } from '../src/db/users.js';
import { createSession, deleteExpiredSessions, findSession } from '../src/db/sessions.js';
import { hashPassword, sha256Hex } from '../src/lib/security.js';
import { nowIso } from '../src/lib/time.js';
import { closeApp, makeApp, type TestContext } from './helpers.js';

let context: TestContext;
const tempFiles: string[] = [];

beforeAll(async () => {
  context = await makeApp();
});

afterAll(async () => {
  await closeApp(context);
  tempFiles.forEach((file) => fs.rmSync(file, { recursive: true, force: true }));
});

describe('retention', () => {
  it('deletes bookings whose retention period has expired', () => {
    const now = new Date();
    const expired = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

    createBooking(context.db, {
      name: 'Просроченный Клиент',
      phone: '+79140000001',
      phoneNormalized: '+79140000001',
      serviceCategory: 'manicure',
      service: 'Маникюр',
      preferredDate: null,
      comment: null,
      consentAt: expired,
      consentVersion: 'test',
      createdAt: expired,
      expiresAt: expired
    });

    const removed = deleteExpiredBookings(context.db, nowIso());
    expect(removed).toBeGreaterThanOrEqual(1);

    const row = context.db
      .prepare("SELECT id FROM bookings WHERE phone_normalized = '+79140000001'")
      .get();
    expect(row).toBeUndefined();
  });

  it('deletes expired sessions', () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    createSession(context.db, {
      tokenHash: sha256Hex('expired-token'),
      userId: 1,
      csrfToken: 'a'.repeat(64),
      createdAt: expired,
      expiresAt: expired
    });

    expect(deleteExpiredSessions(context.db, nowIso())).toBeGreaterThanOrEqual(1);
    expect(findSession(context.db, sha256Hex('expired-token'))).toBeNull();
  });

  it('uses secure_delete to wipe deleted content', () => {
    const row = context.db.prepare('PRAGMA secure_delete').get() as { secure_delete: number };
    expect(row.secure_delete).toBe(1);
  });
});

describe('encrypted backups', () => {
  it('creates, decrypts and verifies a backup', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salon-test-backup-'));
    tempFiles.push(dir);
    const key = 'b'.repeat(64);

    const result = createEncryptedBackup(context.db, {
      backupDir: dir,
      keyHex: key,
      retentionDays: 7
    });

    expect(result.bytes).toBeGreaterThan(100);
    expect(result.file.endsWith('.db.enc')).toBe(true);

    const decrypted = path.join(dir, 'restored.db');
    decryptBackup(result.file, decrypted, key);
    verifySqliteFile(decrypted);

    const original = fs.readFileSync(result.file);
    expect(original.subarray(0, 5).toString('ascii')).toBe('ZGBK1');
  });

  it('fails to decrypt with a wrong key', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salon-test-backup-'));
    tempFiles.push(dir);

    const result = createEncryptedBackup(context.db, {
      backupDir: dir,
      keyHex: 'c'.repeat(64),
      retentionDays: 7
    });

    expect(() => decryptBackup(result.file, path.join(dir, 'bad.db'), 'd'.repeat(64))).toThrow();
  });

  it('prunes backups older than the retention window', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'salon-test-backup-'));
    tempFiles.push(dir);
    const key = 'e'.repeat(64);

    const oldFile = path.join(dir, 'old.db.enc');
    fs.writeFileSync(oldFile, 'old');
    const oldTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, oldTime, oldTime);

    createEncryptedBackup(context.db, { backupDir: dir, keyHex: key, retentionDays: 7 });

    expect(fs.existsSync(oldFile)).toBe(false);
  });
});

describe('frontend safety', () => {
  it('does not render admin data through innerHTML', () => {
    const adminJs = fs.readFileSync(path.resolve('public/admin/admin.js'), 'utf8');
    expect(adminJs).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/);
  });
});

describe('users', () => {
  it('stores password hashes, not passwords', async () => {
    const password = 'Another-Strong-Password-9!';
    const hash = await hashPassword(password);
    createUser(context.db, 'second-admin', hash, nowIso());

    const user = findUserByUsername(context.db, 'second-admin');
    expect(user).toBeTruthy();
    expect(user?.passwordHash).not.toBe(password);
    expect(user?.passwordHash.startsWith('$argon2id$')).toBe(true);
  });
});
