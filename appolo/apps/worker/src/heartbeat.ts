import postgres from "postgres";

/**
 * Worker liveness.
 *
 * The worker is not an HTTP service, so there is nothing to curl. It upserts one
 * row every 30 seconds into `service_heartbeats` and the web app's /api/health
 * reports how fresh that row is. The cadence is the contract: /api/health calls
 * a worker stale after three missed beats, so changing one without the other
 * either pages you on every restart or hides a dead process.
 *
 * Runs even when Redis is unconfigured (the worker still exists, it just has no
 * queue), because "queue disabled" and "process gone" are different failures.
 */
const INTERVAL_MS = 30_000;

export function startHeartbeat(databaseUrl: string, detail: Record<string, unknown> = {}): () => void {
  const client = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  let stopped = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const beat = async (): Promise<void> => {
    if (stopped) return;
    try {
      await client`
        insert into public.service_heartbeats (name, last_seen_at, detail)
        values ('worker', now(), ${client.json({ pid: process.pid, ...detail })})
        on conflict (name) do update
          set last_seen_at = excluded.last_seen_at,
              detail = excluded.detail
      `;
    } catch (error) {
      // Keep trying: a database blip must not silently stop the heartbeat and
      // make a healthy worker look dead to /api/health.
      console.error("[worker] heartbeat failed:", error instanceof Error ? error.message : error);
    }
  };

  void beat();
  timer = setInterval(() => void beat(), INTERVAL_MS);

  return () => {
    stopped = true;
    if (timer) clearInterval(timer);
    void client.end({ timeout: 5 });
  };
}
