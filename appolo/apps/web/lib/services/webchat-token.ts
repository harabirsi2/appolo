import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { DomainError } from "./errors";

/**
 * Server-issued identity for a web chat visitor.
 *
 * The widget used to invent its own `visitorId` in localStorage and the GET
 * route returned whatever transcript that id pointed at, so anyone who guessed
 * (or simply reused) an id could read another visitor's conversation. The id is
 * now minted here and handed back inside an HMAC-signed token; a request only
 * proves ownership of a transcript by presenting that signature.
 *
 * Format: `v1.<uuid>.<expiresAtMs>.<base64url hmac-sha256>`.
 */

const VERSION = "v1";
const TTL_MS = 7 * 86_400_000;
const MIN_SECRET_LENGTH = 32;
/** Only ever used outside production, where the alternative is a broken widget. */
const DEVELOPMENT_SECRET = "appolo-development-only-webchat-token-secret";

let warned = false;

function secret(): string {
  const configured = process.env.WEBCHAT_TOKEN_SECRET?.trim();
  if (configured && configured.length >= MIN_SECRET_LENGTH) return configured;
  if (process.env.NODE_ENV === "production") {
    // A known secret would let anyone forge a token, so production fails closed.
    throw new DomainError(
      "WEBCHAT_NOT_CONFIGURED",
      "Web chat is not configured on this server.",
      503,
    );
  }
  if (!warned) {
    warned = true;
    console.warn(
      "[webchat] WEBCHAT_TOKEN_SECRET is unset; signing visitor tokens with the development secret.",
    );
  }
  return DEVELOPMENT_SECRET;
}

function sign(payload: string): string {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export interface VisitorSession {
  visitorId: string;
  token: string;
  /** Epoch milliseconds. */
  expiresAt: number;
}

/** Mint a session, optionally continuing an existing visitor. */
export function issueVisitorToken(visitorId: string = randomUUID()): VisitorSession {
  const expiresAt = Date.now() + TTL_MS;
  const payload = `${VERSION}.${visitorId}.${expiresAt}`;
  return { visitorId, token: `${payload}.${sign(payload)}`, expiresAt };
}

/** Return the visitor id the token proves, or null when it is not ours. */
export function readVisitorToken(token: string | null | undefined): string | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [version, visitorId, expiresAtRaw, signature] = parts;
  if (version !== VERSION || !visitorId || !expiresAtRaw || !signature) return null;
  // The id becomes part of a contact key, so keep it to the shape we issue.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(visitorId)) {
    return null;
  }
  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return null;

  const expected = Buffer.from(sign(`${VERSION}.${visitorId}.${expiresAtRaw}`), "base64url");
  const actual = Buffer.from(signature, "base64url");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  return visitorId;
}
