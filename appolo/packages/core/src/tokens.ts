import { createHash, randomBytes } from "node:crypto";

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Short, URL-safe public token for review links. */
export function publicToken(bytes = 18): string {
  return randomBytes(bytes).toString("base64url");
}

export function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "org";
}

export function withSuffix(slug: string, suffix: string = randomToken(3).toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6)): string {
  return `${slug}-${suffix}`;
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** E.164-ish normalization for phone numbers. Keeps a leading + when present. */
export function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  const plus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  return plus ? `+${digits}` : digits;
}