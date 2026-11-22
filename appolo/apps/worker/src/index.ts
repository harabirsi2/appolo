import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import IORedis from "ioredis";
import { Queue, Worker, type Job } from "bullmq";
import { startCatalogPipeline, type CatalogPipeline } from "./catalog";
import { createPushSender, pushConfigured, type PushSender } from "./push";
import { startHeartbeat } from "./heartbeat";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
for (const candidate of [path.join(root, ".env"), path.join(root, "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const REDIS_URL = process.env.REDIS_URL?.trim();
const DATABASE_URL = process.env.DATABASE_URL?.trim();
const QUEUE_NAME = "system";

interface HeartbeatResult {
  at: string;
  pid: number;
}

async function main(): Promise<void> {
  // Start the heartbeat before anything can exit early: a worker with no queue
  // is still a process that should be visible in /api/health, and a worker that
  // dies during startup is exactly the failure the heartbeat exists to show.
  const stopHeartbeat = DATABASE_URL
    ? startHeartbeat(DATABASE_URL, { redis: Boolean(REDIS_URL) })
    : null;

  if (!REDIS_URL) {
    console.log("[worker] REDIS_URL is empty — queue processing is disabled.");
    console.log("[worker] Catalog enrichment falls back to the durable table; nothing is lost.");
    console.log("[worker] Set REDIS_URL to enable queue processing.");
    // Stay alive so `pnpm dev` runs web and worker together without crashing.
    setInterval(() => {}, 1 << 30);
    return;
  }

  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  connection.on("error", (err) => console.error("[worker] redis error:", err.message));

  const queue = new Queue(QUEUE_NAME, { connection });

  // Declared before the worker so a job that fires during startup sees `null`
  // instead of a temporal-dead-zone error.
  let push: PushSender | null = null;

  const worker = new Worker<unknown>(
    QUEUE_NAME,
    async (job: Job<unknown>) => {
      if (job.name === "heartbeat") {
        const result: HeartbeatResult = { at: new Date().toISOString(), pid: process.pid };
        return result;
      }
      // Push jobs are no-ops without VAPID keys; the subscriptions are already
      // stored, so enabling keys starts delivering on the next tick.
      if (job.name === "push-friend-activity") {
        return push ? { sent: await push.sendFriendActivity() } : { sent: 0, skipped: "no vapid keys" };
      }
      if (job.name === "push-weekly-digest") {
        return push ? { sent: await push.sendWeeklyDigest() } : { sent: 0, skipped: "no vapid keys" };
      }
      throw new Error(`unknown job: ${job.name}`);
    },
    { connection, concurrency: 4 },
  );

  worker.on("completed", (job) => console.log(`[worker] completed ${job.name}#${job.id}`));
  worker.on("failed", (job, err) => console.error(`[worker] failed ${job?.name}#${job?.id}:`, err.message));

  // Catalog enrichment: provider metadata, cover caching, exponential backoff.
  let catalog: CatalogPipeline | null = null;
  if (DATABASE_URL) {
    catalog = startCatalogPipeline(connection, DATABASE_URL);
    console.log("[worker] catalog enrichment pipeline started");
  } else {
    console.log("[worker] DATABASE_URL is empty — catalog enrichment is disabled.");
  }

  // Push. The friend-activity window and the repeat interval must stay equal:
  // a wider window would announce the same vote twice, a narrower one would
  // miss votes. The weekly digest rides the same queue on a cron pattern.
  if (DATABASE_URL && pushConfigured()) {
    push = createPushSender(DATABASE_URL);
    await queue.add(
      "push-friend-activity",
      {},
      { repeat: { every: 5 * 60_000 }, removeOnComplete: 20, removeOnFail: 20 },
    );
    await queue.add(
      "push-weekly-digest",
      {},
      { repeat: { pattern: "0 9 * * 1" }, removeOnComplete: 5, removeOnFail: 5 },
    );
    console.log("[worker] push delivery enabled (friend activity every 5m, digest Mondays 09:00)");
  } else if (DATABASE_URL) {
    console.log("[worker] PUSH_VAPID_* is empty — push jobs idle, subscriptions are still stored.");
  }

  // Prove the loop works end to end once per boot.
  await queue.add("heartbeat", { at: new Date().toISOString(), pid: process.pid }, { removeOnComplete: 20 });
  console.log(`[worker] listening on "${QUEUE_NAME}"`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} — draining`);
    // Order matters: stop accepting new work, finish in-flight jobs, then close
    // the things the finished jobs used. The heartbeat goes last so the process
    // is visible until it is actually gone.
    await worker.close();
    await catalog?.stop();
    await push?.close();
    await queue.close();
    stopHeartbeat?.();
    connection.disconnect();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[worker] fatal:", err);
  process.exit(1);
});
