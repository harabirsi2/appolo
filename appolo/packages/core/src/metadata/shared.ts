import { DEFAULT_METADATA_TIMEOUT_MS } from "./types";

export type Json = Record<string, unknown>;

export interface RequestOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  headers?: Record<string, string>;
}

/** JSON GET with a hard timeout. Provider failures are data, never exceptions. */
export async function requestJson(url: string, options: RequestOptions = {}): Promise<Json | null> {
  const doFetch = options.fetchImpl ?? fetch;
  try {
    const response = await doFetch(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_METADATA_TIMEOUT_MS),
      headers: {
        accept: "application/json",
        "user-agent": "Appolo/0.1 (metadata search)",
        ...options.headers,
      },
      cache: "no-store",
    });
    if (!response.ok) return null;
    return (await response.json()) as Json;
  } catch {
    return null;
  }
}

export function text(value: unknown, max = 300): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function list(value: unknown): Json[] {
  return Array.isArray(value) ? (value as Json[]) : [];
}

export function httpsOnly(value: string): string | null {
  return value.startsWith("https://") ? value : null;
}

export function yearOf(value: unknown): number | null {
  const match = typeof value === "string" ? /^(\d{4})/.exec(value) : null;
  const year = match ? Number(match[1]) : Number.NaN;
  return year >= 1000 && year <= 2200 ? year : null;
}

export function slugifyPerson(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "creator"
  );
}

/** Convert a YouTube watch/short/embed URL into an embeddable URL. */
export function youtubeEmbedUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.hostname === "youtu.be") {
      const id = url.pathname.replace(/^\//, "");
      return id ? `https://www.youtube.com/embed/${id}` : null;
    }
    if (url.hostname.endsWith("youtube.com")) {
      if (url.pathname === "/watch") {
        const id = url.searchParams.get("v");
        return id ? `https://www.youtube.com/embed/${id}` : null;
      }
      const match = /^\/(?:embed|shorts|v)\/([^/?#]+)/.exec(url.pathname);
      return match ? `https://www.youtube.com/embed/${match[1]}` : null;
    }
  } catch {
    return null;
  }
  return null;
}

export function uniqBy<T>(values: readonly T[], key: (value: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const value of values) {
    const id = key(value);
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(value);
  }
  return out;
}