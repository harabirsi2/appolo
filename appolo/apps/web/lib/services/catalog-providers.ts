import { after } from "next/server";
import { and, eq, sql } from "drizzle-orm";
import type { MediaKind } from "@appolo/core";
import { getDb, schema } from "@/lib/db";
import { likeContains } from "./like-pattern";
import { enqueueEnrichment } from "./catalog-enrichment";

const { catalogItems } = schema;

/**
 * Optional live catalog search. Off unless CATALOG_PROVIDERS is set, e.g.
 *
 *   CATALOG_PROVIDERS=itunes,openlibrary,tmdb,rawg
 *   TMDB_API_KEY=...            (only for the tmdb provider)
 *   RAWG_API_KEY=...            (only for the rawg provider)
 *
 * Provider-first flow, in order:
 *
 *  1. search returns local rows immediately (never waits on a third party);
 *  2. matching provider hits are inserted as `enrichment_status = 'pending'`
 *     with a provider cover, so they are rankable right away;
 *  3. one durable row per hit lands in catalog_enrichment_queue;
 *  4. the BullMQ worker (apps/worker) upgrades them: details, trailer, genres,
 *     cached cover, then flips them to 'ready'.
 *
 * Failures, timeouts and rate limits never break the search itself.
 *
 *   itunes       movies, music albums, podcasts (no key)
 *   openlibrary  books (no key)
 *   tmdb         movies and TV (needs TMDB_API_KEY; show TMDB attribution in the UI)
 *   rawg         video games (needs RAWG_API_KEY; attribution: "Powered by RAWG")
 *
 * Check each provider's terms and attribution rules before enabling it in production.
 */

interface Candidate {
  kind: MediaKind;
  title: string;
  subtitle: string;
  year: number | null;
  imageUrl: string | null;
  description: string | null;
  genres: string[];
  externalRef: string;
  externalId: string;
  source: string;
}

type Json = Record<string, unknown>;

const TIMEOUT_MS = 4_000;
const CACHE_TTL_MS = 10 * 60_000;
const LOCAL_MATCHES_ENOUGH = 5;
const KINDS: readonly MediaKind[] = ["movie", "tv", "music", "podcast", "book", "game"];

/**
 * Per-minute ceiling for the *request path*. Serverless web instances share a
 * provider quota with the worker, so this stays well under each provider's
 * limit; the worker has its own limiter (CATALOG_WORKER_REQ_PER_MIN). Raise it
 * per install with CATALOG_PROVIDER_REQ_PER_MIN once you know your plan.
 */
function maxRequestsPerMinute(): number {
  const raw = Number(process.env.CATALOG_PROVIDER_REQ_PER_MIN ?? "");
  return Number.isFinite(raw) && raw >= 1 && raw <= 600 ? Math.floor(raw) : 60;
}

const searched = new Map<string, number>();
let windowStart = 0;
let windowCount = 0;

function enabledProviders(): Set<string> {
  return new Set(
    (process.env.CATALOG_PROVIDERS ?? "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function providersEnabled(): boolean {
  return enabledProviders().size > 0;
}

function allowRequest(): boolean {
  const now = Date.now();
  if (now - windowStart > 60_000) {
    windowStart = now;
    windowCount = 0;
  }
  if (windowCount >= maxRequestsPerMinute()) return false;
  windowCount += 1;
  return true;
}

/**
 * User-Agent for every provider call.
 *
 * Open Library's API etiquette asks clients to identify themselves with a
 * contactable UA rather than a library default, and the same string is polite
 * to TMDB and Apple. Set CATALOG_USER_AGENT to add a real contact URL before
 * enabling providers in production; the fallback stays identifiable.
 */
function catalogUserAgent(): string {
  const configured = process.env.CATALOG_USER_AGENT?.trim();
  return configured && configured.length > 0 ? configured : "Appolo/0.1 (catalog search; +https://appolo.app)";
}

async function getJson(url: string, headers: Record<string, string> = {}): Promise<Json | null> {
  if (!allowRequest()) return null;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json", "user-agent": catalogUserAgent(), ...headers },
    });
    if (!response.ok) return null;
    return (await response.json()) as Json;
  } catch {
    return null;
  }
}

const text = (value: unknown, max = 300): string => (typeof value === "string" ? value.trim().slice(0, max) : "");
const list = (value: unknown): Json[] => (Array.isArray(value) ? (value as Json[]) : []);
const httpsOnly = (value: string): string | null => (value.startsWith("https://") ? value : null);

function yearOf(value: unknown): number | null {
  const match = typeof value === "string" ? /^(\d{4})/.exec(value) : null;
  const year = match ? Number(match[1]) : Number.NaN;
  return year >= 1000 && year <= 2200 ? year : null;
}

const ITUNES: Partial<Record<MediaKind, { media: string; entity: string }>> = {
  movie: { media: "movie", entity: "movie" },
  music: { media: "music", entity: "album" },
  podcast: { media: "podcast", entity: "podcast" },
};

async function searchItunes(kind: MediaKind, query: string): Promise<Candidate[]> {
  const spec = ITUNES[kind];
  if (!spec) return [];
  const data = await getJson(
    `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=${spec.media}&entity=${spec.entity}&limit=8`,
  );
  const out: Candidate[] = [];
  for (const row of list(data?.results)) {
    const id = kind === "movie" ? row.trackId : row.collectionId;
    const title = text(kind === "movie" ? row.trackName : row.collectionName, 200);
    if (!id || !title) continue;
    const art = text(row.artworkUrl600) || text(row.artworkUrl100).replace("100x100bb", "600x600bb");
    const genre = text(row.primaryGenreName, 60);
    out.push({
      kind,
      title,
      subtitle: text(row.artistName, 200),
      year: yearOf(row.releaseDate),
      imageUrl: httpsOnly(art),
      description: text(row.longDescription, 1500) || text(row.shortDescription, 1500) || null,
      genres: genre ? [genre] : [],
      externalRef: `itunes:${kind}:${String(id)}`,
      externalId: String(id),
      source: "itunes",
    });
  }
  return out;
}

async function searchOpenLibrary(query: string): Promise<Candidate[]> {
  const data = await getJson(
    `https://openlibrary.org/search.json?q=${encodeURIComponent(query)}&limit=8&fields=key,title,author_name,first_publish_year,cover_i`,
  );
  const out: Candidate[] = [];
  for (const row of list(data?.docs)) {
    const key = text(row.key, 60);
    const title = text(row.title, 200);
    if (!key || !title) continue;
    const authors = Array.isArray(row.author_name) ? (row.author_name as unknown[]) : [];
    out.push({
      kind: "book",
      title,
      subtitle: text(authors[0], 200),
      year: typeof row.first_publish_year === "number" ? row.first_publish_year : null,
      imageUrl:
        typeof row.cover_i === "number" ? `https://covers.openlibrary.org/b/id/${row.cover_i}-L.jpg` : null,
      description: null,
      genres: [],
      externalRef: `openlibrary:${key}`,
      externalId: key,
      source: "openlibrary",
    });
  }
  return out;
}

async function searchTmdb(kind: "movie" | "tv", query: string): Promise<Candidate[]> {
  const key = process.env.TMDB_API_KEY?.trim();
  if (!key) return [];
  const bearer = key.startsWith("eyJ");
  const url =
    `https://api.themoviedb.org/3/search/${kind}?query=${encodeURIComponent(query)}&include_adult=false` +
    (bearer ? "" : `&api_key=${encodeURIComponent(key)}`);
  const data = await getJson(url, bearer ? { authorization: `Bearer ${key}` } : {});
  const out: Candidate[] = [];
  for (const row of list(data?.results)) {
    const title = text(kind === "movie" ? row.title : row.name, 200);
    if (!row.id || !title) continue;
    const year = yearOf(kind === "movie" ? row.release_date : row.first_air_date);
    const poster = text(row.poster_path, 200);
    out.push({
      kind,
      title,
      subtitle: year ? String(year) : "",
      year,
      imageUrl: poster.startsWith("/") ? `https://image.tmdb.org/t/p/w500${poster}` : null,
      description: text(row.overview, 1500) || null,
      genres: [],
      externalRef: `tmdb:${kind}:${String(row.id)}`,
      externalId: String(row.id),
      source: "tmdb",
    });
  }
  return out;
}

/**
 * Games. RAWG is the provider we ship (see docs/CATALOG.md): a free key by
 * email, 20 000 requests/month, no OAuth dance, and cover art on the search
 * response, which is exactly what the pending-first flow needs. IGDB needs a
 * Twitch developer app plus a client-credentials token exchange and its ToS
 * requires a data-source credit; it is the better catalogue eventually, but not
 * for a solo dev running one instance.
 */
async function searchRawg(query: string): Promise<Candidate[]> {
  const key = process.env.RAWG_API_KEY?.trim();
  if (!key) return [];
  const data = await getJson(
    `https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(query)}&page_size=8`,
  );
  const out: Candidate[] = [];
  for (const row of list(data?.results)) {
    const title = text(row.name, 200);
    if (!row.id || !title) continue;
    const platforms = list(row.platforms)
      .map((entry) => text((entry.platform as Json | undefined)?.name, 60))
      .filter(Boolean);
    const genres = list(row.genres).map((genre) => text(genre.name, 60)).filter(Boolean);
    out.push({
      kind: "game",
      title,
      subtitle: platforms[0] ?? "",
      year: yearOf(row.released),
      imageUrl: httpsOnly(text(row.background_image, 500)),
      description: text(row.description_raw, 1500) || null,
      genres,
      externalRef: `rawg:${String(row.id)}`,
      externalId: String(row.id),
      source: "rawg",
    });
  }
  return out;
}

async function searchForKind(kind: MediaKind, query: string, on: Set<string>): Promise<Candidate[]> {
  const tmdb = on.has("tmdb") && Boolean(process.env.TMDB_API_KEY?.trim());
  const rawg = on.has("rawg") && Boolean(process.env.RAWG_API_KEY?.trim());
  switch (kind) {
    case "movie":
      return tmdb ? searchTmdb("movie", query) : on.has("itunes") ? searchItunes("movie", query) : [];
    case "tv":
      return tmdb ? searchTmdb("tv", query) : [];
    case "music":
    case "podcast":
      return on.has("itunes") ? searchItunes(kind, query) : [];
    case "book":
      return on.has("openlibrary") ? searchOpenLibrary(query) : [];
    case "game":
      return rawg ? searchRawg(query) : [];
    default:
      return [];
  }
}

let pendingEnrichments = 0;
/** Providers are slow and shared; never run more than a few lookups at once. */
const MAX_PENDING_ENRICHMENTS = 3;

function runEnrichment(kind: string | undefined, query: string): Promise<void> {
  pendingEnrichments += 1;
  return enrichCatalogFromProviders(kind, query)
    .catch(() => {})
    .finally(() => {
      pendingEnrichments -= 1;
    });
}

/**
 * Queue provider enrichment for after the response has been sent.
 *
 * Searching the catalog should never wait on a third-party API: the local rows
 * are returned immediately and any provider hits land in the shared catalog for
 * the next search. `after` keeps the work alive past the response in both
 * route handlers and server components; outside a request scope (scripts,
 * tests) the lookup still runs, just without the request lifecycle.
 */
export function scheduleCatalogEnrichment(kind: string | undefined, query: string): void {
  if (pendingEnrichments >= MAX_PENDING_ENRICHMENTS) return;
  try {
    after(() => runEnrichment(kind, query));
  } catch {
    void runEnrichment(kind, query);
  }
}

/**
 * Store provider hits as pending rows and hand the upgrade work to the queue.
 * Returns the number of newly inserted rows.
 */
export async function storePendingCandidates(found: Candidate[]): Promise<number> {
  if (found.length === 0) return 0;
  const db = getDb();
  const inserted = await db
    .insert(catalogItems)
    .values(
      found.map((item) => ({
        kind: item.kind,
        title: item.title,
        subtitle: item.subtitle,
        year: item.year,
        imageUrl: item.imageUrl,
        description: item.description,
        genres: item.genres,
        externalRef: item.externalRef,
        externalId: item.externalId,
        source: item.source,
        links: {},
        tags: [],
        // Rankable now, upgraded by the worker.
        enrichmentStatus: "pending",
        entityType: "item",
      })),
    )
    .onConflictDoNothing()
    .returning({ externalRef: catalogItems.externalRef });

  const fresh = new Set(inserted.map((row) => row.externalRef ?? ""));
  const requests = found
    .filter((item) => fresh.has(item.externalRef))
    .map((item) => ({
      externalRef: item.externalRef,
      source: item.source,
      kind: item.kind,
      payload: {
        title: item.title,
        subtitle: item.subtitle,
        year: item.year,
        imageUrl: item.imageUrl,
        externalId: item.externalId,
        source: item.source,
        kind: item.kind,
      },
    }));
  // Durable even if the queue is unavailable right now.
  await enqueueEnrichment(requests).catch(() => 0);
  return inserted.length;
}

/** Fetch titles for a search from the enabled providers and store them in the shared catalog. */
export async function enrichCatalogFromProviders(kind: string | undefined, rawQuery: string): Promise<void> {
  const on = enabledProviders();
  if (on.size === 0) return;
  const query = rawQuery.trim().slice(0, 80);
  if (query.length < 3) return;
  if (kind && !KINDS.includes(kind as MediaKind)) return;

  const kinds: MediaKind[] = kind ? [kind as MediaKind] : ["movie", "tv", "music", "podcast", "book"];
  const cacheKey = `${kinds.join(",")}|${query.toLowerCase()}`;
  const now = Date.now();
  const until = searched.get(cacheKey);
  if (until && until > now) return;
  if (searched.size > 500) searched.clear();
  searched.set(cacheKey, now + CACHE_TTL_MS);

  try {
    const db = getDb();
    const like = likeContains(query);
    const [local] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(catalogItems)
      .where(
        and(
          kind ? eq(catalogItems.kind, kind as MediaKind) : undefined,
          sql`(${catalogItems.title} ilike ${like} or ${catalogItems.subtitle} ilike ${like})`,
        ),
      );
    if ((local?.n ?? 0) >= LOCAL_MATCHES_ENOUGH) return;

    const found = (await Promise.all(kinds.map((k) => searchForKind(k, query, on)))).flat();
    await storePendingCandidates(found);
  } catch {
    // Catalog enrichment is best effort; the local search still works.
  }
}
