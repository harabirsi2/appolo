import { sql } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { withRequestLog } from "@/lib/observability";

export const dynamic = "force-dynamic";

/** Three missed beats at 30s. Below this, a restart looks like an outage. */
const WORKER_STALE_SECONDS = 95;

interface WorkerState {
  status: "live" | "stale" | "unknown";
  lastSeenAt: string | null;
  ageSeconds: number | null;
}

/**
 * Health for the two things that can be dead independently: the database and
 * the worker.
 *
 * Returns 200 when the web app can serve requests, even if the worker is stale,
 * because ranking pages still work without it — marking the whole service down
 * for a wedged queue would take a healthy site offline. Pass `?strict=1` from an
 * uptime monitor to make worker staleness fail the check, and watch the body
 * instead if you want the distinction without the status code.
 */
async function health(request: NextRequest): Promise<NextResponse> {
  const started = Date.now();
  const strict = new URL(request.url).searchParams.get("strict") === "1";

  let database: "up" | "down" = "up";
  let databaseError: string | null = null;
  try {
    await getDb().execute(sql`select 1`);
  } catch (error) {
    database = "down";
    databaseError = error instanceof Error ? error.message : String(error);
  }

  let worker: WorkerState = { status: "unknown", lastSeenAt: null, ageSeconds: null };
  if (database === "up") {
    try {
      const rows = await getDb().execute<{ last_seen_at: Date; age_seconds: number }>(sql`
        select last_seen_at, extract(epoch from (now() - last_seen_at))::float as age_seconds
        from public.service_heartbeats
        where name = 'worker'
      `);
      const row = rows[0];
      if (row) {
        const ageSeconds = Math.round(Number(row.age_seconds));
        worker = {
          status: ageSeconds <= WORKER_STALE_SECONDS ? "live" : "stale",
          lastSeenAt: new Date(row.last_seen_at).toISOString(),
          ageSeconds,
        };
      }
    } catch (error) {
      // A missing table is a deploy that has not migrated yet: report it rather
      // than pretending the worker is fine.
      worker = { status: "unknown", lastSeenAt: null, ageSeconds: null };
      databaseError = databaseError ?? (error instanceof Error ? error.message : String(error));
    }
  }

  const healthy = database === "up" && (!strict || worker.status === "live");

  return NextResponse.json(
    {
      ok: healthy,
      service: "appolo-web",
      database,
      worker,
      ...(databaseError ? { detail: databaseError } : {}),
      latencyMs: Date.now() - started,
      time: new Date().toISOString(),
      // Lets a deploy be verified from outside: "is this the build I shipped?"
      release: process.env.SENTRY_RELEASE ?? process.env.GIT_SHA ?? null,
    },
    {
      status: healthy ? 200 : 503,
      headers: {
        "cache-control": "no-store",
        ...(strict ? {} : { "x-worker-status": worker.status }),
      },
    },
  );
}

export const GET = withRequestLog("health", health);
