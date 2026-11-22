import type { MediaKind } from "../ranking";

/**
 * Provider categories shown before a search is typed. "Anime" is a lens over
 * TV metadata (Japanese animation), not a separate catalog kind: items are
 * stored as `tv` with an "Anime" genre so ranking/filtering stays consistent.
 */
export const SEARCH_CATEGORIES = ["movie", "tv", "anime", "music", "podcast", "book", "game"] as const;
export type SearchCategory = (typeof SEARCH_CATEGORIES)[number];

export function isSearchCategory(value: unknown): value is SearchCategory {
  return typeof value === "string" && (SEARCH_CATEGORIES as readonly string[]).includes(value);
}

export function mediaKindForCategory(category: SearchCategory): MediaKind {
  return category === "anime" ? "tv" : category;
}

export function categoryLabel(category: SearchCategory): string {
  switch (category) {
    case "movie":
      return "Movies";
    case "tv":
      return "TV";
    case "anime":
      return "Anime";
    case "music":
      return "Music";
    case "podcast":
      return "Podcasts";
    case "book":
      return "Books";
    case "game":
      return "Video games";
  }
}

export type MetadataSource = "tmdb" | "itunes" | "openlibrary" | "rawg" | "seed";

export interface MetadataCandidate {
  kind: MediaKind;
  title: string;
  subtitle: string;
  year: number | null;
  imageUrl: string | null;
  coverUrl: string | null;
  backdropUrl: string | null;
  description: string | null;
  genres: string[];
  trailerUrl: string | null;
  externalRef: string;
  externalId: string;
  source: MetadataSource;
  metadata: Record<string, unknown>;
}

export interface MetadataCredit {
  name: string;
  slug: string;
  role: string;
  character: string | null;
}

export interface MetadataDetails {
  description?: string | null;
  backdropUrl?: string | null;
  trailerUrl?: string | null;
  metadata?: Record<string, unknown>;
  credits?: MetadataCredit[];
}

/** One episode, as reported by a provider's per-season endpoint. */
export interface MetadataEpisode {
  seasonNumber: number;
  episodeNumber: number;
  title: string | null;
  airDate: string | null;
  runtime: number | null;
}

export interface MetadataAdapter {
  source: MetadataSource;
  supports(category: SearchCategory): boolean;
  search(category: SearchCategory, query: string, limit: number): Promise<MetadataCandidate[]>;
  details?(candidate: MetadataCandidate): Promise<MetadataDetails | null>;
  /**
   * Episode list for one season. Optional because it costs one request per
   * season, unlike the season list that `details()` already embeds; the worker
   * calls it with a cap so a long-running show cannot drain the quota.
   */
  seasonEpisodes?(candidate: MetadataCandidate, seasonNumber: number): Promise<MetadataEpisode[]>;
}

export interface MetadataConfig {
  tmdbApiKey?: string | null;
  rawgApiKey?: string | null;
  /**
   * When set, only these providers are registered. The web layer passes the
   * parsed `CATALOG_PROVIDERS` value so an unconfigured install never reaches
   * out to a third party (and CI stays offline).
   */
  enabled?: readonly MetadataSource[];
  /** Overridable for tests and for callers that share a request scope. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export const DEFAULT_METADATA_TIMEOUT_MS = 900;