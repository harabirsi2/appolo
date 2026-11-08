import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { scoreForElo, type MediaKind } from "@appolo/core";
import { getDb, withOrg, schema } from "@/lib/db";
import { DomainError } from "./errors";
import { rankedRatings, type CatalogItem, type RankedItem } from "./rankings";

const { profiles, follows, pods, podItems, catalogItems, itemRatings } = schema;

export interface ProfileSummary {
  orgId: string;
  username: string;
  displayName: string;
  bio: string | null;
  avatarHue: number;
  followers: number;
  following: number;
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
  text: z.string().trim().max(1000).optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(32)).max(6).optional(),
  podIds: z.array(z.string().uuid()).max(8).optional(),
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
}

export async function profileBundle(profile: ProfileSummary): Promise<ProfileBundle> {
  const [ratings, podCards] = await Promise.all([
    rankedRatings(profile.orgId),
    podsForProfile(profile.orgId, profile.username, profile.displayName),
  ]);
  return { profile, ratings, topFive: ratings.slice(0, 5), pods: podCards };
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
    updatedAt: row.rating.updatedAt,
  };
}

const reviewSelect = {
  rating: itemRatings,
  profile: profiles,
  item: catalogItems,
} as const;

/** Public ratings + reviews for one catalog item, across every profile. */
export async function itemCommunity(itemId: string, limit = 12): Promise<CommunityStats> {
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

  return { count: ratings.length, average, distribution, reviews };
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

  return rows
    .map(toReview)
    .filter((review) => review.orgId !== orgId && (Boolean(review.text) || review.tags.length > 0))
    .slice(0, limit);
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
    await tx
      .insert(itemRatings)
      .values({
        orgId,
        itemId,
        reviewText: input.text?.trim() ? input.text.trim() : null,
        reviewTags: input.tags ?? [],
      })
      .onConflictDoUpdate({
        target: [itemRatings.orgId, itemRatings.itemId],
        set: {
          reviewText: input.text?.trim() ? input.text.trim() : null,
          reviewTags: input.tags ?? [],
          updatedAt: new Date(),
        },
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