import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import BetterSqlite3 from 'better-sqlite3';
import type { Db } from '../db/index.js';

const MAGIC = Buffer.from('ZGBK1', 'ascii');
const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFromHex(hex: string): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) {
    throw new Error('BACKUP_KEY must be 64 hex characters (32 bytes)');
  }
  return Buffer.from(hex, 'hex');
}

function timestamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').slice(0, 19);
}

export interface BackupResult {
  file: string;
  bytes: number;
}

/** Creates a consistent snapshot with VACUUM INTO and encrypts it with AES-256-GCM. */
export function createEncryptedBackup(
  db: Db,
  options: { backupDir: string; keyHex: string; retentionDays: number }
): BackupResult {
  const key = keyFromHex(options.keyHex);
  fs.mkdirSync(options.backupDir, { recursive: true, mode: 0o700 });

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'salon-backup-'));
  const snapshot = path.join(tempDir, 'snapshot.db');

  try {
    db.prepare('VACUUM INTO ?').run(snapshot);
    const plain = fs.readFileSync(snapshot);
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
    const tag = cipher.getAuthTag();
    const payload = Buffer.concat([MAGIC, iv, tag, ciphertext]);

    const file = path.join(options.backupDir, `salon-${timestamp()}.db.enc`);
    fs.writeFileSync(file, payload, { mode: 0o600 });
    pruneBackups(options.backupDir, options.retentionDays);

    return { file, bytes: payload.length };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

export function decryptBackup(inputFile: string, outputFile: string, keyHex: string): void {
  const key = keyFromHex(keyHex);
  const payload = fs.readFileSync(inputFile);

  if (payload.length <= MAGIC.length + IV_BYTES + TAG_BYTES) {
    throw new Error('Backup file is too short');
  }

  const magic = payload.subarray(0, MAGIC.length);
  if (!magic.equals(MAGIC)) {
    throw new Error('Unknown backup format');
  }

  const ivStart = MAGIC.length;
  const tagStart = ivStart + IV_BYTES;
  const dataStart = tagStart + TAG_BYTES;

  const iv = payload.subarray(ivStart, tagStart);
  const tag = payload.subarray(tagStart, dataStart);
  const ciphertext = payload.subarray(dataStart);

  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  fs.writeFileSync(outputFile, plain, { mode: 0o600 });
}

export function verifySqliteFile(file: string): void {
  const probe = new BetterSqlite3(file, { readonly: true, fileMustExist: true });
  try {
    const row = probe.prepare('PRAGMA integrity_check').get() as { integrity_check: string };
    if (row.integrity_check !== 'ok') {
      throw new Error(`Integrity check failed: ${row.integrity_check}`);
    }
  } finally {
    probe.close();
  }
}

export function pruneBackups(backupDir: string, retentionDays: number): number {
  if (!fs.existsSync(backupDir)) return 0;

  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let removed = 0;

  for (const entry of fs.readdirSync(backupDir)) {
    if (!entry.endsWith('.db.enc')) continue;
    const file = path.join(backupDir, entry);
    const stat = fs.statSync(file);
    if (stat.mtimeMs < cutoff) {
      fs.unlinkSync(file);
      removed += 1;
    }
  }

  return removed;
}
