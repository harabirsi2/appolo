import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { mapCatalogItem, toScore, type CatalogItem } from "./catalog-item";
import { rankedRatings } from "./rankings";
import { z } from "zod";
import { DomainError } from "./errors";
import { getDb, withOrg, schema } from "@/lib/db";
const { profiles, follows, pods, podItems, podMembers, catalogItems, itemRatings } = schema;

/** Membership role on a collaborative pod. */
export type PodRole = "owner" | "editor" | "viewer";
export const POD_ROLES: readonly PodRole[] = ["owner", "editor", "viewer"];

export interface PodMemberView {
  orgId: string;
  username: string;
  displayName: string;
  avatarHue: number;
  role: PodRole;
}

/** Average of the members' own scores for one title, plus how many scored it. */
export interface PodConsensus {
  average: number;
  count: number;
}

export interface PodCard {
  id: string;
  orgId: string;
  title: string;
  slug: string;
  description: string | null;
  ownerUsername: string;
  ownerDisplayName: string;
  /** Collaborative pods take members and publish a group consensus score. */
  isCollaborative: boolean;
  memberCount: number;
  count: number;
  items: CatalogItem[];
}
export interface PodDetail extends PodCard {
  entries: Array<
    CatalogItem & {
      note: string | null;
      score: number | null;
      addedByUsername: string | null;
      /** Group score across members, only on collaborative pods. */
      consensus: PodConsensus | null;
    }
  >;
  members: PodMemberView[];
  /** The acting org's role, or null when they are not a member. */
  viewerRole: PodRole | null;
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
  const memberCounts = await withOrg(ownerOrgId, (tx) =>
    tx
      .select({ podId: podMembers.podId, n: sql<number>`count(*)::int` })
      .from(podMembers)
      .where(inArray(podMembers.podId, ids))
      .groupBy(podMembers.podId),
  );
  const countByPod = new Map(memberCounts.map((row) => [row.podId, row.n]));

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
      isCollaborative: pod.isCollaborative,
      memberCount: countByPod.get(pod.id) ?? (pod.isCollaborative ? 1 : 0),
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
export async function podByOwnerAndSlug(
  username: string,
  slug: string,
  viewerOrgId?: string | null,
): Promise<PodDetail | null> {
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
  return podDetail(pod, profile, viewerOrgId ?? null);
}
export async function podById(podId: string, viewerOrgId?: string | null): Promise<PodDetail | null> {
  const db = getDb();
  const rows = await db
    .select({ pod: pods, profile: profiles })
    .from(pods)
    .innerJoin(profiles, eq(profiles.orgId, pods.orgId))
    .where(and(eq(pods.id, podId), eq(pods.visibility, "public")))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return podDetail(row.pod, row.profile, viewerOrgId ?? null);
}

/**
 * Members of a pod, owner first.
 *
 * Pods are only ever detailed while public, so this reads with no tenant scope:
 * the `pod_members` public-read policy returns every member row for a public
 * pod, and the `profiles` public-read policy makes the joins visible. A tenant
 * scope would filter the join down to the viewer's own profile row.
 */
export async function podMembersFor(podId: string, _ownerOrgId?: string): Promise<PodMemberView[]> {
  const rows = await getDb()
    .select({ member: podMembers, profile: profiles })
    .from(podMembers)
    .innerJoin(profiles, eq(profiles.orgId, podMembers.orgId))
    .where(eq(podMembers.podId, podId));
  const rank: Record<PodRole, number> = { owner: 0, editor: 1, viewer: 2 };
  return rows
    .map(({ member, profile }) => ({
      orgId: member.orgId,
      username: profile.username,
      displayName: profile.displayName,
      avatarHue: profile.avatarHue,
      role: (POD_ROLES.includes(member.role as PodRole) ? member.role : "viewer") as PodRole,
    }))
    .sort((a, b) => rank[a.role] - rank[b.role] || a.username.localeCompare(b.username));
}

/**
 * Each member's 0–10 score for the pod's titles, keyed by item id.
 *
 * Ratings live behind row-level security, so the read has to run once per
 * member under their own tenant scope. Members who have not rated a title are
 * simply absent from that item's list.
 */
async function memberScoresByItem(
  memberOrgIds: readonly string[],
  itemIds: readonly string[],
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  if (memberOrgIds.length === 0 || itemIds.length === 0) return out;
  const perMember = await Promise.all(
    memberOrgIds.map((memberOrgId) =>
      withOrg(memberOrgId, (tx) =>
        tx
          .select({ itemId: itemRatings.itemId, elo: itemRatings.elo, manualScore: itemRatings.manualScore })
          .from(itemRatings)
          .where(and(eq(itemRatings.orgId, memberOrgId), inArray(itemRatings.itemId, [...itemIds]))),
      ).catch(() => []),
    ),
  );
  for (const rows of perMember) {
    for (const row of rows) {
      const score = row.manualScore === null ? toScore(row.elo) : Number(row.manualScore);
      if (!Number.isFinite(score)) continue;
      const list = out.get(row.itemId) ?? [];
      list.push(score);
      out.set(row.itemId, list);
    }
  }
  return out;
}

async function podDetail(
  pod: typeof pods.$inferSelect,
  profile: typeof profiles.$inferSelect,
  viewerOrgId: string | null,
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

  const members = pod.isCollaborative ? await podMembersFor(pod.id, pod.orgId) : [];
  const itemIds = rows.map((row) => row.item.id);
  const consensusByItem = pod.isCollaborative
    ? await memberScoresByItem(
        members.map((member) => member.orgId),
        itemIds,
      )
    : new Map<string, number[]>();

  const consensusFor = (itemId: string): PodConsensus | null => {
    const scores = consensusByItem.get(itemId);
    if (!scores || scores.length < 2) return null;
    const average = scores.reduce((sum, value) => sum + value, 0) / scores.length;
    return { average: Math.round(average * 10) / 10, count: scores.length };
  };

  const entries = rows.map(({ item, note, addedByOrgId }) => ({
    ...mapCatalogItem(item),
    note: note ?? null,
    score: scoreById.get(item.id) ?? null,
    addedByUsername: addedByOrgId ? (contributorByOrg.get(addedByOrgId) ?? null) : null,
    consensus: consensusFor(item.id),
  }));

  return {
    id: pod.id,
    orgId: pod.orgId,
    title: pod.title,
    slug: pod.slug,
    description: pod.description ?? null,
    ownerUsername: profile.username,
    ownerDisplayName: profile.displayName,
    isCollaborative: pod.isCollaborative,
    memberCount: members.length || (pod.isCollaborative ? 1 : 0),
    count: entries.length,
    items: entries.slice(0, 4),
    entries,
    members,
    viewerRole: viewerOrgId ? members.find((member) => member.orgId === viewerOrgId)?.role ?? null : null,
  };
}
export const podInputSchema = z.object({
  title: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional().nullable(),
  itemIds: z.array(z.string().uuid()).max(50).optional(),
  /** Collaborative pods take members and publish a group consensus score. */
  isCollaborative: z.boolean().optional(),
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
        isCollaborative: input.isCollaborative ?? false,
      })
      .returning();
    if (!pod) throw new DomainError("POD_FAILED", "Could not create that pod.", 500);

    // The creator is always the pod owner, whether or not it is collaborative.
    if (pod.isCollaborative) {
      await tx
        .insert(podMembers)
        .values({ podId: pod.id, orgId, role: "owner" })
        .onConflictDoNothing();
    }

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
    // Own pods accept edits always. On a collaborative pod only the owner and
    // editors can add titles; other public pods stay open to contributions.
    if (rows[0].orgId !== orgId) {
      if (rows[0].isCollaborative) {
        const roleRows = await tx
          .select({ role: podMembers.role })
          .from(podMembers)
          .where(and(eq(podMembers.podId, podId), eq(podMembers.orgId, orgId)))
          .limit(1);
        const role = roleRows[0]?.role;
        if (role !== "owner" && role !== "editor") {
          throw new DomainError("POD_FORBIDDEN", "Only pod editors can add titles here.", 403);
        }
      } else if (rows[0].visibility !== "public") {
        throw new DomainError("POD_NOT_PUBLIC", "That pod is not open to contributions.", 403);
      }
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

  const detail = await podById(pod.id, orgId);
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
  /** True when the acting org is a member (owner/editor/viewer). */
  member: boolean;
  /** Collaborative pods surface their group consensus on items. */
  isCollaborative: boolean;
  contains: boolean;
}

/**
 * Pods this profile can add a title to: their own pods, public pods from people
 * they follow, and any public collaborative pod they have joined.
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
  const memberPods = await db
    .select({ pod: pods, owner: profiles })
    .from(podMembers)
    .innerJoin(pods, eq(pods.id, podMembers.podId))
    .innerJoin(profiles, eq(profiles.orgId, pods.orgId))
    .where(and(eq(podMembers.orgId, orgId), eq(pods.visibility, "public")));

  // A pod can appear as both followed and joined; keep one row per pod id.
  const seen = new Set(owned.podRows.map((pod) => pod.id));
  const candidates: Array<{ pod: typeof pods.$inferSelect; owner: typeof profiles.$inferSelect | null }> = [];
  for (const { pod, owner } of [...followedPods, ...memberPods]) {
    if (seen.has(pod.id)) continue;
    seen.add(pod.id);
    candidates.push({ pod, owner });
  }

  const candidateIds = candidates.map(({ pod }) => pod.id);
  const candidateItems =
    candidateIds.length > 0
      ? await db
          .select({ podId: podItems.podId })
          .from(podItems)
          .where(and(inArray(podItems.podId, candidateIds), eq(podItems.itemId, itemId)))
      : [];
  const candidateContains = new Set(candidateItems.map((row) => row.podId));

  return [
    ...owned.podRows.map((pod) => ({
      id: pod.id,
      title: pod.title,
      ownerUsername: "you",
      owned: true,
      member: true,
      isCollaborative: pod.isCollaborative,
      contains: owned.contains.has(pod.id),
    })),
    ...candidates.map(({ pod, owner }) => ({
      id: pod.id,
      title: pod.title,
      ownerUsername: owner?.username ?? "someone",
      owned: false,
      member: memberPods.some((row) => row.pod.id === pod.id),
      isCollaborative: pod.isCollaborative,
      contains: candidateContains.has(pod.id),
    })),
  ];
}

/* ------------------------------------------------------------------ */
/* collaborative pods: members and roles                               */
/* ------------------------------------------------------------------ */

/**
 * Add a member to a collaborative pod. The owner may add anyone; the acting
 * org may always join by username themselves. `role` is clamped to editor or
 * viewer — owner is assigned at creation and never granted here.
 */
export async function addPodMember(
  actorOrgId: string,
  podId: string,
  username: string,
  role: Exclude<PodRole, "owner"> = "viewer",
): Promise<PodDetail> {
  const db = getDb();
  const [target] = await db
    .select()
    .from(profiles)
    .where(sql`lower(${profiles.username}) = ${username.trim().toLowerCase()}`)
    .limit(1);
  if (!target) throw new DomainError("PROFILE_NOT_FOUND", "No profile matches that username.", 404);

  await withOrg(actorOrgId, async (tx) => {
    const rows = await tx.select().from(pods).where(eq(pods.id, podId)).limit(1);
    const pod = rows[0];
    if (!pod) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
    if (!pod.isCollaborative) {
      throw new DomainError("POD_NOT_COLLABORATIVE", "Turn on collaboration before adding members.", 400);
    }
    if (pod.orgId !== actorOrgId && target.orgId !== actorOrgId) {
      throw new DomainError("POD_FORBIDDEN", "Only the pod owner can add other members.", 403);
    }
    const nextRole = target.orgId === pod.orgId ? "owner" : role === "editor" ? "editor" : "viewer";
    await tx
      .insert(podMembers)
      .values({ podId, orgId: target.orgId, role: nextRole })
      .onConflictDoUpdate({
        target: [podMembers.podId, podMembers.orgId],
        set: { role: nextRole },
      });
  });

  const detail = await podById(podId, actorOrgId);
  if (!detail) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
  return detail;
}

/** Join a collaborative pod as yourself, at viewer level. */
export async function joinPod(orgId: string, podId: string): Promise<PodDetail> {
  return addPodMember(orgId, podId, await usernameFor(orgId), "viewer");
}

/**
 * Change a member's role. Owners only; the owner's own row cannot be demoted.
 */
export async function setMemberRole(
  actorOrgId: string,
  podId: string,
  memberOrgId: string,
  role: Exclude<PodRole, "owner">,
): Promise<PodDetail> {
  await withOrg(actorOrgId, async (tx) => {
    const rows = await tx.select().from(pods).where(eq(pods.id, podId)).limit(1);
    const pod = rows[0];
    if (!pod || pod.orgId !== actorOrgId) {
      throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
    }
    if (memberOrgId === pod.orgId) {
      throw new DomainError("POD_OWNER_IMMUTABLE", "The pod owner keeps the owner role.", 400);
    }
    const nextRole = role === "editor" ? "editor" : "viewer";
    const updated = await tx
      .update(podMembers)
      .set({ role: nextRole })
      .where(and(eq(podMembers.podId, podId), eq(podMembers.orgId, memberOrgId)))
      .returning({ id: podMembers.id });
    if (updated.length === 0) {
      throw new DomainError("MEMBER_NOT_FOUND", "That person is not a member of this pod.", 404);
    }
  });
  const detail = await podById(podId, actorOrgId);
  if (!detail) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
  return detail;
}

/** Remove a member. Owners can remove anyone but themselves; members can leave. */
export async function removePodMember(
  actorOrgId: string,
  podId: string,
  memberOrgId: string,
): Promise<PodDetail> {
  await withOrg(actorOrgId, async (tx) => {
    const rows = await tx.select().from(pods).where(eq(pods.id, podId)).limit(1);
    const pod = rows[0];
    if (!pod) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
    if (memberOrgId === pod.orgId) {
      throw new DomainError("POD_OWNER_IMMUTABLE", "The owner cannot leave their own pod.", 400);
    }
    if (pod.orgId !== actorOrgId && memberOrgId !== actorOrgId) {
      throw new DomainError("POD_FORBIDDEN", "Only the owner can remove other members.", 403);
    }
    await tx
      .delete(podMembers)
      .where(and(eq(podMembers.podId, podId), eq(podMembers.orgId, memberOrgId)));
  });
  const detail = await podById(podId, actorOrgId);
  if (!detail) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
  return detail;
}

async function usernameFor(orgId: string): Promise<string> {
  const [profile] = await getDb()
    .select({ username: profiles.username })
    .from(profiles)
    .where(eq(profiles.orgId, orgId))
    .limit(1);
  if (!profile) throw new DomainError("PROFILE_MISSING", "Create a profile before joining a pod.", 400);
  return profile.username;
}

/* ------------------------------------------------------------------ */
/* comments + reactions                                                */
/* ------------------------------------------------------------------ */
export const podUpdateSchema = z.object({
  title: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(300).optional().nullable(),
  isCollaborative: z.boolean().optional(),
});
export type PodUpdate = z.infer<typeof podUpdateSchema>;
export async function updatePod(orgId: string, podId: string, input: PodUpdate): Promise<PodDetail> {
  await withOrg(orgId, async (tx) => {
    const rows = await tx.select().from(pods).where(eq(pods.id, podId)).limit(1);
    // Public pods are readable by every org, but only the owner may edit them.
    // Without the explicit owner check the UPDATE matches no rows (RLS) and the
    // endpoint would still report success.
    if (!rows[0] || rows[0].orgId !== orgId) throw new DomainError("POD_NOT_FOUND", "That pod does not exist.", 404);
    const nextCollaborative = input.isCollaborative ?? rows[0].isCollaborative;
    await tx
      .update(pods)
      .set({
        title: input.title?.trim() || rows[0].title,
        description: input.description === undefined ? rows[0].description : input.description?.trim() || null,
        isCollaborative: nextCollaborative,
      })
      .where(eq(pods.id, podId));
    // Turning collaboration on makes the owner the first member; turning it
    // off clears the roster so a re-enable starts clean.
    if (nextCollaborative) {
      await tx
        .insert(podMembers)
        .values({ podId, orgId, role: "owner" })
        .onConflictDoUpdate({ target: [podMembers.podId, podMembers.orgId], set: { role: "owner" } });
    } else if (input.isCollaborative === false) {
      await tx.delete(podMembers).where(eq(podMembers.podId, podId));
    }
  });
  const detail = await podById(podId, orgId);
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
