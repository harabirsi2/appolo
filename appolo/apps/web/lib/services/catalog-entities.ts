import { and, eq } from "drizzle-orm";
import type { MetadataCredit, MetadataDetails, MediaKind } from "@appolo/core";
import { schema, type Db } from "@appolo/db";

const { catalogItems, artists, seasons, episodes, itemArtists } = schema;

/**
 * Materialise the rateable entities behind a provider item.
 *
 * A rateable thing is always a `catalog_items` row (that is what
 * `item_ratings.item_id` and `item_matchups` point at), with the subtype row
 * — artist, season or episode — attached 1:1. Both rows are written in one
 * transaction, so a half-created artist (item row without a subtype row) can
 * never be rated.
 *
 * Everything here is idempotent: the worker may enrich the same item twice and
 * the second pass only adds what is missing.
 */

/** The transaction type of a drizzle connection, without importing internals. */
type Executor = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface EpisodeInput {
  seasonNumber: number;
  episodeNumber: number;
  title?: string | null;
  airDate?: string | null;
  runtime?: number | null;
}

export interface SeasonInput {
  seasonNumber: number;
  title?: string | null;
  year?: number | null;
  imageUrl?: string | null;
  episodes?: EpisodeInput[];
}

export interface EntitySyncInput {
  /** The already-stored provider item these entities belong to. */
  itemId: string;
  kind: MediaKind;
  title: string;
  year: number | null;
  /** Provider prefix for external refs, e.g. "tmdb". */
  source: string;
  details: MetadataDetails & { metadata?: Record<string, unknown>; episodes?: EpisodeInput[] };
  /**
   * Optional episode payload, either here or on `details.episodes`. The worker
   * passes none today: TMDB embeds seasons on the series but needs one request
   * per season for episodes, which the enrichment step does not spend.
   */
  episodes?: EpisodeInput[];
}

export interface EntitySyncResult {
  artists: number;
  seasons: number;
  episodes: number;
}

function slugify(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asText(value: unknown, max = 200): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
}

/** Normalise the provider's season payload, falling back to a bare count. */
export function seasonsFromDetails(
  details: EntitySyncInput["details"],
  episodes: EpisodeInput[] = [],
): SeasonInput[] {
  const raw = details.metadata?.seasonList;
  const out: SeasonInput[] = [];
  if (Array.isArray(raw)) {
    for (const entry of raw) {
      if (!entry || typeof entry !== "object") continue;
      const row = entry as Record<string, unknown>;
      const seasonNumber = asNumber(row.seasonNumber);
      if (seasonNumber === null || seasonNumber <= 0) continue;
      out.push({
        seasonNumber,
        title: asText(row.name, 120),
        year: asNumber(row.year),
        imageUrl: asText(row.imageUrl, 500),
      });
    }
  }
  if (out.length === 0) {
    // TMDB also reports how many seasons exist; shells keep the season rateable
    // before we ever fetch per-season detail.
    const count = asNumber(details.metadata?.seasons);
    for (let n = 1; n <= Math.min(count ?? 0, 60); n += 1) out.push({ seasonNumber: n });
  }
  for (const episode of episodes) {
    const season = out.find((entry) => entry.seasonNumber === episode.seasonNumber);
    if (season) (season.episodes ??= []).push(episode);
  }
  return out;
}

/** Read an optional episode list that a provider put on the details payload. */
export function episodesFromDetails(details: EntitySyncInput["details"]): EpisodeInput[] {
  const raw: unknown = details.episodes;
  if (!Array.isArray(raw)) return [];
  const out: EpisodeInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const row = entry as Record<string, unknown>;
    const seasonNumber = asNumber(row.seasonNumber);
    const episodeNumber = asNumber(row.episodeNumber);
    if (seasonNumber === null || episodeNumber === null) continue;
    out.push({
      seasonNumber,
      episodeNumber,
      title: asText(row.title, 200),
      airDate: asText(row.airDate, 20),
      runtime: asNumber(row.runtime),
    });
  }
  return out;
}

const ROLE_MAP: Record<string, "primary" | "featured" | "author" | "developer"> = {
  actor: "featured",
  director: "primary",
  author: "author",
  developer: "developer",
};

async function syncArtist(
  tx: Executor,
  input: EntitySyncInput,
  credit: MetadataCredit,
  position: number,
): Promise<boolean> {
  const name = credit.name.trim().slice(0, 200);
  if (!name) return false;
  const externalRef = `${input.source}:person:${credit.slug || slugify(name)}`;

  let [artist] = await tx
    .select({ id: artists.id })
    .from(artists)
    .where(eq(artists.externalRef, externalRef))
    .limit(1);

  let created = false;
  if (!artist) {
    // subtitle is fixed so the (kind, title, subtitle) unique index treats two
    // people who share a name as one artist; a disambiguating provider id in
    // externalRef is the follow-up that removes that limitation.
    const [item] = await tx
      .insert(catalogItems)
      .values({
        kind: input.kind,
        title: name,
        subtitle: "person",
        entityType: "artist",
        enrichmentStatus: "ready",
        externalRef,
        source: input.source,
        links: {},
        tags: [],
        metadata: { creditRole: credit.role, character: credit.character },
      })
      .onConflictDoNothing()
      .returning({ id: catalogItems.id });
    if (!item) return false;

    [artist] = await tx
      .insert(artists)
      .values({
        catalogItemId: item.id,
        name,
        externalRef,
        metadata: { role: credit.role, character: credit.character },
      })
      .onConflictDoNothing()
      .returning({ id: artists.id });
    if (!artist) return false;
    created = true;
  }

  await tx
    .insert(itemArtists)
    .values({
      itemId: input.itemId,
      artistId: artist.id,
      role: ROLE_MAP[credit.role] ?? "primary",
      position,
    })
    .onConflictDoNothing();
  return created;
}

async function syncSeason(
  tx: Executor,
  input: EntitySyncInput,
  season: SeasonInput,
): Promise<boolean> {
  const [existing] = await tx
    .select({ id: seasons.id })
    .from(seasons)
    .where(and(eq(seasons.parentItemId, input.itemId), eq(seasons.seasonNumber, season.seasonNumber)))
    .limit(1);
  if (existing) return false;

  // The show name is part of the title because "Season 1" repeats across every
  // series and the catalog's unique index is (kind, title, subtitle).
  const label = season.title ?? `Season ${season.seasonNumber}`;
  const title = `${input.title} — ${label}`.slice(0, 220);
  const [item] = await tx
    .insert(catalogItems)
    .values({
      kind: input.kind,
      title,
      subtitle: "",
      year: season.year ?? input.year,
      imageUrl: season.imageUrl ?? null,
      entityType: "season",
      enrichmentStatus: "ready",
      links: {},
      tags: [],
      metadata: { parentItemId: input.itemId, seasonNumber: season.seasonNumber },
    })
    .onConflictDoNothing()
    .returning({ id: catalogItems.id });
  if (!item) return false;

  const [seasonRow] = await tx
    .insert(seasons)
    .values({
      catalogItemId: item.id,
      parentItemId: input.itemId,
      seasonNumber: season.seasonNumber,
      title: season.title ?? null,
      year: season.year ?? null,
      imageUrl: season.imageUrl ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: seasons.id });
  return Boolean(seasonRow);
}

async function syncEpisode(
  tx: Executor,
  input: EntitySyncInput,
  seasonId: string,
  seasonNumber: number,
  episode: EpisodeInput,
): Promise<boolean> {
  const [existing] = await tx
    .select({ id: episodes.id })
    .from(episodes)
    .where(and(eq(episodes.seasonId, seasonId), eq(episodes.episodeNumber, episode.episodeNumber)))
    .limit(1);
  if (existing) return false;

  const code = `S${seasonNumber}E${episode.episodeNumber}`;
  const title = `${input.title} — ${code}${episode.title ? ` ${episode.title}` : ""}`.slice(0, 220);
  const [item] = await tx
    .insert(catalogItems)
    .values({
      kind: input.kind,
      title,
      subtitle: "",
      entityType: "episode",
      enrichmentStatus: "ready",
      links: {},
      tags: [],
      metadata: { seasonId, seasonNumber, episodeNumber: episode.episodeNumber },
    })
    .onConflictDoNothing()
    .returning({ id: catalogItems.id });
  if (!item) return false;

  const [episodeRow] = await tx
    .insert(episodes)
    .values({
      catalogItemId: item.id,
      seasonId,
      episodeNumber: episode.episodeNumber,
      title: episode.title ?? null,
      airDate: episode.airDate ?? null,
      runtime: episode.runtime ?? null,
    })
    .onConflictDoNothing()
    .returning({ id: episodes.id });
  return Boolean(episodeRow);
}

async function syncAll(tx: Executor, input: EntitySyncInput): Promise<EntitySyncResult> {
  const result: EntitySyncResult = { artists: 0, seasons: 0, episodes: 0 };

  const credits = input.details.credits ?? [];
  for (const [index, credit] of credits.slice(0, 24).entries()) {
    if (await syncArtist(tx, input, credit, index)) result.artists += 1;
  }

  if (input.kind === "tv") {
    // Episodes may arrive on the input or inside the details payload (a provider
    // that already fetched a season's episodes can hand them straight over).
    const episodes = input.episodes ?? episodesFromDetails(input.details);
    for (const season of seasonsFromDetails(input.details, episodes)) {
      if (await syncSeason(tx, input, season)) result.seasons += 1;
      const [row] = await tx
        .select({ id: seasons.id })
        .from(seasons)
        .where(and(eq(seasons.parentItemId, input.itemId), eq(seasons.seasonNumber, season.seasonNumber)))
        .limit(1);
      if (!row) continue;
      for (const episode of season.episodes ?? []) {
        if (await syncEpisode(tx, input, row.id, season.seasonNumber, episode)) result.episodes += 1;
      }
    }
  }

  return result;
}

/**
 * Create the artist/season/episode rows for one stored item, in one
 * transaction. Safe to call repeatedly.
 */
export async function materializeEntities(db: Db, input: EntitySyncInput): Promise<EntitySyncResult> {
  return db.transaction(async (tx) => syncAll(tx, input));
}
