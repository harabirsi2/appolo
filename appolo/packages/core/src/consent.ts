/**
 * Consent is data, not a boolean. Every outbound send checks the latest
 * consent record for that contact+channel before anything leaves the system.
 */

export const CONSENT_CHANNELS = ["sms", "email", "webchat"] as const;
export type ConsentChannel = (typeof CONSENT_CHANNELS)[number];

/** Channels that require an explicit, recorded grant before the first send. */
export const CONSENT_REQUIRED_CHANNELS: readonly ConsentChannel[] = ["sms", "email"];

/**
 * TCPA-standard opt-out keywords. Matched case-insensitively after stripping
 * surrounding whitespace and trailing punctuation.
 */
const STOP_KEYWORDS = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
  "OPTOUT",
  "OPT-OUT",
  "REMOVE",
]);

const HELP_KEYWORDS = new Set(["HELP", "INFO"]);
const START_KEYWORDS = new Set(["START", "UNSTOP", "YES", "RESUME"]);

export function normalizeKeyword(body: string): string {
  return body
    .trim()
    .toUpperCase()
    .replace(/[.!?,\s]+$/g, "");
}

export function isStopKeyword(body: string): boolean {
  return STOP_KEYWORDS.has(normalizeKeyword(body));
}

export function isHelpKeyword(body: string): boolean {
  return HELP_KEYWORDS.has(normalizeKeyword(body));
}

export function isStartKeyword(body: string): boolean {
  return START_KEYWORDS.has(normalizeKeyword(body));
}

export const HELP_REPLY =
  "Appolo: a team member will follow up. Reply STOP to opt out of messages.";

export const STOP_REPLY =
  "You have been unsubscribed and will not receive further messages. Reply START to resubscribe.";

export const START_REPLY =
  "You are resubscribed and will receive messages again. Reply STOP to opt out.";

export interface ConsentRecordLike {
  channel: string;
  status: "granted" | "revoked";
  capturedAt: Date | string;
}

/** Latest record per channel wins. */
export function latestConsentByChannel(
  records: readonly ConsentRecordLike[],
): Map<string, ConsentRecordLike> {
  const map = new Map<string, ConsentRecordLike>();
  for (const record of records) {
    const previous = map.get(record.channel);
    if (!previous || new Date(record.capturedAt) >= new Date(previous.capturedAt)) {
      map.set(record.channel, record);
    }
  }
  return map;
}

export interface ConsentDecision {
  allowed: boolean;
  reason?: string;
}

/**
 * `webchat` is session-implied and allowed without a record. `sms` and `email`
 * require an explicit granted record; a missing record blocks the send.
 */
export function canSendOnChannel(
  records: readonly ConsentRecordLike[],
  channel: string,
  options: { requireGrantFor?: readonly string[] } = {},
): ConsentDecision {
  const latest = latestConsentByChannel(records).get(channel);
  if (!latest) {
    const required = options.requireGrantFor ?? CONSENT_REQUIRED_CHANNELS;
    if (required.includes(channel)) {
      return { allowed: false, reason: `No consent on file for ${channel}.` };
    }
    return { allowed: true };
  }
  if (latest.status === "revoked") {
    return { allowed: false, reason: `Contact opted out of ${channel}.` };
  }
  return { allowed: true };
}

/** Channels that currently have a granted record (used by the UI). */
export function grantedChannels(records: readonly ConsentRecordLike[]): string[] {
  const out: string[] = [];
  for (const [channel, record] of latestConsentByChannel(records)) {
    if (record.status === "granted") out.push(channel);
  }
  return out;
}