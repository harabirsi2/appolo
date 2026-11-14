import { and, desc, eq, inArray, ne, notInArray, sql } from "drizzle-orm";
import { MEDIA_KINDS, genreProfile, scoreForElo, tasteMatch, MatchConfidence, MediaKind } from "@appolo/core";
import { type CatalogItem } from "./catalog-item";
import { rankedRatings, watchlistFor, type RankedItem } from "./rankings";
import { podsForProfile, type PodCard } from "./pods";
import { listInterests } from "./interests";
import { z } from "zod";
import { DomainError } from "./errors";
import { getDb, withOrg, schema } from "@/lib/db";
const { profiles, follows, catalogItems, itemRatings, searchHistory, socialNotifications: notifications } = schema;

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
