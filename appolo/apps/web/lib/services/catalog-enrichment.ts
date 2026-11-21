import { sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { MetadataCandidate } from "@appolo/core";

const { catalogEnrichmentQueue } = schema;

/**
 * Durable enrichment outbox.
 *
 * A provider hit is written to `catalog_items` as `enrichment_status =
 * 'pending'` so the search result is immediately rankable, and the work that
 * upgrades it (details, trailer, cached cover) is recorded here. The BullMQ job
 * is a *hint*: if Redis is down, restarts, or the job is lost, the sweeper in
 * `apps/worker/src/catalog.ts` re-derives the work from this table. Nothing is
 * ever lost to a dropped job.
 */
export interface EnrichmentRequest {
  externalRef: string;
  source: string;
  kind: MetadataCandidate["kind"];
  payload: Record<string, unknown>;
}

export function enrichmentPayload(candidate: MetadataCandidate): Record<string, unknown> {
  return {
    title: candidate.title,
    subtitle: candidate.subtitle,
    year: candidate.year,
    imageUrl: candidate.imageUrl ?? candidate.coverUrl,
    externalId: candidate.externalId,
    source: candidate.source,
    kind: candidate.kind,
  };
}

/** Record enrichment work. Idempotent on (source, external_ref). */
export async function enqueueEnrichment(requests: EnrichmentRequest[]): Promise<number> {
  const rows = requests.filter((request) => request.externalRef && request.source);
  if (rows.length === 0) return 0;
  const db = getDb();
  const inserted = await db
    .insert(catalogEnrichmentQueue)
    .values(
      rows.map((row) => ({
        externalRef: row.externalRef,
        source: row.source,
        kind: row.kind,
        payload: row.payload,
      })),
    )
    // A row that already exists and already failed gets another chance: a new
    // search is a signal that someone wants this title.
    .onConflictDoUpdate({
      target: [catalogEnrichmentQueue.source, catalogEnrichmentQueue.externalRef],
      set: {
        status: "pending",
        nextAttemptAt: sql`now()`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${catalogEnrichmentQueue.status} = 'failed'`,
    })
    .returning({ id: catalogEnrichmentQueue.id });
  return inserted.length;
}

/** How many rows are waiting, for the operator view / health endpoint. */
export async function enrichmentBacklog(): Promise<{ pending: number; failed: number }> {
  const db = getDb();
  const [row] = await db
    .select({
      pending: sql<number>`count(*) filter (where status = 'pending')::int`,
      failed: sql<number>`count(*) filter (where status = 'failed')::int`,
    })
    .from(catalogEnrichmentQueue);
  return { pending: row?.pending ?? 0, failed: row?.failed ?? 0 };
}
