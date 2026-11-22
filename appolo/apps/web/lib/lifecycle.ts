import { logEvent } from "./observability";

/**
 * Graceful shutdown for the web process.
 *
 * Next answers in-flight requests on SIGTERM, so the interesting part is not the
 * HTTP server: it is the in-memory work that a restart silently drops. Today
 * that is the coalesced ranking rebuild (a 750 ms timer). The database case is
 * safe by construction — `getRankingModel` refits when the stored model's
 * comparison count disagrees with the durable matchup log — but refitting on the
 * first request after a deploy is a latency spike for a user, so we drain here.
 *
 * This is registered from `instrumentation.ts`, which runs once per server
 * process in the Node runtime (never in the edge runtime).
 */
const GLOBAL_KEY = "__appoloLifecycleInstalled";

interface LifecycleGlobal {
  [GLOBAL_KEY]?: boolean;
}

export function installLifecycle(): void {
  const holder = globalThis as unknown as LifecycleGlobal;
  if (holder[GLOBAL_KEY]) return;
  holder[GLOBAL_KEY] = true;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    logEvent("info", "shutdown_started", { signal });
    try {
      const { flushRankingRefreshes } = await import("./services/ranking-math");
      const flushed = await flushRankingRefreshes();
      logEvent("info", "shutdown_drained", { signal, rankingRefreshes: flushed });
    } catch (error) {
      // Never block exit on a drain failure; the durable log is the source of
      // truth and a later request rebuilds from it.
      logEvent("error", "shutdown_drain_failed", {
        signal,
        error: error instanceof Error ? error.message : String(error),
      });
    }
    // Do not exit immediately: `next start` has no server-close hook, so any
    // request already being rendered would be cut off mid-response. Give them
    // a bounded grace period (SHUTDOWN_GRACE_MS, default 5s), which must stay
    // below the platform's own kill timeout — SIGKILL is the real backstop.
    const grace = Number(process.env.SHUTDOWN_GRACE_MS ?? 5000);
    setTimeout(() => process.exit(0), Number.isFinite(grace) && grace > 0 ? grace : 5000);
  };

  process.once("SIGTERM", (signal) => void shutdown(signal));
  process.once("SIGINT", (signal) => void shutdown(signal));
}
