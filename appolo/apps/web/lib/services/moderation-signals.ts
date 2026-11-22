/**
 * Signals that run on a report, before a human looks at it.
 *
 * The moderation queue only knows what a reporter typed. Two things are cheap to
 * detect and account for most of the queue noise:
 *
 *  1. Duplicate reviews — the same text posted from several accounts, or the
 *     same account posting one paragraph across many items. Both are copy-paste
 *     spam and neither needs a judgement call.
 *  2. Link spam — bodies that exist to move traffic. Counting links, shorteners
 *     and promo vocabulary separates "annoying review" from "advertisement".
 *
 * Deliberately pure: no database, no network, no clock. Everything here is a
 * function of the text, which is why it can be unit-tested and why a threshold
 * can be argued about with a test rather than with production data.
 */

export interface SpamSignal {
  /** 0..100. 40 is "look at this first", 70 is "probably an advert". */
  score: number;
  /** Human-readable reasons, one per rule that fired. */
  reasons: string[];
}

const URL_PATTERN = /(?:https?:\/\/|www\.)[^\s<>"')\]]+/gi;
const SHORTENERS = new Set([
  "bit.ly",
  "tinyurl.com",
  "t.co",
  "goo.gl",
  "cutt.ly",
  "linktr.ee",
  "rebrand.ly",
  "is.gd",
  "shorturl.at",
]);
/**
 * Shorteners pasted without a scheme (`bit.ly/abc`). Bots strip the scheme on
 * purpose: it looks less like an advert and slips past link filters that only
 * look for `http`.
 */
const BARE_SHORTENER = new RegExp(
  `\\b(?:${[...SHORTENERS].map((host) => host.replace(/\./g, "\\.")).join("|")})\\/\\S*`,
  "gi",
);

function hostOf(raw: string): string {
  const trimmed = raw.replace(/[.,;:!?]+$/, "");
  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return trimmed.toLowerCase();
  }
}
const PROMO_PATTERNS: Array<[RegExp, string, number]> = [
  [/\b(telegram|whatsapp)\b/i, "messaging-app invite", 20],
  [/\b(crypto|bitcoin|forex|casino|betting|slots)\b/i, "gambling or crypto pitch", 20],
  [/\b(buy now|order now|limited offer|discount code|promo code)\b/i, "sales language", 15],
  [/\b(free followers|sub4sub|follow back|dm me|check my bio)\b/i, "follow-farming", 15],
  [/\b(click the link|link in bio|visit my site)\b/i, "traffic redirect", 15],
];

/**
 * Pull the URLs out of a body and normalise them to bare hosts.
 *
 * Occurrences are kept (two links to one host are still two links), except for
 * a bare shortener that repeats a fully-qualified one already found above it.
 */
export function extractLinks(text: string): string[] {
  const hosts: string[] = [];
  for (const match of text.matchAll(URL_PATTERN)) hosts.push(hostOf(match[0]));
  for (const match of text.matchAll(BARE_SHORTENER)) {
    const host = hostOf(match[0]);
    if (!hosts.includes(host)) hosts.push(host);
  }
  return hosts;
}

/**
 * Score a body for link spam.
 *
 * Weights are additive and capped at 100 so one pathological body cannot dwarf
 * everything else in a sorted queue. A body with no links and no promo language
 * scores 0, which is the common case and must stay cheap.
 */
export function scoreLinkSpam(text: string | null | undefined): SpamSignal {
  const body = (text ?? "").trim();
  if (body.length === 0) return { score: 0, reasons: [] };

  const reasons: string[] = [];
  let score = 0;

  const hosts = extractLinks(body);
  if (hosts.length > 0) {
    score += Math.min(hosts.length, 4) * 12;
    reasons.push(`${hosts.length} link${hosts.length === 1 ? "" : "s"}`);

    const distinct = new Set(hosts);
    if (distinct.size > 1) {
      score += 8;
      reasons.push(`${distinct.size} distinct domains`);
    }
    const shortened = [...distinct].filter((host) => SHORTENERS.has(host));
    if (shortened.length > 0) {
      score += 20;
      reasons.push(`link shortener (${shortened.join(", ")})`);
    }
  }

  for (const [pattern, label, weight] of PROMO_PATTERNS) {
    if (pattern.test(body)) {
      score += weight;
      reasons.push(label);
    }
  }

  return { score: Math.min(100, score), reasons };
}

/** Lowercase, strip punctuation, collapse whitespace. */
export function normalizeReviewText(text: string): string {
  return text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trigrams(value: string): Set<string> {
  const padded = ` ${value} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= padded.length; i += 1) out.add(padded.slice(i, i + 3));
  return out;
}

/**
 * Similarity in 0..1, the Sørensen–Dice coefficient over character trigrams.
 *
 * Chosen over edit distance because "same review, one word changed" and "same
 * review, reordered" both score high, and it is O(n) per string rather than
 * O(n·m) — the queue can call this against every candidate without a second
 * thought. Word order and punctuation are normalised away first.
 */
export function reviewSimilarity(a: string, b: string): number {
  const left = normalizeReviewText(a);
  const right = normalizeReviewText(b);
  if (left.length === 0 || right.length === 0) return 0;
  if (left === right) return 1;

  const leftTrigrams = trigrams(left);
  const rightTrigrams = trigrams(right);
  let shared = 0;
  for (const gram of leftTrigrams) if (rightTrigrams.has(gram)) shared += 1;
  return (2 * shared) / (leftTrigrams.size + rightTrigrams.size);
}

/** Bodies shorter than this are too generic to call a duplicate. */
export const DUPLICATE_MIN_LENGTH = 40;
export const DUPLICATE_THRESHOLD = 0.85;

export interface DuplicateCandidate {
  id: string;
  body: string | null;
}

export interface DuplicateMatch {
  id: string;
  similarity: number;
}

/**
 * The most similar earlier body, if it is close enough to be a copy.
 *
 * Short bodies are skipped in both directions: "great album" appearing twice is
 * a coincidence, not spam, and flagging it teaches moderators to ignore flags.
 */
export function findDuplicate(body: string | null | undefined, candidates: DuplicateCandidate[]): DuplicateMatch | null {
  const text = (body ?? "").trim();
  if (normalizeReviewText(text).length < DUPLICATE_MIN_LENGTH) return null;

  let best: DuplicateMatch | null = null;
  for (const candidate of candidates) {
    if (!candidate.body) continue;
    if (normalizeReviewText(candidate.body).length < DUPLICATE_MIN_LENGTH) continue;
    if (candidate.body === text) return { id: candidate.id, similarity: 1 };
    const similarity = reviewSimilarity(text, candidate.body);
    if (similarity >= DUPLICATE_THRESHOLD && (!best || similarity > best.similarity)) {
      best = { id: candidate.id, similarity };
    }
  }
  return best;
}

export type TriageAction = "none" | "flag" | "hide";

export interface TriageDecision {
  action: TriageAction;
  /** Why the action was chosen; goes on the report for the moderator. */
  reason: string;
  spam: SpamSignal;
  duplicate: DuplicateMatch | null;
}

export interface TriageInput {
  body: string | null | undefined;
  candidates?: DuplicateCandidate[];
  /** Automatic hiding is opt-in: see MODERATION_AUTO_HIDE. */
  autoHideEnabled?: boolean;
}

/**
 * Turn signals into one action.
 *
 * Hiding content is destructive and visible to the author, so it only happens
 * when explicitly enabled by configuration (`MODERATION_AUTO_HIDE=1`) *and* the
 * body is unambiguous: a duplicate of a body already hidden, or spam at the top
 * of the scale. Everything else is flagged for a human, which is the right
 * default for a solo operator — a false flag costs a click, a false hide costs
 * a customer.
 */
export function triage(input: TriageInput): TriageDecision {
  const spam = scoreLinkSpam(input.body);
  const duplicate = findDuplicate(input.body, input.candidates ?? []);
  const autoHide = input.autoHideEnabled === true;

  if (duplicate && duplicate.similarity >= 0.95) {
    return {
      action: autoHide ? "hide" : "flag",
      reason: `Duplicate of review ${duplicate.id} (${Math.round(duplicate.similarity * 100)}% similar).`,
      spam,
      duplicate,
    };
  }

  if (spam.score >= 70) {
    return {
      action: autoHide ? "hide" : "flag",
      reason: `Link spam score ${spam.score}: ${spam.reasons.join("; ")}.`,
      spam,
      duplicate,
    };
  }

  if (duplicate || spam.score >= 40) {
    const parts: string[] = [];
    if (duplicate) parts.push(`similar to review ${duplicate.id} (${Math.round(duplicate.similarity * 100)}%)`);
    if (spam.score >= 40) parts.push(`spam score ${spam.score}: ${spam.reasons.join("; ")}`);
    return { action: "flag", reason: `Review first: ${parts.join("; ")}.`, spam, duplicate };
  }

  return { action: "none", reason: "No automatic signal.", spam, duplicate };
}

/** Read the opt-in flag once so callers cannot disagree about it. */
export function autoHideEnabled(): boolean {
  return process.env.MODERATION_AUTO_HIDE === "1";
}
