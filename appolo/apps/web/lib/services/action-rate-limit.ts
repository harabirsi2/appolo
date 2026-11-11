import { consumeAttempt, type AttemptWindow } from "./auth-rate-limit";

/**
 * Fixed-window limits for interactive ranking/social endpoints.
 *
 * These reuse the credential counter table: one upsert per request, shared
 * across instances, and keyed by org so a fresh session cannot reset a quota.
 * The windows are well above normal tapping speed — they exist to stop scripted
 * bursts, not to get in the way of a fast human.
 */
export const VOTE_WINDOW: AttemptWindow = { max: 120, windowMs: 60_000 };
export const MATCHUP_WINDOW: AttemptWindow = { max: 240, windowMs: 60_000 };
export const REACTION_WINDOW: AttemptWindow = { max: 60, windowMs: 60_000 };

export type ActionScope = "vote" | "matchup" | "reaction";

export type ActionLimitResult =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export function actionAttemptKey(scope: ActionScope, orgId: string): string {
  return `${scope}:${orgId}`;
}

export async function consumeAction(
  scope: ActionScope,
  orgId: string,
  limit: AttemptWindow,
): Promise<ActionLimitResult> {
  return consumeAttempt(actionAttemptKey(scope, orgId), limit);
}
