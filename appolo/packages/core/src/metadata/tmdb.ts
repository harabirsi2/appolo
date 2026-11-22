import type {
  MetadataAdapter,
  MetadataCandidate,
  MetadataConfig,
  MetadataCredit,
  MetadataDetails,
  MetadataEpisode,
  SearchCategory,
} from "./types";
import { httpsOnly, list, requestJson, slugifyPerson, text, yearOf, type Json } from "./shared";

/**
 * TMDB adapter for movies, TV and anime.
 *
 * Anime is detected the way the product spec defines it: Japanese origin plus
 * animation genre. Those titles are stored as `tv` with the "Anime" genre so
 * ranking and category math stay on the six real media kinds.
 */
const TMDB_GENRES: Record<number, string> = {
  28: "Action",
  12: "Adventure",
  16: "Animation",
  35: "Comedy",
  80: "Crime",
  99: "Documentary",
  18: "Drama",
  10751: "Family",
  14: "Fantasy",
  36: "History",
  27: "Horror",
  10402: "Music",
  9648: "Mystery",
  10749: "Romance",
  878: "Sci-Fi",
  10770: "TV Movie",
  53: "Thriller",
  10752: "War",
  37: "Western",
  10759: "Action & Adventure",
  10762: "Kids",
  10763: "News",
  10764: "Reality",
  10765: "Sci-Fi & Fantasy",
  10766: "Soap",
  10767: "Talk",
  10768: "War & Politics",
};

function apiKey(config: MetadataConfig): string | null {
  const key = config.tmdbApiKey?.trim();
  return key ? key : null;
}

function endpoint(path: string, key: string, params: Record<string, string> = {}): string {
  const url = new URL(`https://api.themoviedb.org/3${path}`);
  for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
  if (!key.startsWith("eyJ")) url.searchParams.set("api_key", key);
  return url.toString();
}

function headers(key: string): Record<string, string> {
  return key.startsWith("eyJ") ? { authorization: `Bearer ${key}` } : {};
}

function genresFor(row: Json): string[] {
  const ids = Array.isArray(row.genre_ids) ? (row.genre_ids as unknown[]) : [];
  return ids
    .map((id) => (typeof id === "number" ? TMDB_GENRES[id] : undefined))
    .filter((value): value is string => Boolean(value));
}

function isAnimeRow(row: Json): boolean {
  const origin = Array.isArray(row.origin_country) ? (row.origin_country as unknown[]) : [];
  const genres = Array.isArray(row.genre_ids) ? (row.genre_ids as unknown[]) : [];
  return origin.includes("JP") && genres.includes(16);
}

function poster(value: unknown, size = "w500"): string | null {
  const path = text(value, 200);
  return path.startsWith("/") ? httpsOnly(`https://image.tmdb.org/t/p/${size}${path}`) : null;
}

function candidateFor(
  category: SearchCategory,
  kind: "movie" | "tv",
  row: Json,
): MetadataCandidate | null {
  if (!row.id) return null;
  const anime = category === "anime" || (kind === "tv" && isAnimeRow(row));
  const title = text(kind === "movie" ? row.title : row.name, 200);
  if (!title) return null;
  const year = yearOf(kind === "movie" ? row.release_date : row.first_air_date);
  const genres = genresFor(row);
  if (anime && !genres.includes("Anime")) genres.unshift("Anime");
  const id = String(row.id);
  return {
    kind,
    title,
    subtitle: year ? String(year) : "",
    year,
    imageUrl: poster(row.poster_path),
    coverUrl: poster(row.poster_path),
    backdropUrl: poster(row.backdrop_path, "w1280"),
    description: text(row.overview, 1500) || null,
    genres: anime ? ["Anime", ...genres.filter((genre) => genre !== "Anime")] : genres,
    trailerUrl: null,
    externalRef: `tmdb:${kind}:${id}`,
    externalId: id,
    source: "tmdb",
    metadata: {
      tmdbId: id,
      voteAverage: typeof row.vote_average === "number" ? row.vote_average : null,
      voteCount: typeof row.vote_count === "number" ? row.vote_count : null,
      originalLanguage: text(row.original_language, 20) || null,
      originCountry: Array.isArray(row.origin_country) ? row.origin_country : [],
      popularity: typeof row.popularity === "number" ? row.popularity : null,
      anime,
    },
  };
}

async function searchTmdb(
  category: SearchCategory,
  query: string,
  limit: number,
  config: MetadataConfig,
): Promise<MetadataCandidate[]> {
  const key = apiKey(config);
  if (!key) return [];
  const kind = category === "anime" ? "tv" : category;
  if (kind !== "movie" && kind !== "tv") return [];
  const data = await requestJson(
    endpoint(`/search/${kind}`, key, { query, include_adult: "false", page: "1" }),
    { fetchImpl: config.fetchImpl, timeoutMs: config.timeoutMs, headers: headers(key) },
  );
  const rows = list(data?.results)
    .filter((row) => (category === "anime" ? isAnimeRow(row) : true))
    .slice(0, limit);
  return rows
    .map((row) => candidateFor(category, kind, row))
    .filter((row): row is MetadataCandidate => Boolean(row));
}

async function details(candidate: MetadataCandidate, config: MetadataConfig): Promise<MetadataDetails | null> {
  const key = apiKey(config);
  if (!key || candidate.source !== "tmdb") return null;
  const kind = candidate.kind === "movie" ? "movie" : "tv";
  const data = await requestJson(
    endpoint(`/${kind}/${candidate.externalId}`, key, { append_to_response: "credits,videos" }),
    { fetchImpl: config.fetchImpl, timeoutMs: config.timeoutMs, headers: headers(key) },
  );
  if (!data) return null;

  const videos = list((data.videos as Json | undefined)?.results);
  const trailer =
    videos.find((video) => video.site === "YouTube" && video.type === "Trailer") ??
    videos.find((video) => video.site === "YouTube" && (video.type === "Teaser" || video.type === "Clip"));
  const trailerKey = trailer ? text(trailer.key, 40) : "";

  const creditsRaw = list((data.credits as Json | undefined)?.cast);
  const crew = list((data.credits as Json | undefined)?.crew);
  const credits: MetadataCredit[] = creditsRaw.slice(0, 12).map((person) => {
    const name = text(person.name, 120);
    return {
      name,
      slug: slugifyPerson(name),
      role: "actor",
      character: text(person.character, 120) || null,
    };
  });
  for (const person of crew) {
    if (person.job !== "Director") continue;
    const name = text(person.name, 120);
    if (!name) continue;
    credits.push({ name, slug: slugifyPerson(name), role: "director", character: null });
  }

  const runtime = typeof data.runtime === "number" ? data.runtime : null;
  const seasons = typeof data.number_of_seasons === "number" ? data.number_of_seasons : null;
  // `/tv/{id}` already embeds the season list, so season entities cost no extra
  // request. Episode lists need a per-season call and are not fetched here.
  const seasonList =
    kind === "tv"
      ? list(data.seasons)
          .map((season) => ({
            seasonNumber: typeof season.season_number === "number" ? season.season_number : null,
            name: text(season.name, 120) || null,
            year: yearOf(season.air_date),
            episodeCount: typeof season.episode_count === "number" ? season.episode_count : null,
            imageUrl: poster(season.poster_path, "w342"),
          }))
          .filter((season) => season.seasonNumber !== null && season.seasonNumber > 0)
      : [];
  const director = credits.find((credit) => credit.role === "director")?.name ?? null;

  return {
    description: text(data.overview, 4000) || candidate.description,
    backdropUrl: poster(data.backdrop_path, "w1280") ?? candidate.backdropUrl,
    trailerUrl: trailerKey ? `https://www.youtube.com/watch?v=${trailerKey}` : null,
    metadata: {
      ...candidate.metadata,
      runtime,
      seasons,
      seasonList,
      status: text(data.status, 40) || null,
      tagline: text(data.tagline, 300) || null,
      director,
      cast: credits.filter((credit) => credit.role === "actor").map((credit) => credit.name),
    },
    credits,
  };
}

/**
 * Episodes for one season. `/tv/{id}` embeds the season list but not its
 * episodes, so this is the one entity that costs a request per season; the
 * worker caps how many seasons it asks for.
 */
async function seasonEpisodes(
  candidate: MetadataCandidate,
  seasonNumber: number,
  config: MetadataConfig,
): Promise<MetadataEpisode[]> {
  const key = apiKey(config);
  if (!key || candidate.source !== "tmdb" || candidate.kind !== "tv") return [];
  if (!Number.isInteger(seasonNumber) || seasonNumber <= 0) return [];
  const data = await requestJson(
    endpoint(`/tv/${candidate.externalId}/season/${seasonNumber}`, key),
    { fetchImpl: config.fetchImpl, timeoutMs: config.timeoutMs, headers: headers(key) },
  );
  if (!data) return [];
  const out: MetadataEpisode[] = [];
  for (const row of list(data.episodes)) {
    const episodeNumber = typeof row.episode_number === "number" ? row.episode_number : 0;
    // Episode 0 is how TMDB reports specials, which are not rateable episodes.
    if (episodeNumber <= 0) continue;
    out.push({
      seasonNumber: typeof row.season_number === "number" ? row.season_number : seasonNumber,
      episodeNumber,
      title: text(row.name, 200) || null,
      airDate: text(row.air_date, 20) || null,
      runtime: typeof row.runtime === "number" ? row.runtime : null,
    });
  }
  return out;
}

export function createTmdbAdapter(config: MetadataConfig = {}): MetadataAdapter {
  return {
    source: "tmdb",
    supports: (category) => category === "movie" || category === "tv" || category === "anime",
    search: (category, query, limit) => searchTmdb(category, query, limit, config),
    details: (candidate) => details(candidate, config),
    seasonEpisodes: (candidate, seasonNumber) => seasonEpisodes(candidate, seasonNumber, config),
  };
}

/** Exported for unit tests: no network required. */
export const tmdbInternals = { genresFor, isAnimeRow, candidateFor, poster };