import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { mapCatalogItem, type CatalogItem } from "./catalog-item";
import { rankedRatings } from "./rankings";
import { z } from "zod";
import { DomainError } from "./errors";
import { getDb, withOrg, schema } from "@/lib/db";
const { profiles, follows, pods, podItems, catalogItems } = schema;

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
      items: items.slice(0, 4).map(mapCatalogItem),
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
    ...mapCatalogItem(item),
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
  const db = getDb();
  const [profile] = await db.select().from(profiles).where(eq(profiles.orgId, orgId)).limit(1);
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
    db
      .select({ orgId: follows.followeeOrgId })
      .from(follows)
      .where(eq(follows.followerOrgId, orgId)),
  ]);

  const followedPods =
    followed.length > 0
      ? await db
          .select({ pod: pods, owner: profiles })
          .from(pods)
          .innerJoin(profiles, eq(profiles.orgId, pods.orgId))
          .where(and(inArray(pods.orgId, followed.map((row) => row.orgId)), eq(pods.visibility, "public")))
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
export const podUpdateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional().nullable(),
});
export type PodUpdate = z.infer<typeof podUpdateSchema>;
export async function updatePod(orgId: string, podId: string, input: PodUpdate): Promise<PodDetail> {
  await withOrg(orgId, async (tx) => {
    const rows = await tx.select().from(pods).where(eq(pods.id, podId)).limit(1);
    // Public pods are readable by every org, but only the owner may edit them.
    // Without the explicit owner check the UPDATE matches no rows (RLS) and the
    // endpoint would still report success.
    if (!rows[0] || rows[0].orgId !== orgId) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
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
    const rows = await tx.select({ id: pods.id, orgId: pods.orgId }).from(pods).where(eq(pods.id, podId)).limit(1);
    // Owner check up front: a cross-org DELETE would otherwise match no rows
    // and return a misleading { ok: true } while the pod survives.
    if (!rows[0] || rows[0].orgId !== orgId) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
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
    const rows = await tx.select({ id: pods.id, orgId: pods.orgId }).from(pods).where(eq(pods.id, podId)).limit(1);
    if (!rows[0] || rows[0].orgId !== orgId) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
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
  const db = getDb();
  const [profile] = await db.select().from(profiles).where(eq(profiles.orgId, orgId)).limit(1);
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
