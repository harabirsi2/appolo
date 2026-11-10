import { normalizeEmail, sha256 } from "@appolo/core";
import { getDbHandle } from "@/lib/db";

/**
 * Fixed-window counters for credential endpoints.
 *
 * Stored in Postgres rather than process memory so limits hold across restarts
 * and multiple instances. The table is outside RLS (like `sessions`) because
 * it is written before an org context exists.
 */

export interface AttemptWindow {
  /** Allowed attempts inside one window. */
  max: number;
  windowMs: number;
}

/** 20 attempts per email per 15 minutes; a success clears the sender's budget. */
export const LOGIN_WINDOW: AttemptWindow = { max: 20, windowMs: 15 * 60_000 };

/** 20 new workspaces per IP per hour, which is far above any human pace. */
export const SIGNUP_WINDOW: AttemptWindow = { max: 20, windowMs: 60 * 60_000 };

export type AttemptResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

const CLEANUP_AFTER_MS = 3 * 86_400_000;

export function loginAttemptKey(email: string): string {
  // Hash the address: the counter table should not accumulate plain emails.
  return `login:${sha256(normalizeEmail(email))}`;
}

export function signupAttemptKey(ip: string | null | undefined): string {
  return `signup:${ip ?? "unknown"}`;
}

/**
 * Count one attempt against `key` and report whether it may proceed.
 *
 * The upsert is a single statement, so concurrent requests cannot each read
 * "under the limit" before any of them records a failure.
 */
export async function consumeAttempt(key: string, limit: AttemptWindow): Promise<AttemptResult> {
  const { client } = getDbHandle();
  const rows = await client<{ count: number; window_start: Date }[]>`
    insert into auth_rate_limits as limits (key, window_start, count)
    values (${key}, now(), 1)
    on conflict (key) do update set
      count = case
        when limits.window_start <= now() - (${limit.windowMs}::int * interval '1 millisecond') then 1
        else limits.count + 1
      end,
      window_start = case
        when limits.window_start <= now() - (${limit.windowMs}::int * interval '1 millisecond') then now()
        else limits.window_start
      end
    returning count, window_start
  `;

  const row = rows[0];
  if (!row) return { allowed: true };

  if (Math.random() < 0.02) {
    await client`
      delete from auth_rate_limits
      where window_start < now() - (${CLEANUP_AFTER_MS}::int * interval '1 millisecond')
    `.catch(() => {});
  }

  if (row.count <= limit.max) return { allowed: true };

  const elapsedMs = Date.now() - new Date(row.window_start).getTime();
  const retryAfterSeconds = Math.max(1, Math.ceil((limit.windowMs - elapsedMs) / 1000));
  return { allowed: false, retryAfterSeconds };
}

/** Forget a key's attempts (called after a successful sign-in). */
export async function clearAttempts(key: string): Promise<void> {
  const { client } = getDbHandle();
  await client`delete from auth_rate_limits where key = ${key}`;
}

export function tooManyAttemptsMessage(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / 60));
  return `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`;
}
