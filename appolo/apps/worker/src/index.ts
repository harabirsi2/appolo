import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import IORedis from "ioredis";
import { Queue, Worker, type Job } from "bullmq";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..", "..", "..");
for (const candidate of [path.join(root, ".env"), path.join(root, "..", ".env")]) {
  if (existsSync(candidate)) {
    process.loadEnvFile(candidate);
    break;
  }
}

const REDIS_URL = process.env.REDIS_URL?.trim();
const QUEUE_NAME = "system";

interface HeartbeatResult {
  at: string;
  pid: number;
}

async function main(): Promise<void> {
  if (!REDIS_URL) {
    console.log("[worker] REDIS_URL is empty — queue processing is disabled.");
    console.log("[worker] Phase 0 does not need queues. Set REDIS_URL to enable them.");
    // Stay alive so `pnpm dev` runs web and worker together without crashing.
    setInterval(() => {}, 1 << 30);
    return;
  }

  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  connection.on("error", (err) => console.error("[worker] redis error:", err.message));

  const queue = new Queue(QUEUE_NAME, { connection });

  const worker = new Worker<HeartbeatResult>(
    QUEUE_NAME,
    async (job: Job<HeartbeatResult>) => {
      if (job.name === "heartbeat") {
        return { at: new Date().toISOString(), pid: process.pid };
      }
      throw new Error(`unknown job: ${job.name}`);
    },
    { connection, concurrency: 4 },
  );

  worker.on("completed", (job) => console.log(`[worker] completed ${job.name}#${job.id}`));
  worker.on("failed", (job, err) => console.error(`[worker] failed ${job?.name}#${job?.id}:`, err.message));

  // Prove the loop works end to end once per boot.
  await queue.add("heartbeat", { at: new Date().toISOString(), pid: process.pid }, { removeOnComplete: 20 });
  console.log(`[worker] listening on "${QUEUE_NAME}"`);

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} — draining`);
    await worker.close();
    await queue.close();
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