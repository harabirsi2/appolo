import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";
import { Queue, Worker, type Job } from "bullmq";
import type IORedis from "ioredis";
import { loadMetadataDetails, type MetadataCandidate, type MetadataSource } from "@appolo/core";

/**
 * Catalog enrichment pipeline.
 *
 *   search ──▶ catalog_items(enrichment_status='pending')  ──┐
 *              catalog_enrichment_queue(pending)            │ durable outbox
 *                                                            ▼
 *                              sweeper (30s) ──▶ BullMQ job ──▶ processor
 *                                                            │
 *                    provider details + cover download ──────┤
 *                                                            ▼
 *                    catalog_items(enrichment_status='ready')
 *
 * BullMQ gives concurrency, a per-minute limiter and visibility; the Postgres
 * table gives durability, so a lost job is simply re-swept on the next tick.
 */
export const CATALOG_QUEUE = "catalog-enrichment";

const MAX_ATTEMPTS = Number(process.env.CATALOG_MAX_ATTEMPTS ?? 6);
const REQ_PER_MIN = clampInt(process.env.CATALOG_WORKER_REQ_PER_MIN, 60, 1, 600);
const CACHE_DIR = process.env.CATALOG_CACHE_DIR?.trim() || path.resolve(process.cwd(), "public", "cache", "covers");
const CACHE_PUBLIC_PATH = (process.env.CATALOG_CACHE_PUBLIC_PATH?.trim() || "/cache/covers").replace(/\/$/, "");
const SWEEP_MS = 30_000;
const STUCK_MS = 15 * 60_000;

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const value = Number(raw ?? "");
  return Number.isFinite(value) && value >= min && value <= max ? Math.floor(value) : fallback;
}

interface QueueRow {
  id: string;
  external_ref: string;
  source: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
}

interface ItemRow {
  id: string;
  title: string;
  subtitle: string;
  year: number | null;
  image_url: string | null;
  metadata: Record<string, unknown>;
  source: string | null;
  external_id: string | null;
}

function metadataConfig() {
  const enabled = (process.env.CATALOG_PROVIDERS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean) as MetadataSource[];
  return {
    enabled: enabled.length ? enabled : undefined,
    tmdbApiKey: process.env.TMDB_API_KEY?.trim() || undefined,
    rawgApiKey: process.env.RAWG_API_KEY?.trim() || undefined,
    timeoutMs: 6_000,
  };
}

/**
 * Download a provider image once and serve it from our own path.
 *
 * Provider URLs are hotlinked on first insert (fast, no write), then swapped
 * here so a hotlink that rots does not leave a dead cover. No transcode: the
 * bytes are stored as-is under a content hash, which also dedupes the same
 * artwork across rows.
 */
async function cacheCover(url: string | null | undefined): Promise<string | null> {
  if (!url || !url.startsWith("https://")) return null;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > 8_000_000) return null;
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, `${hash}.${ext}`), bytes);
    return `${CACHE_PUBLIC_PATH}/${hash}.${ext}`;
  } catch {
    return null;
  }
}

function backoffSeconds(attempts: number): number {
  return Math.min(3_600, 30 * 2 ** Math.max(0, attempts));
}

/** Mark the row done, or schedule a retry with exponential backoff. */
async function settle(sql: postgres.Sql, row: QueueRow, error?: unknown): Promise<void> {
  if (!error) {
    await sql`update public.catalog_enrichment_queue
                  set status = 'done', attempts = attempts + 1, last_error = null,
                      locked_at = null, updated_at = now()
                where id = ${row.id}`;
    return;
  }
  const attempts = row.attempts + 1;
  const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
  const dead = attempts >= MAX_ATTEMPTS;
  await sql`update public.catalog_enrichment_queue
                set status = ${dead ? "failed" : "pending"}, attempts = ${attempts},
                    last_error = ${message}, locked_at = null,
                    next_attempt_at = now() + (${backoffSeconds(attempts)} * interval '1 second'),
                    updated_at = now()
              where id = ${row.id}`;
  // The catalog row stays 'pending' on a retryable failure and flips to
  // 'failed' once we stop trying, so the UI can stop showing a spinner.
  if (dead) {
    await sql`update public.catalog_items set enrichment_status = 'failed'
                where source = ${row.source} and external_ref = ${row.external_ref}`;
  }
}

async function processOne(sql: postgres.Sql, queueId: string): Promise<"done" | "skipped"> {
  // Claim atomically: only one worker wins, and only if the backoff has passed.
  const claimed = await sql<QueueRow[]>`
    update public.catalog_enrichment_queue
       set status = 'processing', locked_at = now(), updated_at = now()
     where id = ${queueId}
       and status in ('pending', 'failed')
       and next_attempt_at <= now()
       and attempts < ${MAX_ATTEMPTS}
    returning id, external_ref, source, kind, payload, attempts`;
  const row = claimed[0];
  if (!row) return "skipped";

  try {
    const [item] = await sql<ItemRow[]>`
      select id, title, subtitle, year, image_url, metadata, source, external_id
        from public.catalog_items
       where source = ${row.source} and external_ref = ${row.external_ref}
       limit 1`;
    if (!item) {
      await settle(sql, row);
      return "done";
    }

    const payload = row.payload ?? {};
    const candidate: MetadataCandidate = {
      kind: row.kind as MetadataCandidate["kind"],
      title: String(payload.title ?? item.title),
      subtitle: String(payload.subtitle ?? item.subtitle ?? ""),
      year: typeof payload.year === "number" ? payload.year : item.year,
      imageUrl: (payload.imageUrl as string | null) ?? item.image_url,
      coverUrl: (payload.imageUrl as string | null) ?? item.image_url,
      backdropUrl: null,
      description: null,
      genres: [],
      trailerUrl: null,
      externalRef: row.external_ref,
      externalId: String(payload.externalId ?? item.external_id ?? ""),
      source: row.source as MetadataCandidate["source"],
      metadata: {},
    };

    const details = await loadMetadataDetails(candidate, metadataConfig());
    const cached = await cacheCover(details.backdropUrl ?? candidate.imageUrl);

    // jsonb || jsonb merges keys; existing app-written metadata wins on conflict
    // only where the provider has nothing to say, which is handled by coalesce.
    await sql`
      update public.catalog_items
         set description = coalesce(${details.description ?? null}, description),
             cover_url = coalesce(${cached}, cover_url, image_url),
             image_url = coalesce(${cached}, image_url),
             backdrop_url = coalesce(${details.backdropUrl ?? null}, backdrop_url),
             trailer_url = coalesce(${details.trailerUrl ?? null}, trailer_url),
             metadata = metadata || ${sql.json((details.metadata ?? {}) as never)}::jsonb,
             enrichment_status = 'ready'
       where id = ${item.id}`;

    await settle(sql, row);
    return "done";
  } catch (error) {
    await settle(sql, row, error);
    return "done";
  }
}

async function sweep(sql: postgres.Sql, queue: Queue): Promise<void> {
  // A worker that died mid-job leaves the row 'processing'; take it back.
  await sql`update public.catalog_enrichment_queue
               set status = 'pending', locked_at = null, updated_at = now()
             where status = 'processing' and locked_at < now() - ${`${STUCK_MS} milliseconds`}::interval`;

  const due = await sql<{ id: string }[]>`
    select id from public.catalog_enrichment_queue
     where status = 'pending'
       and next_attempt_at <= now()
       and attempts < ${MAX_ATTEMPTS}
     order by next_attempt_at
     limit 100`;

  for (const { id } of due) {
    // jobId dedupes: the same queue row is never queued twice.
    await queue.add("enrich", { queueId: id }, { jobId: id, removeOnComplete: true, removeOnFail: true });
  }
}

export interface CatalogPipeline {
  queue: Queue;
  worker: Worker;
  stop: () => Promise<void>;
}

export function startCatalogPipeline(connection: IORedis, databaseUrl: string): CatalogPipeline {
  const sql = postgres(databaseUrl, { max: 4, idle_timeout: 30 });
  const queue = new Queue(CATALOG_QUEUE, { connection });
  const worker = new Worker<{ queueId: string }>(
    CATALOG_QUEUE,
    async (job: Job<{ queueId: string }>) => processOne(sql, job.data.queueId),
    {
      connection,
      concurrency: 3,
      // Shared provider quota: never exceed N calls per rolling minute.
      limiter: { max: REQ_PER_MIN, duration: 60_000 },
    },
  );

  worker.on("failed", (job, err) =>
    console.error(`[worker] catalog job ${job?.id} threw:`, err.message),
  );
  worker.on("error", (err) => console.error("[worker] catalog worker error:", err.message));

  const timer = setInterval(() => {
    void sweep(sql, queue).catch((err) => console.error("[worker] catalog sweep failed:", err.message));
  }, SWEEP_MS);
  void sweep(sql, queue).catch(() => {});

  return {
    queue,
    worker,
    stop: async () => {
      clearInterval(timer);
      await worker.close();
      await queue.close();
      await sql.end({ timeout: 5 });
    },
  };
}
