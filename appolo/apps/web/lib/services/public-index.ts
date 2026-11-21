import { and, eq, gt, isNotNull } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { getDb, schema } from "@/lib/db";
import { PUBLIC_TAGS } from "@/lib/revalidate-public";

const { profiles, pods, itemRatings } = schema;

/**
 * Paged, capped read of everything public.
 *
 * A sitemap is not a database dump: it is crawled, so the caps keep the file
 * within the 50k-URL protocol limit and keep the query bounded even if the
 * catalog grows far past the cap. Rows are paged by primary key (or username)
 * so no OFFSET scan is needed.
 */
const PAGE_SIZE = 500;
const PROFILE_CAP = 5000;
const POD_CAP = 2000;
const REVIEW_CAP = 5000;

export interface PublicIndex {
  /** App-relative path per public profile. */
  profiles: string[];
  /** App-relative `/owner/slug` path per public pod. */
  pods: string[];
  /** App-relative `/review/<id>` path per public review. */
  reviews: string[];
}

async function profilePaths(): Promise<string[]> {
  const db = getDb();
  const out: string[] = [];
  let cursor: string | null = null;

  while (out.length < PROFILE_CAP) {
    const rows = await db
      .select({ username: profiles.username })
      .from(profiles)
      .where(
        and(
          eq(profiles.moderationStatus, "visible"),
          cursor ? gt(profiles.username, cursor) : undefined,
        ),
      )
      .orderBy(profiles.username)
      .limit(PAGE_SIZE);
    if (rows.length === 0) break;
    for (const row of rows) {
      out.push(`/${encodeURIComponent(row.username)}`);
      if (out.length >= PROFILE_CAP) break;
    }
    cursor = rows[rows.length - 1]!.username;
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

async function podPaths(): Promise<string[]> {
  const db = getDb();
  const out: string[] = [];
  let cursor: string | null = null;

  while (out.length < POD_CAP) {
    const rows = await db
      .select({ id: pods.id, slug: pods.slug, username: profiles.username })
      .from(pods)
      .innerJoin(profiles, eq(profiles.orgId, pods.orgId))
      .where(
        and(
          eq(pods.visibility, "public"),
          eq(profiles.moderationStatus, "visible"),
          cursor ? gt(pods.id, cursor) : undefined,
        ),
      )
      .orderBy(pods.id)
      .limit(PAGE_SIZE);
    if (rows.length === 0) break;
    for (const row of rows) {
      out.push(`/${encodeURIComponent(row.username)}/${encodeURIComponent(row.slug)}`);
      if (out.length >= POD_CAP) break;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

async function reviewPaths(): Promise<string[]> {
  const db = getDb();
  const out: string[] = [];
  let cursor: string | null = null;

  while (out.length < REVIEW_CAP) {
    const rows = await db
      .select({ id: itemRatings.id })
      .from(itemRatings)
      .innerJoin(profiles, eq(profiles.orgId, itemRatings.orgId))
      .where(
        and(
          isNotNull(itemRatings.reviewText),
          eq(itemRatings.moderationStatus, "visible"),
          eq(profiles.moderationStatus, "visible"),
          cursor ? gt(itemRatings.id, cursor) : undefined,
        ),
      )
      .orderBy(itemRatings.id)
      .limit(PAGE_SIZE);
    if (rows.length === 0) break;
    for (const row of rows) {
      out.push(`/review/${row.id}`);
      if (out.length >= REVIEW_CAP) break;
    }
    cursor = rows[rows.length - 1]!.id;
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

/**
 * Each list is cached under its own tag, so a mutation can drop just the kind
 * it changed (`revalidateTag(PUBLIC_TAGS.reviews)`) without rebuilding the
 * whole index. The 300s window only matters for changes made outside the app.
 */
const profilePathsCached = unstable_cache(profilePaths, ["public-index:profiles"], {
  revalidate: 300,
  tags: [PUBLIC_TAGS.profiles],
});
const podPathsCached = unstable_cache(podPaths, ["public-index:pods"], {
  revalidate: 300,
  tags: [PUBLIC_TAGS.pods],
});
const reviewPathsCached = unstable_cache(reviewPaths, ["public-index:reviews"], {
  revalidate: 300,
  tags: [PUBLIC_TAGS.reviews],
});

export async function publicIndex(): Promise<PublicIndex> {
  const [profiles, pods, reviews] = await Promise.all([
    profilePathsCached(),
    podPathsCached(),
    reviewPathsCached(),
  ]);
  return { profiles, pods, reviews };
}
