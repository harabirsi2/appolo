import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  MEDIA_KINDS,
  blendGenreWeights,
  genreProfile,
  mediaKindSchema,
  normalizeGenreWeights,
  rankFeed,
  scoreForElo,
  tasteMatch,
  type MatchConfidence,
  type MediaKind,
} from "@appolo/core";
import { getDb, withOrg, schema } from "@/lib/db";
import { DomainError } from "./errors";
import { rankedRatings, watchlistFor, type CatalogItem, type RankedItem } from "./rankings";
import { listInterests } from "./interests";

const {
  profiles,
  follows,
  pods,
  podItems,
  catalogItems,
  itemRatings,
  ratingReactions,
  ratingComments,
  socialNotifications: notifications,
  searchHistory,
  ratingEvents,
} = schema;

export interface ProfileSummary {
  orgId: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarHue: number;
  followers: number;
  following: number;
  pinnedRatingId: string | null;
  manualMode: boolean;
  spotifyConnected: boolean;
  appleMusicConnected: boolean;
  language: string;
  profileLayout: "list" | "grid";
  /** Hand-curated top-five order per medium, when the profile set one. */
  podiumOrder: Partial<Record<MediaKind, string[]>>;
}

export interface ReactionSummary {
  emoji: string;
  count: number;
  mine: boolean;
}

export interface ReviewView {
  id: string;
  orgId: string;
  username: string;
  displayName: string;
  avatarHue: number;
  itemId: string;
  itemTitle: string;
  itemSubtitle: string;
  kind: MediaKind;
  year: number | null;
  score: number;
  tags: string[];
  text: string | null;
  spoiler: boolean;
  photoUrl: string | null;
  videoUrl: string | null;
  favoriteCharacter: string | null;
  favoriteTracks: string[];
  reactions: ReactionSummary[];
  commentCount: number;
  updatedAt: Date;
  /** Why the home feed surfaced this review, when it came from feed ranking. */
  reason?: string;
}

export interface CommunityStats {
  count: number;
  average: number | null;
  distribution: number[];
  reviews: ReviewView[];
}

export interface PodCard {
  id: string;
  orgId: string;
  title: string;
  slug: string;
  description: string | null;
  ownerUsername: string;
  ownerDisplayName: string;
  count: number;
  items: CatalogItem[];
}

export interface PodDetail extends PodCard {
  entries: Array<
    CatalogItem & { note: string | null; score: number | null; addedByUsername: string | null }
  >;
}

const httpsUrl = z
  .string()
  .trim()
  .max(500)
  .refine((value) => {
    if (value === "") return true;
    try {
      return new URL(value).protocol === "https:";
    } catch {
      return false;
    }
  }, "Use an https link.");

/** Written reviews (text or video) an account needs before it can attach photos. */
export const PHOTO_UNLOCK_REVIEWS = 20;

/** Photo links: https, or an app-relative path like /uploads/x.jpg. Blocks javascript:, data: and //host URLs. */
const mediaUrl = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => value === "" || /^https:\/\//i.test(value) || /^\/(?!\/)/.test(value),
    "Use an https link or an app-relative path.",
  );

export const reviewInputSchema = z.object({
  text: z.string().trim().max(10000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(32)).max(10).optional(),
  podIds: z.array(z.string().uuid()).max(8).optional(),
  spoiler: z.boolean().optional(),
  photoUrl: mediaUrl.optional().nullable(),
  videoUrl: httpsUrl.optional().nullable(),
  favoriteCharacter: z.string().trim().max(120).optional().nullable(),
  favoriteTracks: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

/* ------------------------------------------------------------------ */
/* profiles                                                            */
/* ------------------------------------------------------------------ */

function parsePodiumOrder(value: unknown): Partial<Record<MediaKind, string[]>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const order: Partial<Record<MediaKind, string[]>> = {};
  for (const kind of MEDIA_KINDS) {
    const ids = source[kind];
    if (!Array.isArray(ids)) continue;
    order[kind] = ids.filter((id): id is string => typeof id === "string").slice(0, 5);
  }
  return order;
}

function toProfileSummary(
  row: typeof profiles.$inferSelect,
  counts: { followers: number; following: number },
): ProfileSummary {
  return {
    orgId: row.orgId,
    username: row.username,
    displayName: row.displayName,
    bio: row.bio ?? null,
    avatarHue: row.avatarHue,
    followers: counts.followers,
    following: counts.following,
    pinnedRatingId: row.pinnedRatingId ?? null,
    manualMode: row.manualMode,
    spotifyConnected: row.spotifyConnected,
    appleMusicConnected: row.appleMusicConnected,
    language: row.language,
    profileLayout: row.profileLayout === "grid" ? "grid" : "list",
    podiumOrder: parsePodiumOrder(row.podiumOrder),
  };
}

async function followCounts(orgId: string): Promise<{ followers: number; following: number }> {
  const db = getDb();
  const [row] = await db
    .select({
      followers: sql<number>`count(*) filter (where ${follows.followeeOrgId} = ${orgId})::int`,
      following: sql<number>`count(*) filter (where ${follows.followerOrgId} = ${orgId})::int`,
    })
    .from(follows)
    .where(sql`${follows.followerOrgId} = ${orgId} or ${follows.followeeOrgId} = ${orgId}`);
  return { followers: row?.followers ?? 0, following: row?.following ?? 0 };
}

/**
 * Follow counts for several profiles in two grouped queries instead of one
 * query per profile. Used by every list of people (search, suggestions).
 */
async function followCountsFor(
  orgIds: readonly string[],
): Promise<Map<string, { followers: number; following: number }>> {
  const ids = [...new Set(orgIds)];
  const counts = new Map(ids.map((id) => [id, { followers: 0, following: 0 }]));
  if (ids.length === 0) return counts;

  const db = getDb();
  const [followerRows, followingRows] = await Promise.all([
    db
      .select({ orgId: follows.followeeOrgId, n: sql<number>`count(*)::int` })
      .from(follows)
      .where(inArray(follows.followeeOrgId, ids))
      .groupBy(follows.followeeOrgId),
    db
      .select({ orgId: follows.followerOrgId, n: sql<number>`count(*)::int` })
      .from(follows)
      .where(inArray(follows.followerOrgId, ids))
      .groupBy(follows.followerOrgId),
  ]);

  for (const row of followerRows) {
    const entry = counts.get(row.orgId);
    if (entry) entry.followers = row.n;
  }
  for (const row of followingRows) {
    const entry = counts.get(row.orgId);
    if (entry) entry.following = row.n;
  }
  return counts;
}

export async function getProfileByUsername(username: string): Promise<ProfileSummary | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(profiles)
    .where(sql`lower(${profiles.username}) = ${username.trim().toLowerCase()}`)
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return toProfileSummary(row, await followCounts(row.orgId));
}

export async function getProfileByOrgId(orgId: string): Promise<ProfileSummary | null> {
  const db = getDb();
  const rows = await db.select().from(profiles).where(eq(profiles.orgId, orgId)).limit(1);
  const row = rows[0];
  if (!row) return null;
  return toProfileSummary(row, await followCounts(row.orgId));
}

/** Create the public profile row for an org that does not have one yet. */
export async function ensureProfile(orgId: string, displayName: string, username: string): Promise<ProfileSummary> {
  const existing = await getProfileByOrgId(orgId);
  if (existing) return existing;
  const hue = Math.abs([...username].reduce((acc, ch) => acc * 31 + ch.charCodeAt(0), 7)) % 360;
  let handle = username.trim().toLowerCase() || "you";
  const taken = await getProfileByUsername(handle);
  if (taken) handle = `${handle}-${Math.random().toString(36).slice(2, 6)}`;
  await withOrg(orgId, async (tx) => {
    await tx
      .insert(profiles)
      .values({ orgId, username: handle, displayName, avatarHue: hue })
      .onConflictDoNothing();
  });
  const created = await getProfileByOrgId(orgId);
  if (!created) throw new DomainError("PROFILE_MISSING", "Could not create that profile.", 500);
  return created;
}

export async function isFollowing(orgId: string, targetOrgId: string): Promise<boolean> {
  if (orgId === targetOrgId) return false;
  const db = getDb();
  const rows = await db
    .select({ id: follows.id })
    .from(follows)
    .where(and(eq(follows.followerOrgId, orgId), eq(follows.followeeOrgId, targetOrgId)))
    .limit(1);
  return Boolean(rows[0]);
}

export async function setFollow(
  orgId: string,
  targetOrgId: string,
  follow: boolean,
): Promise<{ following: boolean; followers: number }> {
  if (orgId === targetOrgId) {
    throw new DomainError("SELF_FOLLOW", "You cannot follow yourself.");
  }
  const target = await getProfileByOrgId(targetOrgId);
  if (!target) throw new DomainError("PROFILE_NOT_FOUND", "That profile does not exist.", 404);

  await withOrg(orgId, async (tx) => {
    if (follow) {
      const inserted = await tx
        .insert(follows)
        .values({ followerOrgId: orgId, followeeOrgId: targetOrgId })
        .onConflictDoNothing()
        .returning({ id: follows.id });
      if (inserted.length > 0) {
        await tx.insert(notifications).values({
          orgId: targetOrgId,
          actorOrgId: orgId,
          kind: "follow",
        });
      }
    } else {
      await tx
        .delete(follows)
        .where(and(eq(follows.followerOrgId, orgId), eq(follows.followeeOrgId, targetOrgId)));
    }
  });

  const counts = await followCounts(targetOrgId);
  return { following: follow, followers: counts.followers };
}

export async function followingOrgIds(orgId: string): Promise<string[]> {
  const db = getDb();
  const rows = await db
    .select({ orgId: follows.followeeOrgId })
    .from(follows)
    .where(eq(follows.followerOrgId, orgId));
  return rows.map((row) => row.orgId);
}

export async function searchProfiles(query: string, limit = 8): Promise<ProfileSummary[]> {
  const db = getDb();
  // Escape LIKE metacharacters so a query of "%" matches nothing rather than
  // every profile.
  const escaped = query.trim().replace(/[\\%_]/g, (char) => `\\${char}`);
  const like = `%${escaped}%`;
  const rows = await db
    .select()
    .from(profiles)
    .where(sql`(${profiles.username} ilike ${like} or ${profiles.displayName} ilike ${like})`)
    .orderBy(profiles.displayName)
    .limit(limit);
  if (rows.length === 0) return [];
  const counts = await followCountsFor(rows.map((row) => row.orgId));
  return rows.map((row) =>
    toProfileSummary(row, counts.get(row.orgId) ?? { followers: 0, following: 0 }),
  );
}

export async function suggestedProfiles(orgId: string, limit = 8): Promise<ProfileSummary[]> {
  const db = getDb();
  const [followed, ownGenres, interests] = await Promise.all([
    db.select({ orgId: follows.followeeOrgId }).from(follows).where(eq(follows.followerOrgId, orgId)),
    db
      .select({ genres: catalogItems.genres })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(eq(itemRatings.orgId, orgId)),
    listInterests(orgId),
  ]);
  const excluded = [orgId, ...followed.map((row) => row.orgId)];

  // Genres the viewer rated, plus onboarding picks, so a brand-new profile can
  // still be matched instead of falling back to alphabetical order.
  const genres = [
    ...new Set([
      ...ownGenres.flatMap((row) => row.genres ?? []),
      ...interests.map((pick) => pick.genre),
    ]),
  ];

  // Exclude in SQL, not after taking the first 40 rows. Previously a user who
  // followed the first alphabetically sorted profiles got no suggestions even
  // though plenty of others existed.
  let rows: Array<typeof profiles.$inferSelect>;
  if (genres.length > 0) {
    const matches = await db
      .select({ profile: profiles, shared: sql<number>`count(*)::int` })
      .from(profiles)
      .innerJoin(itemRatings, eq(itemRatings.orgId, profiles.orgId))
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(
        and(
          notInArray(profiles.orgId, excluded),
          sql`${catalogItems.genres} && array[${sql.join(
            genres.map((genre) => sql`${genre}`),
            sql`, `,
          )}]::text[]`,
        ),
      )
      .groupBy(profiles.id)
      .orderBy(sql`count(*) desc`, profiles.displayName)
      .limit(limit);
    rows = matches.map((row) => row.profile);
  } else {
    rows = await db
      .select()
      .from(profiles)
      .where(notInArray(profiles.orgId, excluded))
      .orderBy(profiles.displayName)
      .limit(limit);
  }
  if (rows.length === 0) return [];

  const counts = await followCountsFor(rows.map((row) => row.orgId));
  return rows.map((row) =>
    toProfileSummary(row, counts.get(row.orgId) ?? { followers: 0, following: 0 }),
  );
}

/* ------------------------------------------------------------------ */
/* profile content                                                     */
/* ------------------------------------------------------------------ */

export interface KindPodium {
  kind: MediaKind;
  items: RankedItem[];
}

export interface ProfileBundle {
  profile: ProfileSummary;
  ratings: RankedItem[];
  topFive: RankedItem[];
  /** The top five per media kind, so each category gets its own podium. */
  podiums: KindPodium[];
  pods: PodCard[];
  watchlist: Array<CatalogItem & { addedAt: Date }>;
  pinnedReview: RankedItem | null;
}

export async function profileBundle(profile: ProfileSummary): Promise<ProfileBundle> {
  const [ratings, podCards, watchlist] = await Promise.all([
    rankedRatings(profile.orgId),
    podsForProfile(profile.orgId, profile.username, profile.displayName),
    watchlistFor(profile.orgId),
  ]);
  const pinnedReview = profile.pinnedRatingId
    ? ratings.find((rating) => rating.ratingId === profile.pinnedRatingId) ?? null
    : null;
  return {
    profile,
    ratings,
    topFive: ratings.slice(0, 5),
    podiums: MEDIA_KINDS.map((kind) => {
      const items = ratings.filter((rating) => rating.kind === kind);
      const saved = profile.podiumOrder?.[kind] ?? [];
      const byId = new Map(items.map((item) => [item.id, item]));
      const ordered = saved
        .map((id) => byId.get(id))
        .filter((item): item is RankedItem => Boolean(item));
      const seen = new Set(ordered.map((item) => item.id));
      const rest = items.filter((item) => !seen.has(item.id));
      return { kind, items: [...ordered, ...rest].slice(0, 5) };
    }),
    pods: podCards,
    watchlist,
    pinnedReview,
  };
}

/* ------------------------------------------------------------------ */
/* community ratings for an item                                       */
/* ------------------------------------------------------------------ */

function toReview(row: {
  rating: typeof itemRatings.$inferSelect;
  profile: typeof profiles.$inferSelect;
  item: typeof catalogItems.$inferSelect;
}): ReviewView {
  return {
    id: row.rating.id,
    orgId: row.rating.orgId,
    username: row.profile.username,
    displayName: row.profile.displayName,
    avatarHue: row.profile.avatarHue,
    itemId: row.item.id,
    itemTitle: row.item.title,
    itemSubtitle: row.item.subtitle,
    kind: row.item.kind,
    year: row.item.year ?? null,
    score: scoreForElo(row.rating.elo),
    tags: row.rating.reviewTags ?? [],
    text: row.rating.reviewText ?? null,
    spoiler: row.rating.spoiler,
    photoUrl: row.rating.photoUrl ?? null,
    videoUrl: row.rating.videoUrl ?? null,
    favoriteCharacter: row.rating.favoriteCharacter ?? null,
    favoriteTracks: row.rating.favoriteTracks ?? [],
    reactions: [],
    commentCount: 0,
    updatedAt: row.rating.updatedAt,
  };
}

/**
 * Batch-load emoji reactions and comment counts for a set of reviews.
 * Reactions are world-readable, so this runs outside a tenant context.
 */
export async function engagementFor(
  viewerOrgId: string | null,
  ratingIds: string[],
): Promise<Map<string, { reactions: ReactionSummary[]; commentCount: number }>> {
  const map = new Map<string, { reactions: ReactionSummary[]; commentCount: number }>();
  if (ratingIds.length === 0) return map;
  const db = getDb();

  const [reactionRows, commentRows] = await Promise.all([
    db
      .select({ ratingId: ratingReactions.ratingId, emoji: ratingReactions.emoji, orgId: ratingReactions.orgId })
      .from(ratingReactions)
      .where(inArray(ratingReactions.ratingId, ratingIds)),
    db
      .select({ ratingId: ratingComments.ratingId, count: sql<number>`count(*)::int` })
      .from(ratingComments)
      .where(inArray(ratingComments.ratingId, ratingIds))
      .groupBy(ratingComments.ratingId),
  ]);

  for (const id of ratingIds) map.set(id, { reactions: [], commentCount: 0 });

  const grouped = new Map<string, Map<string, { count: number; mine: boolean }>>();
  for (const row of reactionRows) {
    const byEmoji = grouped.get(row.ratingId) ?? new Map();
    const entry = byEmoji.get(row.emoji) ?? { count: 0, mine: false };
    entry.count += 1;
    if (viewerOrgId && row.orgId === viewerOrgId) entry.mine = true;
    byEmoji.set(row.emoji, entry);
    grouped.set(row.ratingId, byEmoji);
  }
  for (const [ratingId, byEmoji] of grouped) {
    const entry = map.get(ratingId)!;
    entry.reactions = [...byEmoji.entries()]
      .map(([emoji, value]) => ({ emoji, count: value.count, mine: value.mine }))
      .sort((a, b) => b.count - a.count);
  }
  for (const row of commentRows) {
    const entry = map.get(row.ratingId);
    if (entry) entry.commentCount = row.count;
  }
  return map;
}

async function attachEngagement(viewerOrgId: string | null, reviews: ReviewView[]): Promise<ReviewView[]> {
  if (reviews.length === 0) return reviews;
  const engagement = await engagementFor(viewerOrgId, reviews.map((review) => review.id));
  return reviews.map((review) => {
    const extra = engagement.get(review.id);
    return extra ? { ...review, reactions: extra.reactions, commentCount: extra.commentCount } : review;
  });
}

const reviewSelect = {
  rating: itemRatings,
  profile: profiles,
  item: catalogItems,
} as const;

type ReviewRow = {
  rating: typeof itemRatings.$inferSelect;
  profile: typeof profiles.$inferSelect;
  item: typeof catalogItems.$inferSelect;
};

/** Public ratings + reviews for one catalog item, across every profile. */
export async function itemCommunity(
  itemId: string,
  limit = 12,
  viewerOrgId: string | null = null,
): Promise<CommunityStats> {
  const db = getDb();
  const ratings = await db
    .select({ elo: itemRatings.elo })
    .from(itemRatings)
    .where(eq(itemRatings.itemId, itemId));

  const distribution = new Array<number>(10).fill(0);
  for (const rating of ratings) {
    const score = scoreForElo(rating.elo);
    const bucket = Math.min(9, Math.floor(score));
    distribution[bucket] = (distribution[bucket] ?? 0) + 1;
  }
  const average =
    ratings.length === 0
      ? null
      : Math.round((ratings.reduce((sum, r) => sum + scoreForElo(r.elo), 0) / ratings.length) * 10) / 10;

  const rows = await db
    .select(reviewSelect)
    .from(itemRatings)
    .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
    .innerJoin(profiles, eq(profiles.orgId, itemRatings.orgId))
    .where(eq(itemRatings.itemId, itemId))
    .orderBy(desc(itemRatings.updatedAt))
    .limit(40);

  const reviews = rows
    .map(toReview)
    .filter((review) => Boolean(review.text) || Boolean(review.videoUrl) || review.tags.length > 0)
    .slice(0, limit);

  return { count: ratings.length, average, distribution, reviews: await attachEngagement(viewerOrgId, reviews) };
}

/* ------------------------------------------------------------------ */
/* follow feed                                                         */
/* ------------------------------------------------------------------ */

export async function followFeed(orgId: string, limit = 12): Promise<ReviewView[]> {
  const db = getDb();
  const followed = await db
    .select({ orgId: follows.followeeOrgId })
    .from(follows)
    .where(eq(follows.followerOrgId, orgId));
  const ids = [...new Set([orgId, ...followed.map((row) => row.orgId)])];

  const rows = await db
    .select(reviewSelect)
    .from(itemRatings)
    .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
    .innerJoin(profiles, eq(profiles.orgId, itemRatings.orgId))
    .where(inArray(itemRatings.orgId, ids))
    .orderBy(desc(itemRatings.updatedAt))
    .limit(48);

  const reviews = rows
    .map(toReview)
    .filter((review) => review.orgId !== orgId && (Boolean(review.text) || Boolean(review.videoUrl) || review.tags.length > 0))
    .slice(0, limit);
  return attachEngagement(orgId, reviews);
}

/* ------------------------------------------------------------------ */
/* reviews                                                             */
/* ------------------------------------------------------------------ */

/** Save the owner's blurb + tags for a rated item, and file it into pods. */
export async function saveReview(
  orgId: string,
  itemId: string,
  input: ReviewInput,
): Promise<RankedItem> {
  const item = await getDb()
    .select({ id: catalogItems.id })
    .from(catalogItems)
    .where(eq(catalogItems.id, itemId))
    .limit(1);
  if (!item[0]) throw new DomainError("ITEM_NOT_FOUND", "That item is not in the catalog.", 404);

  if (input.photoUrl?.trim()) {
    const written = await writtenReviewCount(orgId);
    if (written < PHOTO_UNLOCK_REVIEWS) {
      throw new DomainError(
        "PHOTO_LOCKED",
        `Photos unlock after ${PHOTO_UNLOCK_REVIEWS} reviews. You have ${written}.`,
        403,
      );
    }
  }

  await withOrg(orgId, async (tx) => {
    const values = {
      reviewText: input.text?.trim() ? input.text.trim() : null,
      reviewTags: input.tags ?? [],
      spoiler: input.spoiler ?? false,
      photoUrl: input.photoUrl?.trim() || null,
      videoUrl: input.videoUrl?.trim() || null,
      favoriteCharacter: input.favoriteCharacter?.trim() || null,
      favoriteTracks: input.favoriteTracks ?? [],
    };
    await tx
      .insert(itemRatings)
      .values({ orgId, itemId, ...values })
      .onConflictDoUpdate({
        target: [itemRatings.orgId, itemRatings.itemId],
        set: { ...values, updatedAt: new Date() },
      });

    await tx.insert(ratingEvents).values({
      orgId,
      itemId,
      kind: "review",
      detail: values.reviewText ? values.reviewText.slice(0, 120) : "Updated review",
    });

    if (input.podIds && input.podIds.length > 0) {
      const owned = await tx
        .select({ id: pods.id })
        .from(pods)
        .where(inArray(pods.id, input.podIds));
      const ownedIds = new Set(owned.map((row) => row.id));
      for (const podId of input.podIds) {
        if (!ownedIds.has(podId)) continue;
        const [countRow] = await tx
          .select({ next: sql<number>`coalesce(max(${podItems.position}), -1)::int + 1` })
          .from(podItems)
          .where(eq(podItems.podId, podId));
        await tx
          .insert(podItems)
          .values({ podId, itemId, position: countRow?.next ?? 0 })
          .onConflictDoNothing();
      }
    }
  });

  const rating = await rankedRatings(orgId);
  const saved = rating.find((row) => row.id === itemId);
  if (!saved) throw new DomainError("REVIEW_FAILED", "Could not save that rating.", 500);
  return saved;
}

/* ------------------------------------------------------------------ */
/* pods                                                                */
/* ------------------------------------------------------------------ */

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "pod";
}

async function podCardsForRows(rows: Array<typeof pods.$inferSelect>, owner: {
  username: string;
  displayName: string;
}, withItems = true): Promise<PodCard[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const ownerOrgId = rows[0]!.orgId;
  const entries = withItems
    ? await withOrg(ownerOrgId, (tx) =>
        tx
          .select({ podId: podItems.podId, item: catalogItems, position: podItems.position })
          .from(podItems)
          .innerJoin(catalogItems, eq(catalogItems.id, podItems.itemId))
          .where(inArray(podItems.podId, ids))
          .orderBy(podItems.position),
      )
    : [];

  return rows.map((pod) => {
    const items = entries
      .filter((entry) => entry.podId === pod.id)
      .map((entry) => entry.item);
    return {
      id: pod.id,
      orgId: pod.orgId,
      title: pod.title,
      slug: pod.slug,
      description: pod.description ?? null,
      ownerUsername: owner.username,
      ownerDisplayName: owner.displayName,
      count: items.length,
      items: items.slice(0, 4).map((item) => ({
        id: item.id,
        kind: item.kind,
        title: item.title,
        subtitle: item.subtitle,
        year: item.year ?? null,
        imageUrl: item.imageUrl ?? null,
        description: item.description ?? null,
        links: (item.links ?? {}) as Record<string, string>,
        genres: item.genres ?? [],
        trailerUrl: item.trailerUrl ?? null,
        tags: item.tags ?? [],
      })),
    };
  });
}

export async function podsForProfile(orgId: string, username: string, displayName: string): Promise<PodCard[]> {
  const rows = await withOrg(orgId, (tx) =>
    tx.select().from(pods).where(eq(pods.orgId, orgId)).orderBy(desc(pods.createdAt)),
  );
  return podCardsForRows(rows, { username, displayName });
}

export async function podByOwnerAndSlug(username: string, slug: string): Promise<PodDetail | null> {
  const db = getDb();
  const profileRows = await db
    .select()
    .from(profiles)
    .where(sql`lower(${profiles.username}) = ${username.trim().toLowerCase()}`)
    .limit(1);
  const profile = profileRows[0];
  if (!profile) return null;

  const rows = await db
    .select()
    .from(pods)
    .where(and(eq(pods.orgId, profile.orgId), eq(pods.slug, slug), eq(pods.visibility, "public")))
    .limit(1);
  const pod = rows[0];
  if (!pod) return null;
  return podDetail(pod, profile);
}

export async function podById(podId: string): Promise<PodDetail | null> {
  const db = getDb();
  const rows = await db
    .select({ pod: pods, profile: profiles })
    .from(pods)
    .innerJoin(profiles, eq(profiles.orgId, pods.orgId))
    .where(and(eq(pods.id, podId), eq(pods.visibility, "public")))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return podDetail(row.pod, row.profile);
}

async function podDetail(
  pod: typeof pods.$inferSelect,
  profile: typeof profiles.$inferSelect,
): Promise<PodDetail> {
  const rows = await withOrg(pod.orgId, (tx) =>
    tx
      .select({
        item: catalogItems,
        note: podItems.note,
        position: podItems.position,
        addedByOrgId: podItems.addedByOrgId,
      })
      .from(podItems)
      .innerJoin(catalogItems, eq(catalogItems.id, podItems.itemId))
      .where(eq(podItems.podId, pod.id))
      .orderBy(podItems.position),
  );

  const contributorIds = [
    ...new Set(
      rows
        .map((row) => row.addedByOrgId)
        .filter((id): id is string => Boolean(id) && id !== pod.orgId),
    ),
  ];
  const contributorRows =
    contributorIds.length > 0
      ? await getDb().select().from(profiles).where(inArray(profiles.orgId, contributorIds))
      : [];
  const contributorByOrg = new Map(contributorRows.map((row) => [row.orgId, row.username]));

  const ratings = await rankedRatings(pod.orgId);
  const scoreById = new Map(ratings.map((rating) => [rating.id, rating.score]));

  const entries = rows.map(({ item, note, addedByOrgId }) => ({
    id: item.id,
    kind: item.kind,
    title: item.title,
    subtitle: item.subtitle,
    year: item.year ?? null,
    imageUrl: item.imageUrl ?? null,
    description: item.description ?? null,
    links: (item.links ?? {}) as Record<string, string>,
    genres: item.genres ?? [],
    trailerUrl: item.trailerUrl ?? null,
    tags: item.tags ?? [],
    note: note ?? null,
    score: scoreById.get(item.id) ?? null,
    addedByUsername: addedByOrgId ? (contributorByOrg.get(addedByOrgId) ?? null) : null,
  }));

  return {
    id: pod.id,
    orgId: pod.orgId,
    title: pod.title,
    slug: pod.slug,
    description: pod.description ?? null,
    ownerUsername: profile.username,
    ownerDisplayName: profile.displayName,
    count: entries.length,
    items: entries.slice(0, 4),
    entries,
  };
}

export const podInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional().nullable(),
  itemIds: z.array(z.string().uuid()).max(50).optional(),
});

export type PodInput = z.infer<typeof podInputSchema>;

export async function createPod(orgId: string, input: PodInput): Promise<PodCard> {
  const profile = await getProfileByOrgId(orgId);
  if (!profile) throw new DomainError("PROFILE_MISSING", "Create a profile before making a pod.", 400);

  const base = slugify(input.title);
  const created = await withOrg(orgId, async (tx) => {
    const existing = await tx.select({ slug: pods.slug }).from(pods).where(eq(pods.orgId, orgId));
    const taken = new Set(existing.map((row) => row.slug));
    let slug = base;
    let n = 2;
    while (taken.has(slug)) {
      slug = `${base}-${n}`;
      n += 1;
    }
    const [pod] = await tx
      .insert(pods)
      .values({
        orgId,
        title: input.title.trim(),
        slug,
        description: input.description?.trim() || null,
      })
      .returning();
    if (!pod) throw new DomainError("POD_FAILED", "Could not create that pod.", 500);

    if (input.itemIds && input.itemIds.length > 0) {
      const valid = await tx
        .select({ id: catalogItems.id })
        .from(catalogItems)
        .where(inArray(catalogItems.id, input.itemIds));
      const validIds = new Set(valid.map((row) => row.id));
      const seen = new Set<string>();
      let position = 0;
      for (const itemId of input.itemIds) {
        if (!validIds.has(itemId) || seen.has(itemId)) continue;
        seen.add(itemId);
        await tx.insert(podItems).values({ podId: pod.id, itemId, position });
        position += 1;
      }
    }
    return { pod, profile };
  });

  const cards = await podCardsForRows([created.pod], {
    username: created.profile.username,
    displayName: created.profile.displayName,
  });
  return cards[0]!;
}

export async function addItemToPod(orgId: string, podId: string, itemId: string): Promise<PodDetail> {
  const pod = await withOrg(orgId, async (tx) => {
    const rows = await tx.select().from(pods).where(eq(pods.id, podId)).limit(1);
    if (!rows[0]) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
    // Own pods accept edits always; someone else's pod only while it is public.
    if (rows[0].orgId !== orgId && rows[0].visibility !== "public") {
      throw new DomainError("POD_NOT_PUBLIC", "That pod is not open to contributions.", 403);
    }
    const [countRow] = await tx
      .select({ next: sql<number>`coalesce(max(${podItems.position}), -1)::int + 1` })
      .from(podItems)
      .where(eq(podItems.podId, podId));
    await tx
      .insert(podItems)
      .values({ podId, itemId, addedByOrgId: orgId, position: countRow?.next ?? 0 })
      .onConflictDoNothing();
    return rows[0];
  });

  const detail = await podById(pod.id);
  if (!detail) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
  return detail;
}

/* ------------------------------------------------------------------ */
/* collaborative pods: which pods can take this title                  */
/* ------------------------------------------------------------------ */

export interface AvailablePod {
  id: string;
  title: string;
  ownerUsername: string;
  /** True when the acting org owns the pod. */
  owned: boolean;
  contains: boolean;
}

/**
 * Own pods plus public pods from people this profile follows. Public pods are
 * open to contributions, which is what makes this list worth showing.
 */
export async function availablePodsFor(orgId: string, itemId: string): Promise<AvailablePod[]> {
  const db = getDb();
  const [owned, followed] = await Promise.all([
    withOrg(orgId, async (tx) => {
      const podRows = await tx.select().from(pods).where(eq(pods.orgId, orgId)).orderBy(desc(pods.createdAt));
      const ids = podRows.map((row) => row.id);
      const itemRows =
        ids.length > 0
          ? await tx
              .select({ podId: podItems.podId })
              .from(podItems)
              .where(and(inArray(podItems.podId, ids), eq(podItems.itemId, itemId)))
          : [];
      return { podRows, contains: new Set(itemRows.map((row) => row.podId)) };
    }),
    followingOrgIds(orgId),
  ]);

  const followedPods =
    followed.length > 0
      ? await db
          .select({ pod: pods, owner: profiles })
          .from(pods)
          .innerJoin(profiles, eq(profiles.orgId, pods.orgId))
          .where(and(inArray(pods.orgId, followed), eq(pods.visibility, "public")))
      : [];
  const followedIds = followedPods.map((row) => row.pod.id);
  const followedItems =
    followedIds.length > 0
      ? await db
          .select({ podId: podItems.podId })
          .from(podItems)
          .where(and(inArray(podItems.podId, followedIds), eq(podItems.itemId, itemId)))
      : [];
  const followedContains = new Set(followedItems.map((row) => row.podId));

  return [
    ...owned.podRows.map((pod) => ({
      id: pod.id,
      title: pod.title,
      ownerUsername: "you",
      owned: true,
      contains: owned.contains.has(pod.id),
    })),
    ...followedPods.map(({ pod, owner }) => ({
      id: pod.id,
      title: pod.title,
      ownerUsername: owner.username,
      owned: false,
      contains: followedContains.has(pod.id),
    })),
  ];
}

/* ------------------------------------------------------------------ */
/* comments + reactions                                                */
/* ------------------------------------------------------------------ */

export interface CommentView {
  id: string;
  orgId: string;
  username: string;
  displayName: string;
  avatarHue: number;
  body: string;
  createdAt: Date;
}

export async function commentsFor(ratingId: string, limit = 50): Promise<CommentView[]> {
  const db = getDb();
  const rows = await db
    .select({ comment: ratingComments, profile: profiles })
    .from(ratingComments)
    .innerJoin(profiles, eq(profiles.orgId, ratingComments.orgId))
    .where(eq(ratingComments.ratingId, ratingId))
    .orderBy(ratingComments.createdAt)
    .limit(limit);
  return rows.map(({ comment, profile }) => ({
    id: comment.id,
    orgId: comment.orgId,
    username: profile.username,
    displayName: profile.displayName,
    avatarHue: profile.avatarHue,
    body: comment.body,
    createdAt: comment.createdAt,
  }));
}

async function ratingOwner(ratingId: string): Promise<{ orgId: string; itemId: string } | null> {
  const db = getDb();
  const rows = await db
    .select({ orgId: itemRatings.orgId, itemId: itemRatings.itemId })
    .from(itemRatings)
    .where(eq(itemRatings.id, ratingId))
    .limit(1);
  return rows[0] ?? null;
}

export async function addComment(
  orgId: string,
  ratingId: string,
  body: string,
): Promise<CommentView[]> {
  const trimmed = body.trim();
  if (!trimmed) throw new DomainError("EMPTY_COMMENT", "Write something first.", 400);
  if (trimmed.length > 1000) throw new DomainError("COMMENT_TOO_LONG", "Keep comments under 1,000 characters.", 400);
  const owner = await ratingOwner(ratingId);
  if (!owner) throw new DomainError("RATING_NOT_FOUND", "That review does not exist.", 404);

  await withOrg(orgId, async (tx) => {
    await tx.insert(ratingComments).values({ ratingId, orgId, body: trimmed });
    if (owner.orgId !== orgId) {
      await tx.insert(notifications).values({
        orgId: owner.orgId,
        actorOrgId: orgId,
        kind: "comment",
        itemId: owner.itemId,
        ratingId,
        body: trimmed.slice(0, 140),
      });
    }
  });

  return commentsFor(ratingId);
}

export async function toggleReaction(
  orgId: string,
  ratingId: string,
  emoji: string,
): Promise<{ reacted: boolean; reactions: ReactionSummary[] }> {
  const clean = emoji.trim().slice(0, 8);
  if (!clean) throw new DomainError("EMPTY_REACTION", "Pick an emoji.", 400);
  const owner = await ratingOwner(ratingId);
  if (!owner) throw new DomainError("RATING_NOT_FOUND", "That review does not exist.", 404);

  const reacted = await withOrg(orgId, async (tx) => {
    const existing = await tx
      .select({ id: ratingReactions.id })
      .from(ratingReactions)
      .where(
        and(
          eq(ratingReactions.ratingId, ratingId),
          eq(ratingReactions.orgId, orgId),
          eq(ratingReactions.emoji, clean),
        ),
      )
      .limit(1);
    if (existing[0]) {
      await tx.delete(ratingReactions).where(eq(ratingReactions.id, existing[0].id));
      return false;
    }
    await tx.insert(ratingReactions).values({ ratingId, orgId, emoji: clean }).onConflictDoNothing();
    if (owner.orgId !== orgId) {
      await tx.insert(notifications).values({
        orgId: owner.orgId,
        actorOrgId: orgId,
        kind: "reaction",
        itemId: owner.itemId,
        ratingId,
        body: clean,
      });
    }
    return true;
  });

  const engagement = await engagementFor(orgId, [ratingId]);
  return { reacted, reactions: engagement.get(ratingId)?.reactions ?? [] };
}

/* ------------------------------------------------------------------ */
/* notifications                                                       */
/* ------------------------------------------------------------------ */

export interface NotificationView {
  id: string;
  kind: string;
  body: string;
  read: boolean;
  createdAt: Date;
  actorUsername: string | null;
  actorDisplayName: string | null;
  actorAvatarHue: number | null;
  itemId: string | null;
  itemTitle: string | null;
  ratingId: string | null;
}

export async function notificationsFor(orgId: string, limit = 40): Promise<NotificationView[]> {
  // The inbox is tenant-scoped, so read it with the org context set. Actor
  // profiles and catalog titles are public and are joined outside that scope.
  const rows = await withOrg(orgId, (tx) =>
    tx
      .select()
      .from(notifications)
      .where(eq(notifications.orgId, orgId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit),
  );
  if (rows.length === 0) return [];

  const db = getDb();
  const actorIds = [...new Set(rows.map((row) => row.actorOrgId).filter((id): id is string => Boolean(id)))];
  const itemIds = [...new Set(rows.map((row) => row.itemId).filter((id): id is string => Boolean(id)))];
  const [actorRows, itemRows] = await Promise.all([
    actorIds.length > 0
      ? db.select().from(profiles).where(inArray(profiles.orgId, actorIds))
      : Promise.resolve([]),
    itemIds.length > 0
      ? db
          .select({ id: catalogItems.id, title: catalogItems.title })
          .from(catalogItems)
          .where(inArray(catalogItems.id, itemIds))
      : Promise.resolve([]),
  ]);

  const actors = new Map(actorRows.map((row) => [row.orgId, row]));
  const items = new Map(itemRows.map((row) => [row.id, row]));

  return rows.map((notification) => {
    const actor = notification.actorOrgId ? actors.get(notification.actorOrgId) : undefined;
    const item = notification.itemId ? items.get(notification.itemId) : undefined;
    return {
      id: notification.id,
      kind: notification.kind,
      body: notification.body,
      read: notification.read,
      createdAt: notification.createdAt,
      actorUsername: actor?.username ?? null,
      actorDisplayName: actor?.displayName ?? null,
      actorAvatarHue: actor?.avatarHue ?? null,
      itemId: notification.itemId ?? null,
      itemTitle: item?.title ?? null,
      ratingId: notification.ratingId ?? null,
    };
  });
}

export async function unreadNotificationCount(orgId: string): Promise<number> {
  return withOrg(orgId, async (tx) => {
    const [row] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.orgId, orgId), eq(notifications.read, false)));
    return row?.count ?? 0;
  });
}

export async function markNotificationsRead(orgId: string): Promise<number> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .update(notifications)
      .set({ read: true })
      .where(and(eq(notifications.orgId, orgId), eq(notifications.read, false)))
      .returning({ id: notifications.id });
    return rows.length;
  });
}

/* ------------------------------------------------------------------ */
/* search history                                                      */
/* ------------------------------------------------------------------ */

export async function recordSearch(orgId: string, query: string): Promise<void> {
  const clean = query.trim().slice(0, 120);
  if (clean.length < 2) return;
  await withOrg(orgId, async (tx) => {
    await tx
      .insert(searchHistory)
      .values({ orgId, query: clean })
      .onConflictDoUpdate({
        target: [searchHistory.orgId, searchHistory.query],
        set: { createdAt: new Date() },
      });
  });
}

export async function searchHistoryFor(orgId: string, limit = 8): Promise<string[]> {
  return withOrg(orgId, async (tx) => {
    const rows = await tx
      .select({ query: searchHistory.query })
      .from(searchHistory)
      .where(eq(searchHistory.orgId, orgId))
      .orderBy(desc(searchHistory.createdAt))
      .limit(limit);
    return rows.map((row) => row.query);
  });
}

export async function clearSearchHistory(orgId: string): Promise<void> {
  await withOrg(orgId, async (tx) => {
    await tx.delete(searchHistory).where(eq(searchHistory.orgId, orgId));
  });
}

/* ------------------------------------------------------------------ */
/* profile settings, pinning, taste match                              */
/* ------------------------------------------------------------------ */

export const profileUpdateSchema = z.object({
  displayName: z.string().trim().min(1).max(50).optional(),
  username: z
    .string()
    .trim()
    .min(2)
    .max(30)
    .regex(/^[a-z0-9_.-]+$/i, "Use letters, numbers, dots, dashes, or underscores.")
    .optional(),
  bio: z.string().trim().max(300).optional().nullable(),
  avatarHue: z.number().int().min(0).max(360).optional(),
  manualMode: z.boolean().optional(),
  spotifyConnected: z.boolean().optional(),
  appleMusicConnected: z.boolean().optional(),
  language: z.enum(["en", "es", "pt"]).optional(),
  profileLayout: z.enum(["list", "grid"]).optional(),
});
export type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

export async function updateProfile(orgId: string, input: ProfileUpdate): Promise<ProfileSummary> {
  const current = await getProfileByOrgId(orgId);
  if (!current) throw new DomainError("PROFILE_MISSING", "Create a profile first.", 400);

  if (input.username && input.username.toLowerCase() !== current.username.toLowerCase()) {
    const taken = await getProfileByUsername(input.username);
    if (taken && taken.orgId !== orgId) {
      throw new DomainError("USERNAME_TAKEN", "That username is already taken.", 409);
    }
  }

  await withOrg(orgId, async (tx) => {
    await tx
      .update(profiles)
      .set({
        displayName: input.displayName?.trim() || current.displayName,
        username: input.username?.trim().toLowerCase() || current.username,
        bio: input.bio === undefined ? current.bio : input.bio?.trim() || null,
        avatarHue: input.avatarHue ?? current.avatarHue,
        manualMode: input.manualMode ?? current.manualMode,
        spotifyConnected: input.spotifyConnected ?? current.spotifyConnected,
        appleMusicConnected: input.appleMusicConnected ?? current.appleMusicConnected,
        language: input.language ?? current.language,
        profileLayout: input.profileLayout ?? current.profileLayout,
      })
      .where(eq(profiles.orgId, orgId));
  });

  const updated = await getProfileByOrgId(orgId);
  if (!updated) throw new DomainError("PROFILE_MISSING", "Could not update that profile.", 500);
  return updated;
}

export async function pinReview(orgId: string, ratingId: string | null): Promise<ProfileSummary> {
  if (ratingId) {
    const owned = await withOrg(orgId, (tx) =>
      tx
        .select({ id: itemRatings.id })
        .from(itemRatings)
        .where(and(eq(itemRatings.id, ratingId), eq(itemRatings.orgId, orgId)))
        .limit(1),
    );
    if (!owned[0]) throw new DomainError("RATING_NOT_FOUND", "That review is not yours.", 404);
  }
  await withOrg(orgId, async (tx) => {
    await tx.update(profiles).set({ pinnedRatingId: ratingId }).where(eq(profiles.orgId, orgId));
  });
  const updated = await getProfileByOrgId(orgId);
  if (!updated) throw new DomainError("PROFILE_MISSING", "Could not update that profile.", 500);
  return updated;
}

/**
 * Taste match between two profiles, derived from how similarly they scored
 * the items they both rated. Returns null when there is no overlap.
 */
export async function matchPercent(orgId: string, otherOrgId: string): Promise<number | null> {
  if (orgId === otherOrgId) return 100;
  const [mine, theirs] = await Promise.all([rankedRatings(orgId), rankedRatings(otherOrgId)]);
  const theirScores = new Map(theirs.map((item) => [item.id, item.score]));
  const shared = mine
    .filter((item) => theirScores.has(item.id))
    .map((item) => ({ id: item.id, mine: item.score, theirs: theirScores.get(item.id) ?? 0 }));
  return tasteMatch({
    shared,
    mineProfile: genreProfile(mine),
    theirsProfile: genreProfile(theirs),
  }).match;
}

/** Combined "For You" feed: people you follow first, then the wider community. */
/**
 * The home feed. Mixes followed authors, recent community reviews, the
 * viewer's genre history and engagement, then explains each pick. The pure
 * ranking lives in `@appolo/core` so it can be tested without a database.
 */
export async function feedForYou(orgId: string, limit = 12): Promise<ReviewView[]> {
  const db = getDb();
  const [followedRows, ownRatings, interests] = await Promise.all([
    db.select({ orgId: follows.followeeOrgId }).from(follows).where(eq(follows.followerOrgId, orgId)),
    db
      .select({ genres: catalogItems.genres })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(eq(itemRatings.orgId, orgId)),
    listInterests(orgId),
  ]);
  const followedIds = followedRows.map((row) => row.orgId);
  const followedSet = new Set(followedIds);

  const [friendsRows, globalRows] = await Promise.all([
    followedIds.length === 0
      ? Promise.resolve([] as ReviewRow[])
      : db
          .select(reviewSelect)
          .from(itemRatings)
          .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
          .innerJoin(profiles, eq(profiles.orgId, itemRatings.orgId))
          .where(inArray(itemRatings.orgId, followedIds))
          .orderBy(desc(itemRatings.updatedAt))
          .limit(48),
    db
      .select(reviewSelect)
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .innerJoin(profiles, eq(profiles.orgId, itemRatings.orgId))
      .where(ne(itemRatings.orgId, orgId))
      .orderBy(desc(itemRatings.updatedAt))
      .limit(60),
  ]);

  const rowsById = new Map<string, ReviewRow>();
  for (const row of [...friendsRows, ...globalRows]) rowsById.set(row.rating.id, row);

  const candidates = [...rowsById.values()]
    .map(toReview)
    .filter((review) => Boolean(review.text) || Boolean(review.videoUrl) || review.tags.length > 0);
  if (candidates.length === 0) return [];

  const genresById = new Map([...rowsById.values()].map((row) => [row.rating.id, row.item.genres ?? []]));
  const engagement = await engagementFor(
    null,
    candidates.map((review) => review.id),
  );
  const genreWeights = blendGenreWeights(
    normalizeGenreWeights(ownRatings.flatMap((row) => row.genres ?? [])),
    interests.map((pick) => pick.genre),
  );

  const ranked = rankFeed(
    candidates.map((review) => {
      const stats = engagement.get(review.id);
      return {
        id: review.id,
        authorId: review.orgId,
        createdAt: review.updatedAt,
        score: review.score,
        genres: genresById.get(review.id) ?? [],
        followed: followedSet.has(review.orgId),
        reactions: (stats?.reactions ?? []).reduce((sum, reaction) => sum + reaction.count, 0),
        comments: stats?.commentCount ?? 0,
      };
    }),
    { followedAuthorIds: followedSet, genreWeights },
  );

  const byId = new Map(candidates.map((review) => [review.id, review]));
  const reviews = ranked.slice(0, limit).flatMap((entry) => {
    const review = byId.get(entry.item.id);
    return review ? [{ ...review, reason: entry.reason.label }] : [];
  });
  return attachEngagement(orgId, reviews);
}

/* ------------------------------------------------------------------ */
/* pod editing                                                         */
/* ------------------------------------------------------------------ */

export const podUpdateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional().nullable(),
});
export type PodUpdate = z.infer<typeof podUpdateSchema>;

export async function updatePod(orgId: string, podId: string, input: PodUpdate): Promise<PodDetail> {
  await withOrg(orgId, async (tx) => {
    const rows = await tx.select().from(pods).where(eq(pods.id, podId)).limit(1);
    if (!rows[0]) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
    await tx
      .update(pods)
      .set({
        title: input.title?.trim() || rows[0].title,
        description: input.description === undefined ? rows[0].description : input.description?.trim() || null,
      })
      .where(eq(pods.id, podId));
  });
  const detail = await podById(podId);
  if (!detail) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
  return detail;
}

export async function deletePod(orgId: string, podId: string): Promise<void> {
  await withOrg(orgId, async (tx) => {
    const rows = await tx.select({ id: pods.id }).from(pods).where(eq(pods.id, podId)).limit(1);
    if (!rows[0]) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
    await tx.delete(pods).where(eq(pods.id, podId));
  });
}

export async function removeItemFromPod(orgId: string, podId: string, itemId: string): Promise<PodDetail> {
  await withOrg(orgId, async (tx) => {
    const rows = await tx.select({ id: pods.id, orgId: pods.orgId }).from(pods).where(eq(pods.id, podId)).limit(1);
    if (!rows[0]) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
    await tx
      .delete(podItems)
      .where(
        and(
          eq(podItems.podId, podId),
          eq(podItems.itemId, itemId),
          rows[0].orgId === orgId
            ? sql`true`
            : eq(podItems.addedByOrgId, orgId),
        ),
      );
  });
  const detail = await podById(podId);
  if (!detail) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
  return detail;
}

/** Persist a new manual order for a pod's items. */
export async function reorderPodItems(orgId: string, podId: string, itemIds: string[]): Promise<PodDetail> {
  await withOrg(orgId, async (tx) => {
    const rows = await tx.select({ id: pods.id }).from(pods).where(eq(pods.id, podId)).limit(1);
    if (!rows[0]) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
    const existing = await tx
      .select({ itemId: podItems.itemId })
      .from(podItems)
      .where(eq(podItems.podId, podId));
    const valid = new Set(existing.map((row) => row.itemId));
    let position = 0;
    for (const itemId of itemIds) {
      if (!valid.has(itemId)) continue;
      await tx
        .update(podItems)
        .set({ position })
        .where(and(eq(podItems.podId, podId), eq(podItems.itemId, itemId)));
      position += 1;
    }
  });
  const detail = await podById(podId);
  if (!detail) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
  return detail;
}

/** Pods owned by the acting org, for the pod editor. */
export async function ownedPods(orgId: string): Promise<PodCard[]> {
  const profile = await getProfileByOrgId(orgId);
  if (!profile) return [];
  const rows = await withOrg(orgId, (tx) =>
    tx.select().from(pods).where(eq(pods.orgId, orgId)).orderBy(desc(pods.createdAt)),
  );
  return podCardsForRows(rows, { username: profile.username, displayName: profile.displayName });
}

/* ------------------------------------------------------------------ */
/* written-review count (photo unlock)                                 */
/* ------------------------------------------------------------------ */

/** How many items this org has actually reviewed (written text or a video). */
export async function writtenReviewCount(orgId: string): Promise<number> {
  return withOrg(orgId, async (tx) => {
    const [row] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(itemRatings)
      .where(
        and(
          eq(itemRatings.orgId, orgId),
          sql`(${itemRatings.reviewText} is not null or ${itemRatings.videoUrl} is not null)`,
        ),
      );
    return row?.n ?? 0;
  });
}

/* ------------------------------------------------------------------ */
/* single review lookup (shared-review popup, deep links)              */
/* ------------------------------------------------------------------ */

/** One public review by its rating id. */
export async function reviewById(ratingId: string, viewerOrgId: string | null = null): Promise<ReviewView | null> {
  // A non-UUID path segment would otherwise reach Postgres and raise 22P02.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ratingId)) {
    return null;
  }
  const db = getDb();
  const rows = await db
    .select(reviewSelect)
    .from(itemRatings)
    .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
    .innerJoin(profiles, eq(profiles.orgId, itemRatings.orgId))
    .where(eq(itemRatings.id, ratingId))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  const [review] = await attachEngagement(viewerOrgId, [toReview(row)]);
  return review ?? null;
}

/* ------------------------------------------------------------------ */
/* taste twins                                                         */
/* ------------------------------------------------------------------ */

export interface TasteTwin {
  profile: ProfileSummary;
  /** 0–100 agreement across shared titles. */
  match: number;
  shared: number;
}

/**
 * People whose scores line up with yours. Only profiles that share at least
 * three ranked titles qualify, so a single lucky match cannot top the list.
 * Community ratings are world-readable, so this reads outside a tenant scope
 * and keeps the viewer's own scores private on the server.
 */
export async function tasteTwins(orgId: string, limit = 6): Promise<TasteTwin[]> {
  const mine = await rankedRatings(orgId);
  if (mine.length === 0) return [];
  const mineScores = new Map(mine.map((item) => [item.id, item.score]));
  const db = getDb();

  const rows = await db
    .select({ orgId: itemRatings.orgId, itemId: itemRatings.itemId, elo: itemRatings.elo })
    .from(itemRatings)
    .where(ne(itemRatings.orgId, orgId))
    .limit(5000);

  const diffs = new Map<string, { total: number; shared: number }>();
  for (const row of rows) {
    const myScore = mineScores.get(row.itemId);
    if (myScore === undefined) continue;
    const entry = diffs.get(row.orgId) ?? { total: 0, shared: 0 };
    entry.total += Math.abs(myScore - scoreForElo(row.elo));
    entry.shared += 1;
    diffs.set(row.orgId, entry);
  }

  const ranked = [...diffs.entries()]
    .filter(([, entry]) => entry.shared >= 3)
    .map(([otherOrgId, entry]) => ({
      otherOrgId,
      shared: entry.shared,
      match: Math.max(0, Math.min(100, Math.round(100 - (entry.total / entry.shared) * 10))),
    }))
    .sort((a, b) => b.match - a.match || b.shared - a.shared)
    .slice(0, limit);

  if (ranked.length === 0) return [];
  const profileRows = await db
    .select()
    .from(profiles)
    .where(inArray(profiles.orgId, ranked.map((entry) => entry.otherOrgId)));
  const byOrg = new Map(profileRows.map((row) => [row.orgId, row]));

  const twins: TasteTwin[] = [];
  for (const entry of ranked) {
    const row = byOrg.get(entry.otherOrgId);
    if (!row) continue;
    twins.push({
      profile: toProfileSummary(row, await followCounts(row.orgId)),
      match: entry.match,
      shared: entry.shared,
    });
  }
  return twins;
}

/* ------------------------------------------------------------------ */
/* curated podium order                                                */
/* ------------------------------------------------------------------ */

/**
 * Persist the profile's own order for one medium's top five. Only titles the
 * profile has actually ranked can be pinned, so the list can never contain
 * something the account has not rated.
 */
export async function setPodiumOrder(
  orgId: string,
  kind: MediaKind,
  itemIds: string[],
): Promise<ProfileSummary> {
  const unique = [...new Set(itemIds)].slice(0, 5);

  await withOrg(orgId, async (tx) => {
    const rated = await tx
      .select({ itemId: itemRatings.itemId })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(and(eq(itemRatings.orgId, orgId), eq(catalogItems.kind, kind)));
    const valid = new Set(rated.map((row) => row.itemId));
    const filtered = unique.filter((id) => valid.has(id));

    const [current] = await tx
      .select({ podiumOrder: profiles.podiumOrder })
      .from(profiles)
      .where(eq(profiles.orgId, orgId))
      .limit(1);
    const existing = (current?.podiumOrder ?? {}) as Record<string, unknown>;

    await tx
      .update(profiles)
      .set({ podiumOrder: { ...existing, [kind]: filtered }, updatedAt: new Date() })
      .where(eq(profiles.orgId, orgId));
  });

  const updated = await getProfileByOrgId(orgId);
  if (!updated) throw new DomainError("PROFILE_MISSING", "Create a profile first.", 400);
  return updated;
}

/* ------------------------------------------------------------------ */
/* side-by-side taste comparison                                       */
/* ------------------------------------------------------------------ */

export interface CompareEntry {
  item: CatalogItem;
  mine: number;
  theirs: number;
  /** Positive means you rate the title higher than they do. */
  gap: number;
}

export interface KindMatch {
  kind: MediaKind;
  match: number | null;
  shared: number;
  confidence: MatchConfidence;
  kendallTauB: number | null;
}

export interface TasteComparison {
  other: ProfileSummary;
  match: number;
  shared: number;
  agreements: number;
  entries: CompareEntry[];
  /** Match broken down per media kind, only where the profiles overlap. */
  kinds: KindMatch[];
  /** Kendall tau-b over shared scores, or null with too little overlap. */
  kendallTauB: number | null;
  rankAgreement: number | null;
  ratingSimilarity: number | null;
  confidence: MatchConfidence;
  /** Plain-language explanation of what supports the percentage. */
  basis: string;
}

/** Two profiles' scores for every title they have both ranked, biggest gaps first. */
export async function compareTaste(orgId: string, otherOrgId: string): Promise<TasteComparison | null> {
  if (orgId === otherOrgId) return null;
  const [other, mine, theirs] = await Promise.all([
    getProfileByOrgId(otherOrgId),
    rankedRatings(orgId),
    rankedRatings(otherOrgId),
  ]);
  if (!other) return null;

  const theirScores = new Map(theirs.map((item) => [item.id, item.score]));
  const entries: CompareEntry[] = mine
    .filter((item) => theirScores.has(item.id))
    .map((item) => {
      const theirScore = theirScores.get(item.id) ?? 0;
      return {
        item,
        mine: item.score,
        theirs: theirScore,
        gap: Math.round((item.score - theirScore) * 10) / 10,
      };
    })
    .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

  const sharedPairs = entries.map((entry) => ({
    id: entry.item.id,
    mine: entry.mine,
    theirs: entry.theirs,
  }));
  const match = tasteMatch({
    shared: sharedPairs,
    mineProfile: genreProfile(mine),
    theirsProfile: genreProfile(theirs),
  });

  const kinds: KindMatch[] = MEDIA_KINDS.map((kind) => {
    const mineOfKind = mine.filter((item) => item.kind === kind);
    const theirsOfKind = theirs.filter((item) => item.kind === kind);
    const theirKindScores = new Map(theirsOfKind.map((item) => [item.id, item.score]));
    const sharedOfKind = mineOfKind
      .filter((item) => theirKindScores.has(item.id))
      .map((item) => ({ id: item.id, mine: item.score, theirs: theirKindScores.get(item.id) ?? 0 }));
    const kindMatch = tasteMatch({
      shared: sharedOfKind,
      mineProfile: genreProfile(mineOfKind),
      theirsProfile: genreProfile(theirsOfKind),
      kindLabel: kind,
    });
    return {
      kind,
      match: kindMatch.match,
      shared: sharedOfKind.length,
      confidence: kindMatch.confidence,
      kendallTauB: kindMatch.kendallTauB,
    };
  }).filter((entry) => entry.shared > 0);

  return {
    other,
    match: match.match ?? 0,
    shared: entries.length,
    agreements: match.agreements,
    entries,
    kinds,
    kendallTauB: match.kendallTauB,
    rankAgreement: match.rankAgreement,
    ratingSimilarity: match.ratingSimilarity,
    confidence: match.confidence,
    basis: match.basis,
  };
}
