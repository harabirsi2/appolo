import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { blendGenreWeights, diversifyRankedFeed, normalizeGenreWeights, rankFeed, scoreForElo, MediaKind } from "@appolo/core";
import { z } from "zod";
import { DomainError } from "./errors";
import { getProfileByOrgId } from "./social-graph";
import { listInterests } from "./interests";
import { rankedRatings, type RankedItem } from "./rankings";
import { httpsUrl, mediaUrl } from "./social-validation";
import { getDb, withOrg, schema } from "@/lib/db";
const { profiles, follows, feedDismissals, pods, podItems, catalogItems, itemRatings, ratingReactions, ratingComments, ratingEvents, socialNotifications: notifications } = schema;

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
  imageUrl: string | null;
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
export const PHOTO_UNLOCK_REVIEWS = 20;

/** Photo links: https, or an app-relative path like /uploads/x.jpg. Blocks javascript:, data: and //host URLs. */
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
    imageUrl: row.item.imageUrl ?? null,
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
export interface CommentView {
  id: string;
  orgId: string;
  username: string;
  displayName: string;
  avatarHue: number;
  body: string;
  createdAt: Date;
}
export interface CommentPage {
  comments: CommentView[];
  total: number;
}
export async function commentCount(ratingId: string): Promise<number> {
  const db = getDb();
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(ratingComments)
    .where(eq(ratingComments.ratingId, ratingId));
  return row?.count ?? 0;
}

/** One page of comments, oldest first, with the total so the client can paginate. */
export async function commentsFor(
  ratingId: string,
  limit = 20,
  offset = 0,
): Promise<CommentPage> {
  const db = getDb();
  const [rows, total] = await Promise.all([
    db
      .select({ comment: ratingComments, profile: profiles })
      .from(ratingComments)
      .innerJoin(profiles, eq(profiles.orgId, ratingComments.orgId))
      .where(eq(ratingComments.ratingId, ratingId))
      .orderBy(ratingComments.createdAt)
      .limit(limit)
      .offset(offset),
    commentCount(ratingId),
  ]);
  return {
    comments: rows.map(({ comment, profile }) => ({
      id: comment.id,
      orgId: comment.orgId,
      username: profile.username,
      displayName: profile.displayName,
      avatarHue: profile.avatarHue,
      body: comment.body,
      createdAt: comment.createdAt,
    })),
    total,
  };
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
): Promise<{ comment: CommentView; total: number }> {
  const trimmed = body.trim();
  if (!trimmed) throw new DomainError("EMPTY_COMMENT", "Write something first.", 400);
  if (trimmed.length > 1000) throw new DomainError("COMMENT_TOO_LONG", "Keep comments under 1,000 characters.", 400);
  const owner = await ratingOwner(ratingId);
  if (!owner) throw new DomainError("RATING_NOT_FOUND", "That review does not exist.", 404);

  const [created] = await withOrg(orgId, async (tx) => {
    const rows = await tx
      .insert(ratingComments)
      .values({ ratingId, orgId, body: trimmed })
      .returning({ id: ratingComments.id, createdAt: ratingComments.createdAt });
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
    return rows;
  });
  if (!created) throw new DomainError("COMMENT_FAILED", "Could not save that comment.", 500);

  const profile = await getProfileByOrgId(orgId);
  return {
    comment: {
      id: created.id,
      orgId,
      username: profile?.username ?? "you",
      displayName: profile?.displayName ?? "You",
      avatarHue: profile?.avatarHue ?? 0,
      body: trimmed,
      createdAt: created.createdAt,
    },
    total: await commentCount(ratingId),
  };
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
export async function feedForYou(orgId: string, limit = 12): Promise<ReviewView[]> {
  const db = getDb();
  const [followedRows, ownRatings, interests, dismissals] = await Promise.all([
    db.select({ orgId: follows.followeeOrgId }).from(follows).where(eq(follows.followerOrgId, orgId)),
    db
      .select({ genres: catalogItems.genres })
      .from(itemRatings)
      .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
      .where(eq(itemRatings.orgId, orgId)),
    listInterests(orgId),
    withOrg(orgId, (tx) =>
      tx.select({ ratingId: feedDismissals.ratingId }).from(feedDismissals).where(eq(feedDismissals.orgId, orgId)),
    ),
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

  const ranked = diversifyRankedFeed(
    rankFeed(
    candidates.map((review) => {
      const stats = engagement.get(review.id);
      return {
        id: review.id,
        authorId: review.orgId,
        createdAt: review.updatedAt,
        score: review.score,
        genres: genresById.get(review.id) ?? [],
        kind: review.kind,
        followed: followedSet.has(review.orgId),
        reactions: (stats?.reactions ?? []).reduce((sum, reaction) => sum + reaction.count, 0),
        comments: stats?.commentCount ?? 0,
      };
    }),
      { followedAuthorIds: followedSet, genreWeights, seenIds: dismissals.map((row) => row.ratingId) },
    ),
  );

  const byId = new Map(candidates.map((review) => [review.id, review]));
  const reviews = ranked.slice(0, limit).flatMap((entry) => {
    const review = byId.get(entry.item.id);
    return review ? [{ ...review, reason: entry.reason.label }] : [];
  });
  return attachEngagement(orgId, reviews);
}

/**
 * Strict chronological Following feed: only reviews by accounts the viewer
 * follows, newest edit first. No ranking, diversity or exploration is applied,
 * so this is exactly what the people you follow posted, in order.
 */
export async function feedFollowing(orgId: string, limit = 12): Promise<ReviewView[]> {
  const db = getDb();
  const followed = await db
    .select({ orgId: follows.followeeOrgId })
    .from(follows)
    .where(eq(follows.followerOrgId, orgId));
  if (followed.length === 0) return [];

  const rows = await db
    .select(reviewSelect)
    .from(itemRatings)
    .innerJoin(catalogItems, eq(catalogItems.id, itemRatings.itemId))
    .innerJoin(profiles, eq(profiles.orgId, itemRatings.orgId))
    .where(inArray(itemRatings.orgId, followed.map((row) => row.orgId)))
    .orderBy(desc(itemRatings.updatedAt))
    .limit(Math.max(limit * 3, limit));

  const reviews = rows
    .map(toReview)
    .filter((review) => Boolean(review.text) || Boolean(review.videoUrl) || review.tags.length > 0)
    .slice(0, limit);
  return attachEngagement(orgId, reviews);
}

/** Hide one review from the viewer's For-you feed. */
export async function dismissFeedReview(orgId: string, ratingId: string): Promise<void> {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!isUuid.test(ratingId)) {
    throw new DomainError("REVIEW_NOT_FOUND", "That review no longer exists.", 404);
  }
  try {
    await withOrg(orgId, (tx) =>
      tx.insert(feedDismissals).values({ orgId, ratingId }).onConflictDoNothing(),
    );
  } catch (error) {
    if ((error as { code?: string }).code === "23503") {
      throw new DomainError("REVIEW_NOT_FOUND", "That review no longer exists.", 404);
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* pod editing                                                         */
/* ------------------------------------------------------------------ */
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

/* Re-exported so existing imports from "./social" keep working. */
export * from "./pods";
export * from "./social-graph";
