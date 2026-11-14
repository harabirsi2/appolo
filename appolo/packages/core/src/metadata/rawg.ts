import type { MetadataAdapter, MetadataCandidate, MetadataConfig, MetadataDetails } from "./types";
import { httpsOnly, list, requestJson, text, yearOf, type Json } from "./shared";

/**
 * RAWG adapter for video games. Requires a free RAWG_API_KEY; without one the
 * adapter is simply not registered, so search still works for every other
 * category.
 */
function art(value: unknown): string | null {
  return httpsOnly(text(value, 500));
}

function platforms(row: Json): string[] {
  return list(row.platforms)
    .map((entry) => text((entry.platform as Json | undefined)?.name, 60))
    .filter(Boolean)
    .slice(0, 8);
}

function candidateFor(row: Json): MetadataCandidate | null {
  const id = row.id;
  const title = text(row.name, 200);
  if (!id || !title) return null;
  const genres = list(row.genres)
    .map((genre) => text(genre.name, 60))
    .filter(Boolean);
  const idText = String(id);
  return {
    kind: "game",
    title,
    subtitle: platforms(row)[0] ?? "",
    year: yearOf(row.released),
    imageUrl: art(row.background_image),
    coverUrl: art(row.background_image),
    backdropUrl: art(row.background_image_additional) ?? art(row.background_image),
    description: text(row.description_raw, 1500) || null,
    genres,
    trailerUrl: null,
    externalRef: `rawg:${idText}`,
    externalId: idText,
    source: "rawg",
    metadata: {
      rawgId: idText,
      rating: typeof row.rating === "number" ? row.rating : null,
      metacritic: typeof row.metacritic === "number" ? row.metacritic : null,
      platforms: platforms(row),
      released: text(row.released, 40) || null,
    },
  };
}

async function searchRawg(
  query: string,
  limit: number,
  config: MetadataConfig,
): Promise<MetadataCandidate[]> {
  const key = config.rawgApiKey?.trim();
  if (!key) return [];
  const data = await requestJson(
    `https://api.rawg.io/api/games?key=${encodeURIComponent(key)}&search=${encodeURIComponent(query)}&page_size=${Math.min(limit, 20)}`,
    { fetchImpl: config.fetchImpl, timeoutMs: config.timeoutMs },
  );
  return list(data?.results)
    .map(candidateFor)
    .filter((row): row is MetadataCandidate => Boolean(row));
}

async function details(candidate: MetadataCandidate, config: MetadataConfig): Promise<MetadataDetails | null> {
  const key = config.rawgApiKey?.trim();
  if (!key || candidate.source !== "rawg") return null;
  const data = await requestJson(
    `https://api.rawg.io/api/games/${encodeURIComponent(candidate.externalId)}?key=${encodeURIComponent(key)}`,
    { fetchImpl: config.fetchImpl, timeoutMs: config.timeoutMs },
  );
  if (!data) return null;
  const developers = list(data.developers)
    .map((entry) => text(entry.name, 120))
    .filter(Boolean);
  const publishers = list(data.publishers)
    .map((entry) => text(entry.name, 120))
    .filter(Boolean);
  return {
    description: text(data.description_raw, 4000) || candidate.description,
    backdropUrl: art(data.background_image_additional) ?? candidate.backdropUrl,
    metadata: {
      ...candidate.metadata,
      developers,
      publishers,
      playtime: typeof data.playtime === "number" ? data.playtime : null,
      website: httpsOnly(text(data.website, 500) || ""),
    },
  };
}

export function createRawgAdapter(config: MetadataConfig = {}): MetadataAdapter {
  return {
    source: "rawg",
    supports: (category) => category === "game",
    search: (_category, query, limit) => searchRawg(query, limit, config),
    details: (candidate) => details(candidate, config),
  };
}

export const rawgInternals = { candidateFor, platforms };