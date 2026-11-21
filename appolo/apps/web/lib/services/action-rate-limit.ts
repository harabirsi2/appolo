import { consumeAttempt, type AttemptResult, type AttemptWindow } from "./auth-rate-limit";

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
/** Comments notify the review author, so they are capped tighter than reactions. */
export const COMMENT_WINDOW: AttemptWindow = { max: 20, windowMs: 60_000 };
/** Bulk PII exports are legitimate but should not be scriptable in a loop. */
export const EXPORT_WINDOW: AttemptWindow = { max: 5, windowMs: 60_000 };
/** External catalog providers cost quota; local search is not limited here. */
export const SEARCH_WINDOW: AttemptWindow = { max: 30, windowMs: 60_000 };
/** Bulk catalog imports create shared rows and deserve a tighter quota. */
export const IMPORT_WINDOW: AttemptWindow = { max: 5, windowMs: 60_000 };
/** Reports are cheap but should not become a scripted harassment channel. */
export const REPORT_WINDOW: AttemptWindow = { max: 20, windowMs: 60_000 };
/**
 * One browser visitor is well under this. The webchat POST is unauthenticated,
 * and every accepted message can create a contact, run keyword automations (a
 * real SMS) and spend an AI reply, so it is metered per widget key and IP.
 */
export const WEBCHAT_WINDOW: AttemptWindow = { max: 12, windowMs: 60_000 };

type ActionScope = "vote" | "matchup" | "reaction" | "comment" | "export" | "search" | "import" | "report";

export async function consumeAction(
  scope: ActionScope,
  orgId: string,
  limit: AttemptWindow,
): Promise<AttemptResult> {
  return consumeAttempt(`${scope}:${orgId}`, limit);
}

/**
 * Meter a public widget request. Keyed by widget key *and* client IP so one
 * abusive visitor cannot exhaust a site's allowance for everyone else, and a
 * single IP cannot flood every widget it can find.
 */
export async function consumeWebchat(
  publicKey: string,
  ip: string | null | undefined,
  limit: AttemptWindow = WEBCHAT_WINDOW,
): Promise<AttemptResult> {
  return consumeAttempt(`webchat:${publicKey}:${ip ?? "unknown"}`, limit);
}
