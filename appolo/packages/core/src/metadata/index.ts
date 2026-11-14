import type { MetadataAdapter, MetadataCandidate, MetadataConfig, MetadataSource, SearchCategory } from "./types";
import { createItunesAdapter } from "./itunes";
import { createOpenLibraryAdapter } from "./openlibrary";
import { createRawgAdapter } from "./rawg";
import { createTmdbAdapter } from "./tmdb";
import { uniqBy } from "./shared";

export * from "./types";
export * from "./shared";
export { createTmdbAdapter, tmdbInternals } from "./tmdb";
export { createItunesAdapter } from "./itunes";
export { createOpenLibraryAdapter } from "./openlibrary";
export { createRawgAdapter } from "./rawg";

/**
 * Registered adapters. TMDB and RAWG are key-gated; iTunes and Open Library
 * are free. When TMDB is absent, iTunes supplies movie artwork so that
 * category still hydrates instead of showing gradient placeholders.
 */
export function buildMetadataAdapters(config: MetadataConfig = {}): MetadataAdapter[] {
  const enabled = config.enabled ? new Set(config.enabled) : null;
  const keep = (source: MetadataSource): boolean => !enabled || enabled.has(source);
  const adapters: MetadataAdapter[] = [];
  if (config.tmdbApiKey?.trim() && keep("tmdb")) adapters.push(createTmdbAdapter(config));
  if (keep("itunes")) adapters.push(createItunesAdapter(config));
  if (keep("openlibrary")) adapters.push(createOpenLibraryAdapter(config));
  if (config.rawgApiKey?.trim() && keep("rawg")) adapters.push(createRawgAdapter(config));
  return adapters;
}

function dedupeKey(candidate: MetadataCandidate): string {
  return `${candidate.source}:${candidate.externalId}`;
}

/**
 * Search every adapter that supports the category concurrently, keeping the
 * first provider (TMDB before iTunes) for duplicate titles.
 */
export async function searchMetadata(
  category: SearchCategory,
  query: string,
  config: MetadataConfig = {},
  limit = 10,
): Promise<MetadataCandidate[]> {
  const adapters = buildMetadataAdapters(config).filter((adapter) => adapter.supports(category));
  if (adapters.length === 0) return [];
  const results = await Promise.allSettled(adapters.map((adapter) => adapter.search(category, query, limit)));
  const candidates: MetadataCandidate[] = [];
  for (const result of results) {
    if (result.status === "fulfilled") candidates.push(...result.value);
  }
  return uniqBy(candidates, dedupeKey).slice(0, limit);
}

/** Resolve richer details (cast, trailer, tracklist) for one search hit. */
export async function loadMetadataDetails(
  candidate: MetadataCandidate,
  config: MetadataConfig = {},
): Promise<MetadataCandidate> {
  const adapter = buildMetadataAdapters(config).find(
    (entry) => entry.source === candidate.source && entry.details,
  );
  if (!adapter?.details) return candidate;
  const details = await adapter.details(candidate).catch(() => null);
  if (!details) return candidate;
  return {
    ...candidate,
    description: details.description ?? candidate.description,
    backdropUrl: details.backdropUrl ?? candidate.backdropUrl,
    trailerUrl: details.trailerUrl ?? candidate.trailerUrl,
    metadata: { ...candidate.metadata, ...details.metadata, credits: details.credits ?? [] },
  };
}