import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify, Algorithm } from '@node-rs/argon2';

const ARGON_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
  outputLen: 32
} as const;

/**
 * A pre-computed hash used to keep login timing uniform for unknown usernames.
 * It is not a credential for any account.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$KIlLNWb2iWozSzJ3X2g+CQ$1PNE7BpsbslDo8x2L/hz8VN4GP0p2vlwiVUtyInTgCk';

export async function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTIONS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** Runs a fake verification so unknown-user responses take the same time. */
export async function burnPasswordTime(password: string): Promise<void> {
  try {
    await argonVerify(DUMMY_HASH, password);
  } catch {
    // Ignore: this call exists only for timing.
  }
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function generateHexToken(bytes = 32): string {
  return randomBytes(bytes).toString('hex');
}

/** Constant-time comparison for equal-length UTF-8 strings. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function originOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}
