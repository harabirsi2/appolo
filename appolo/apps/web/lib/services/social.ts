import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { scoreForElo, type MediaKind } from "@appolo/core";
import { getDb, withOrg, schema } from "@/lib/db";
import { DomainError } from "./errors";
import { rankedRatings, watchlistFor, type CatalogItem, type RankedItem } from "./rankings";

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
  favoriteCharacter: string | null;
  favoriteTracks: string[];
  reactions: ReactionSummary[];
  commentCount: number;
  updatedAt: Date;
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
  entries: Array<CatalogItem & { note: string | null; score: number | null }>;
}

export const reviewInputSchema = z.object({
  text: z.string().trim().max(10000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(32)).max(10).optional(),
  podIds: z.array(z.string().uuid()).max(8).optional(),
  spoiler: z.boolean().optional(),
  photoUrl: z.string().trim().max(500).optional().nullable(),
  favoriteCharacter: z.string().trim().max(120).optional().nullable(),
  favoriteTracks: z.array(z.string().trim().min(1).max(120)).max(10).optional(),
});
export type ReviewInput = z.infer<typeof reviewInputSchema>;

/* ------------------------------------------------------------------ */
/* profiles                                                            */
/* ------------------------------------------------------------------ */

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
      await tx
        .insert(follows)
        .values({ followerOrgId: orgId, followeeOrgId: targetOrgId })
        .onConflictDoNothing();
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
  const like = `%${query.trim()}%`;
  const rows = await db
    .select()
    .from(profiles)
    .where(sql`(${profiles.username} ilike ${like} or ${profiles.displayName} ilike ${like})`)
    .orderBy(profiles.displayName)
    .limit(limit);
  return Promise.all(rows.map(async (row) => toProfileSummary(row, await followCounts(row.orgId))));
}

export async function suggestedProfiles(orgId: string, limit = 8): Promise<ProfileSummary[]> {  const db = getDb();
  const followed = await db
    .select({ orgId: follows.followeeOrgId })
    .from(follows)
    .where(eq(follows.followerOrgId, orgId));
  const excluded = [orgId, ...followed.map((row) => row.orgId)];

  const rows = await db
    .select()
    .from(profiles)
    .where(ne(profiles.orgId, orgId))
    .orderBy(profiles.displayName)
    .limit(40);

  const results: ProfileSummary[] = [];
  for (const row of rows) {
    if (excluded.includes(row.orgId)) continue;
    results.push(toProfileSummary(row, await followCounts(row.orgId)));
    if (results.length >= limit) break;
  }
  return results;
}

/* ------------------------------------------------------------------ */
/* profile content                                                     */
/* ------------------------------------------------------------------ */

export interface ProfileBundle {
  profile: ProfileSummary;
  ratings: RankedItem[];
  topFive: RankedItem[];
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
    .filter((review) => Boolean(review.text) || review.tags.length > 0)
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
    .filter((review) => review.orgId !== orgId && (Boolean(review.text) || review.tags.length > 0))
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

  await withOrg(orgId, async (tx) => {
    const values = {
      reviewText: input.text?.trim() ? input.text.trim() : null,
      reviewTags: input.tags ?? [],
      spoiler: input.spoiler ?? false,
      photoUrl: input.photoUrl?.trim() || null,
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
      .select({ item: catalogItems, note: podItems.note, position: podItems.position })
      .from(podItems)
      .innerJoin(catalogItems, eq(catalogItems.id, podItems.itemId))
      .where(eq(podItems.podId, pod.id))
      .orderBy(podItems.position),
  );

  const ratings = await rankedRatings(pod.orgId);
  const scoreById = new Map(ratings.map((rating) => [rating.id, rating.score]));

  const entries = rows.map(({ item, note }) => ({
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
    const existing = await tx.select({ slug: pods.slug }).from(pods);
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
    const [countRow] = await tx
      .select({ next: sql<number>`coalesce(max(${podItems.position}), -1)::int + 1` })
      .from(podItems)
      .where(eq(podItems.podId, podId));
    await tx
      .insert(podItems)
      .values({ podId, itemId, position: countRow?.next ?? 0 })
      .onConflictDoNothing();
    return rows[0];
  });

  const detail = await podById(pod.id);
  if (!detail) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
  return detail;
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
  const db = getDb();
  const rows = await db
    .select({
      notification: notifications,
      actor: profiles,
      item: catalogItems,
    })
    .from(notifications)
    .leftJoin(profiles, eq(profiles.orgId, notifications.actorOrgId))
    .leftJoin(catalogItems, eq(catalogItems.id, notifications.itemId))
    .where(eq(notifications.orgId, orgId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);

  return rows.map(({ notification, actor, item }) => ({
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
  }));
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
  const shared = mine.filter((item) => theirScores.has(item.id));
  if (shared.length === 0) return null;
  const totalDiff = shared.reduce((sum, item) => sum + Math.abs(item.score - (theirScores.get(item.id) ?? 0)), 0);
  const avgDiff = totalDiff / shared.length;
  return Math.max(0, Math.min(100, Math.round(100 - avgDiff * 10)));
}

/** Combined "For You" feed: people you follow first, then the wider community. */
export async function feedForYou(orgId: string, limit = 12): Promise<ReviewView[]> {
  const followed = await followFeed(orgId, limit);
  if (followed.length >= limit) return followed.slice(0, limit);

  const db = getDb();
  const seen = new Set(followed.map((review) => review.id));
  const rows = await db
    .select(reviewSelect)
    .from(itemRatings)
    .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
    .innerJoin(profiles, eq(profiles.orgId, itemRatings.orgId))
    .where(ne(itemRatings.orgId, orgId))
    .orderBy(desc(itemRatings.updatedAt))
    .limit(60);

  const extra = rows
    .map(toReview)
    .filter(
      (review) =>
        !seen.has(review.id) && (Boolean(review.text) || review.tags.length > 0),
    )
    .slice(0, limit - followed.length);

  return attachEngagement(orgId, [...followed, ...extra]);
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
    const rows = await tx.select({ id: pods.id }).from(pods).where(eq(pods.id, podId)).limit(1);
    if (!rows[0]) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
    await tx.delete(podItems).where(and(eq(podItems.podId, podId), eq(podItems.itemId, itemId)));
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