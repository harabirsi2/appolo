import { sql } from "drizzle-orm";
import type { DuplicateVerdict } from "@appolo/core";
import { duplicateVerdict, pickCanonical, titleKey } from "@appolo/core";
import { getDb } from "@/lib/db";

/**
 * Duplicate detection and merging for the shared catalog.
 *
 * Detection is read-only: cluster candidate rows by kind + normalized title +
 * year and score every pair with `duplicateVerdict` (external ref > exact
 * title+year > fuzzy title+year). Merging is destructive but rating-preserving:
 * it calls the `merge_catalog_items` SQL function, which re-points ratings and
 * matchups instead of dropping them.
 */

export interface DuplicatePair {
  source: { id: string; title: string; year: number | null; externalRef: string | null };
  target: { id: string; title: string; year: number | null; externalRef: string | null };
  verdict: DuplicateVerdict;
}

export interface DuplicateReport {
  pairs: DuplicatePair[];
  /** Clusters where every row would collapse into the same canonical row. */
  groups: Array<{ key: string; canonicalId: string; memberIds: string[] }>;
}

/**
 * Cluster duplicates inside one kind. We only look at rows that share a title
 * prefix-ish bucket (same normalized title, or the same year and a shared
 * first token) to keep this cheap on a large catalog; pass `kind` and `limit`
 * to scope a run.
 */
export async function findDuplicates(options: {
  kind?: string;
  limit?: number;
} = {}): Promise<DuplicateReport> {
  const db = getDb();
  const limit = Math.min(Math.max(options.limit ?? 500, 1), 5000);
  const rows = (await db.execute(sql`
    select ci.id, ci.kind::text as kind, ci.title, ci.year, ci.external_ref, ci.created_at,
           (select count(*)::int from public.item_ratings r where r.item_id = ci.id) as ratings
      from public.catalog_items ci
     where ci.enrichment_status <> 'failed'
       ${options.kind ? sql`and ci.kind = ${options.kind}` : sql``}
     order by ci.kind, ci.normalized_title, ci.year
     limit ${limit}
  `)) as unknown as Array<{
    id: string;
    kind: string;
    title: string;
    year: number | null;
    external_ref: string | null;
    created_at: Date;
    ratings: number;
  }>;

  const buckets = new Map<string, typeof rows>();
  for (const row of rows) {
    const key = `${row.kind}|${titleKey(row.title)}`;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  const pairs: DuplicatePair[] = [];
  const groups: DuplicateReport["groups"] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.length < 2) continue;
    const counts = new Map(bucket.map((row) => [row.id, row.ratings]));
    const canonicalId = pickCanonical(
      bucket.map((row) => ({ id: row.id, createdAt: row.created_at })),
      counts,
    ).id;
    const canonical = bucket.find((row) => row.id === canonicalId)!;
    const memberIds = bucket.map((row) => row.id);
    let any = false;
    for (const row of bucket) {
      if (row.id === canonical.id) continue;
      const verdict = duplicateVerdict(
        { id: row.id, kind: row.kind, title: row.title, year: row.year, externalRef: row.external_ref },
        {
          id: canonical.id,
          kind: canonical.kind,
          title: canonical.title,
          year: canonical.year,
          externalRef: canonical.external_ref,
        },
      );
      if (!verdict.duplicate) continue;
      any = true;
      pairs.push({
        source: { id: row.id, title: row.title, year: row.year, externalRef: row.external_ref },
        target: {
          id: canonical.id,
          title: canonical.title,
          year: canonical.year,
          externalRef: canonical.external_ref,
        },
        verdict,
      });
    }
    if (any)     groups.push({ key, canonicalId, memberIds });
  }
  return { pairs, groups };
}

export interface MergeResult {
  sourceId: string;
  targetId: string;
  movedRatings: number;
  mergedRatings: number;
  movedMatchups: number;
  droppedMatchups: number;
}

/**
 * Fold `sourceId` into `targetId`, preserving every rating (see the SQL
 * function for the exact rules). Ids are sorted inside the function so a
 * concurrent merge of the same pair cannot deadlock.
 */
export async function mergeCatalogItems(sourceId: string, targetId: string): Promise<MergeResult> {
  const db = getDb();
  const rows = (await db.execute(
    sql`select public.merge_catalog_items(${sourceId}::uuid, ${targetId}::uuid) as merged`,
  )) as unknown as Array<{ merged: MergeResult | string }>;
  const raw = rows[0]?.merged;
  if (!raw) throw new Error("merge_catalog_items returned no result");
  return typeof raw === "string" ? (JSON.parse(raw) as MergeResult) : raw;
}

/** Apply every safe duplicate pair (dry run by default at the call site). */
export async function mergeAllDuplicates(options: { kind?: string; limit?: number; dryRun?: boolean } = {}) {
  const report = await findDuplicates({ kind: options.kind, limit: options.limit });
  if (options.dryRun) return { report, merged: [] as MergeResult[] };
  const merged: MergeResult[] = [];
  for (const pair of report.pairs) {
    merged.push(await mergeCatalogItems(pair.source.id, pair.target.id));
  }
  return { report, merged };
}
