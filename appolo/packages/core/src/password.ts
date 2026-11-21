import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

/**
 * OWASP's current floor for scrypt is N=2^17, r=8, p=1. The previous cost
 * (2^14) was below it. Raising N only affects new hashes: the parameters are
 * stored in the hash string, so `verifyPassword` reproduces the cost a stored
 * hash was created with and every existing password keeps working.
 */
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEYLEN = 64;
const SALT_BYTES = 16;

/** scrypt needs 128 * N * r bytes; Node's 32 MiB default cannot hold 2^17. */
function maxmemFor(n: number, r: number): number {
  return Math.max(64 * 1024 * 1024, 256 * n * r);
}

/**
 * Format: scrypt$<N>$<r>$<p>$<salt-b64>$<hash-b64>
 *
 * scrypt is used instead of Argon2id to keep Phase 0 dependency-free;
 * swap in Argon2id at the auth hardening milestone (documented in ROADMAP).
 *
 * Async on purpose: `scryptSync` blocks the event loop for the whole KDF, so
 * one login (or a burst of them) stalled every other request on the process.
 */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const hash = await scryptAsync(password, salt, KEYLEN, {
    N,
    r: R,
    p: P,
    maxmem: maxmemFor(N, R),
  });
  return [
    "scrypt",
    String(N),
    String(R),
    String(P),
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  try {
    const parts = stored.split("$");
    if (parts.length !== 6 || parts[0] !== "scrypt") return false;
    const n = Number(parts[1]);
    const r = Number(parts[2]);
    const p = Number(parts[3]);
    const salt = Buffer.from(parts[4]!, "base64");
    const expected = Buffer.from(parts[5]!, "base64");
    if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;
    // A corrupt or hostile stored hash must not be able to demand unbounded
    // memory from the process.
    if (n < 2 ** 1 || n > 2 ** 20 || r < 1 || r > 32 || p < 1 || p > 16) return false;
    if (salt.length === 0 || expected.length === 0) return false;

    const actual = await scryptAsync(password, salt, expected.length, {
      N: n,
      r,
      p,
      maxmem: maxmemFor(n, r),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function passwordProblem(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (password.length > 200) return "Password is too long.";
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) {
    return "Password must contain at least one letter and one number.";
  }
  return null;
}
