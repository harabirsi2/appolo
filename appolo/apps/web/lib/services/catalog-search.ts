import { and, eq, inArray, sql } from "drizzle-orm";
import {
  buildMetadataAdapters,
  loadMetadataDetails,
  searchMetadata,
  type MetadataCandidate,
  type MetadataConfig,
  type MetadataSource,
  type SearchCategory,
  mediaKindForCategory,
} from "@appolo/core";
import { getDb, schema } from "@/lib/db";
import { mapCatalogItem, type CatalogItem } from "./catalog-item";
import { hasGenre } from "./genre-filter";
import { consumeAction, SEARCH_WINDOW } from "./action-rate-limit";

const { catalogItems } = schema;

/**
 * Local-first catalog search with an optional external fallback.
 *
 * The local catalog is always queried first and returned immediately. When a
 * query is specific enough and the local rows are thin, enabled providers are
 * searched under a hard deadline so a slow third party can never push the
 * response past the product's <400ms budget. Whatever the providers return is
 * upserted into `catalog_items` and becomes local for every later search.
 */

/** Give up waiting on providers after this long; results still land later. */
const PROVIDER_DEADLINE_MS = 350;
/** Below this many local matches we ask the providers. */
const LOCAL_MATCHES_ENOUGH = 8;
/** Shortest query worth sending to a provider. */
const MIN_QUERY_LENGTH = 3;
const MAX_LIMIT = 60;

const PROVIDER_SOURCES: readonly MetadataSource[] = ["tmdb", "itunes", "openlibrary", "rawg"];

/** Parse `CATALOG_PROVIDERS` into the adapter allow-list. */
export function enabledMetadataSources(): MetadataSource[] {
  const raw = process.env.CATALOG_PROVIDERS ?? "";
  const wanted = new Set(
    raw
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
  return PROVIDER_SOURCES.filter((source) => wanted.has(source));
}

function metadataConfig(): MetadataConfig {
  return {
    tmdbApiKey: process.env.TMDB_API_KEY ?? null,
    rawgApiKey: process.env.RAWG_API_KEY ?? null,
    enabled: enabledMetadataSources(),
    timeoutMs: PROVIDER_DEADLINE_MS,
  };
}

/** True when at least one provider is configured and usable. */
export function liveSearchEnabled(): boolean {
  const sources = enabledMetadataSources();
  if (sources.length === 0) return false;
  // Key-gated providers only count when their key is present.
  return buildMetadataAdapters(metadataConfig()).length > 0;
}

export interface CatalogSearchOptions {
  category?: SearchCategory | null;
  q?: string;
  genre?: string;
  limit?: number;
  offset?: number;
  /** Ask providers even when the local rows look sufficient. */
  live?: boolean;
  /** Acting org, used to rate-limit external provider calls. */
  orgId: string;
}

export interface CatalogSearchResult {
  items: CatalogItem[];
  /** Where the returned rows came from. */
  origin: "local" | "providers";
  providers: MetadataSource[];
  /** True when the org's provider quota is spent and only local rows ran. */
  providerQuotaExhausted?: boolean;
}

function clampLimit(limit: number | undefined): number {
  if (!limit || Number.isNaN(limit)) return 24;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

function categoryFilters(
  category: SearchCategory | null | undefined,
  query: string,
  genre?: string,
) {
  const filters = [];
  if (category) {
    filters.push(eq(catalogItems.kind, mediaKindForCategory(category)));
    if (category === "anime") filters.push(hasGenre(catalogItems.genres, "Anime"));
  }
  if (genre) filters.push(hasGenre(catalogItems.genres, genre));
  if (query) {
    const like = `%${query}%`;
    filters.push(sql`(${catalogItems.title} ilike ${like} or ${catalogItems.subtitle} ilike ${like})`);
  }
  return filters;
}

async function localSearch(
  category: SearchCategory | null | undefined,
  query: string,
  limit: number,
  offset: number,
  genre?: string,
): Promise<CatalogItem[]> {
  const db = getDb();
  const filters = categoryFilters(category, query, genre);
  const rows = await db
    .select()
    .from(catalogItems)
    .where(filters.length ? and(...filters) : undefined)
    .orderBy(catalogItems.title)
    .limit(limit)
    .offset(offset);
  return rows.map(mapCatalogItem);
}

/** Insert provider candidates (ignoring duplicates) and read back their rows. */
async function upsertCandidates(candidates: MetadataCandidate[]): Promise<CatalogItem[]> {
  if (candidates.length === 0) return [];
  const db = getDb();
  await db
    .insert(catalogItems)
    .values(
      candidates.map((candidate) => ({
        kind: candidate.kind,
        title: candidate.title,
        subtitle: candidate.subtitle,
        year: candidate.year,
        imageUrl: candidate.imageUrl ?? candidate.coverUrl,
        coverUrl: candidate.coverUrl,
        backdropUrl: candidate.backdropUrl,
        description: candidate.description,
        genres: candidate.genres,
        trailerUrl: candidate.trailerUrl,
        externalRef: candidate.externalRef,
        externalId: candidate.externalId,
        source: candidate.source,
        metadata: candidate.metadata,
        links: {},
        tags: [],
      })),
    )
    .onConflictDoNothing();

  const refs = [...new Set(candidates.map((candidate) => candidate.externalRef))];
  const rows = await db.select().from(catalogItems).where(inArray(catalogItems.externalRef, refs));
  return rows.map(mapCatalogItem);
}

/** Race provider search against a deadline; never throw. */
async function providerSearch(
  category: SearchCategory,
  query: string,
  limit: number,
): Promise<MetadataCandidate[]> {
  const config = metadataConfig();
  const search = searchMetadata(category, query, config, limit).catch(() => []);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<MetadataCandidate[]>((resolve) => {
    timer = setTimeout(() => resolve([]), PROVIDER_DEADLINE_MS);
  });
  try {
    return await Promise.race([search, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
    // Keep the request alive long enough to store late arrivals.
    void search.then((late) => (late.length ? upsertCandidates(late) : undefined)).catch(() => {});
  }
}

export async function searchCatalog(options: CatalogSearchOptions): Promise<CatalogSearchResult> {
  const query = options.q?.trim() ?? "";
  const limit = clampLimit(options.limit);
  const offset = Math.max(0, options.offset ?? 0);
  const category = options.category ?? null;
  const genre = options.genre?.trim() || undefined;

  const local = await localSearch(category, query, limit, offset, genre);

  const canAskProviders =
    liveSearchEnabled() &&
    !genre &&
    offset === 0 &&
    query.length >= MIN_QUERY_LENGTH &&
    (options.live || local.length < LOCAL_MATCHES_ENOUGH);

  if (!canAskProviders) {
    return { items: local, origin: "local", providers: [] };
  }

  const quota = await consumeAction("search", options.orgId, SEARCH_WINDOW);
  if (!quota.allowed) {
    // Local results are still useful; only the metered provider hop is skipped.
    return { items: local, origin: "local", providers: [], providerQuotaExhausted: true };
  }

  // Without a category the query is most likely a movie/TV title, so ask there;
  // the user can narrow with the category pills.
  const searchCategory: SearchCategory = category ?? "movie";
  const candidates = await providerSearch(searchCategory, query, limit);
  const providers = [...new Set(candidates.map((candidate) => candidate.source))];
  if (candidates.length === 0) {
    return { items: local, origin: "local", providers: [] };
  }

  const stored = await upsertCandidates(candidates);
  const byId = new Map<string, CatalogItem>();
  for (const item of stored) byId.set(item.id, item);
  const serverItems = [...byId.values()];

  const seen = new Set(local.map((item) => item.id));
  const merged = [...local];
  for (const item of serverItems) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    merged.push(item);
  }

  return { items: merged.slice(0, limit), origin: "providers", providers };
}

/**
 * Pull richer provider details (trailer, backdrop, cast, tracklist) for a
 * provider-sourced item and persist them. Best effort; called after the item
 * detail page has rendered.
 */
export async function hydrateCatalogItem(itemId: string): Promise<void> {
  if (!liveSearchEnabled()) return;
  const db = getDb();
  const rows = await db.select().from(catalogItems).where(eq(catalogItems.id, itemId)).limit(1);
  const row = rows[0];
  if (!row || !row.source || !row.externalId) return;
  const existing = (row.metadata ?? {}) as Record<string, unknown>;
  // Already hydrated once.
  if (existing.hydrated === true) return;

  const candidate: MetadataCandidate = {
    kind: row.kind,
    title: row.title,
    subtitle: row.subtitle,
    year: row.year ?? null,
    imageUrl: row.imageUrl ?? null,
    coverUrl: row.coverUrl ?? row.imageUrl ?? null,
    backdropUrl: row.backdropUrl ?? null,
    description: row.description ?? null,
    genres: row.genres ?? [],
    trailerUrl: row.trailerUrl ?? null,
    externalRef: row.externalRef ?? `${row.source}:${row.externalId}`,
    externalId: row.externalId,
    source: row.source as MetadataSource,
    metadata: existing,
  };

  const hydrated = await loadMetadataDetails(candidate, metadataConfig()).catch(() => candidate);
  const metadata: Record<string, unknown> = { ...(hydrated.metadata ?? {}), hydrated: true };
  const credits = Array.isArray(metadata.credits) ? metadata.credits : [];

  await db
    .update(catalogItems)
    .set({
      description: hydrated.description ?? row.description,
      backdropUrl: hydrated.backdropUrl ?? row.backdropUrl,
      trailerUrl: hydrated.trailerUrl ?? row.trailerUrl,
      metadata,
    })
    .where(eq(catalogItems.id, itemId));

  const [{ n: existingCredits } = { n: 0 }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.catalogCredits)
    .where(eq(schema.catalogCredits.itemId, itemId));
  if (existingCredits > 0) return;

  const seen = new Set<string>();
  const rowsToInsert: Array<{
    itemId: string;
    personName: string;
    personSlug: string;
    role: string;
    character: string | null;
    position: number;
  }> = [];
  for (const credit of credits as Array<Record<string, unknown>>) {
    const name = typeof credit.name === "string" ? credit.name.trim() : "";
    const slug = typeof credit.slug === "string" ? credit.slug.trim() : "";
    if (!name || !slug) continue;
    const role = typeof credit.role === "string" ? credit.role.slice(0, 40) : "actor";
    const key = `${slug}:${role}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rowsToInsert.push({
      itemId,
      personName: name.slice(0, 120),
      personSlug: slug.slice(0, 80),
      role,
      character: typeof credit.character === "string" ? credit.character.slice(0, 120) : null,
      position: rowsToInsert.length,
    });
    if (rowsToInsert.length >= 20) break;
  }
  if (rowsToInsert.length > 0) await db.insert(schema.catalogCredits).values(rowsToInsert);
}
