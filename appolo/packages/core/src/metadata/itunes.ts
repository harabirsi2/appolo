import type {
  MetadataAdapter,
  MetadataCandidate,
  MetadataConfig,
  MetadataDetails,
  SearchCategory,
} from "./types";
import { httpsOnly, list, requestJson, text, yearOf } from "./shared";

/**
 * Apple iTunes Search/Lookup adapter. No API key or OAuth is required.
 *
 * Covers music albums and podcasts. It also acts as the movie fallback when no
 * TMDB key is configured, so a fresh install still gets real cover art.
 * Artwork is requested at 600x600; Apple serves that size for every entity.
 */
const ITUNES: Partial<Record<SearchCategory, { media: string; entity: string }>> = {
  movie: { media: "movie", entity: "movie" },
  music: { media: "music", entity: "album" },
  podcast: { media: "podcast", entity: "podcast" },
};

function art(value: unknown): string | null {
  const raw = text(value, 500);
  if (!raw) return null;
  return httpsOnly(raw.replace(/\/\d+x\d+bb\./, "/600x600bb."));
}

async function searchItunes(
  category: SearchCategory,
  query: string,
  limit: number,
  config: MetadataConfig,
): Promise<MetadataCandidate[]> {
  const spec = ITUNES[category];
  if (!spec) return [];
  const url =
    `https://itunes.apple.com/search?term=${encodeURIComponent(query)}` +
    `&media=${spec.media}&entity=${spec.entity}&limit=${Math.min(limit, 25)}`;
  const data = await requestJson(url, { fetchImpl: config.fetchImpl, timeoutMs: config.timeoutMs });
  const out: MetadataCandidate[] = [];
  for (const row of list(data?.results)) {
    const kind = category === "music" ? "music" : category === "podcast" ? "podcast" : "movie";
    const id = kind === "movie" ? row.trackId : row.collectionId;
    const title = text(kind === "movie" ? row.trackName : row.collectionName, 200);
    if (!id || !title) continue;
    const image = art(row.artworkUrl600) ?? art(row.artworkUrl100);
    const genre = text(row.primaryGenreName, 60);
    const idText = String(id);
    out.push({
      kind,
      title,
      subtitle: text(row.artistName, 200),
      year: yearOf(row.releaseDate),
      imageUrl: image,
      coverUrl: image,
      backdropUrl: null,
      description:
        text(row.longDescription, 1500) ||
        text(row.description, 1500) ||
        text(row.shortDescription, 1500) ||
        null,
      genres: genre ? [genre] : [],
      trailerUrl: httpsOnly(text(row.previewUrl, 500) || "") && kind === "movie" ? text(row.previewUrl, 500) : null,
      externalRef: `itunes:${kind}:${idText}`,
      externalId: idText,
      source: "itunes",
      metadata: {
        itunesId: idText,
        artistName: text(row.artistName, 200) || null,
        trackCount: typeof row.trackCount === "number" ? row.trackCount : null,
        collectionName: text(row.collectionName, 200) || null,
        feedUrl: httpsOnly(text(row.feedUrl, 500) || ""),
        copyright: text(row.copyright, 200) || null,
      },
    });
  }
  return out;
}

async function details(candidate: MetadataCandidate, config: MetadataConfig): Promise<MetadataDetails | null> {
  if (candidate.source !== "itunes" || candidate.kind !== "music") return null;
  const url = `https://itunes.apple.com/lookup?id=${encodeURIComponent(candidate.externalId)}&entity=song&limit=50`;
  const data = await requestJson(url, { fetchImpl: config.fetchImpl, timeoutMs: config.timeoutMs });
  const rows = list(data?.results);
  const album = rows.find((row) => String(row.collectionId ?? "") === candidate.externalId) ?? rows[0];
  const tracks = rows
    .filter((row) => row.wrapperType === "track" || row.kind === "song")
    .map((row) => text(row.trackName, 200))
    .filter(Boolean);
  return {
    description: candidate.description,
    metadata: {
      ...candidate.metadata,
      tracklist: tracks,
      recordLabel: album ? text(album.recordLabel, 120) || null : null,
      trackCount: tracks.length || (typeof album?.trackCount === "number" ? album.trackCount : null),
    },
  };
}

export function createItunesAdapter(config: MetadataConfig = {}): MetadataAdapter {
  return {
    source: "itunes",
    supports: (category) => category === "movie" || category === "music" || category === "podcast",
    search: (category, query, limit) => searchItunes(category, query, limit, config),
    details: (candidate) => details(candidate, config),
  };
}