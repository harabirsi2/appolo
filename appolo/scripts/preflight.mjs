#!/usr/bin/env node
/**
 * Checks that the app and its database are reachable before the e2e and visual
 * suites run. The health endpoint runs a database query, so a 200 means both
 * the server and Postgres are up.
 *
 * Usage:
 *   pnpm preflight
 *   pnpm verify     # runs this first
 *
 * BASE_URL and PREFLIGHT_TIMEOUT_MS override the defaults.
 */
const BASE = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.PREFLIGHT_TIMEOUT_MS ?? 10_000);

try {
  const response = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const body = await response.json().catch(() => null);

  if (!response.ok || !body?.ok) {
    console.error(
      `App is not ready at ${BASE}: health returned ${response.status}` +
        (body ? ` (database ${body.database})` : ""),
    );
    console.error("Start Postgres and the web app, then retry: pnpm dev:web");
    process.exit(1);
  }

  console.log(`App ready at ${BASE} (database up, ${body.latencyMs} ms).`);
} catch (error) {
  console.error(`Cannot reach ${BASE}/api/health: ${error instanceof Error ? error.message : String(error)}`);
  console.error("Start the dev server first: pnpm dev");
  process.exit(1);
}
