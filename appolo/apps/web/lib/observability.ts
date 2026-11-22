import type { NextRequest } from "next/server";

/**
 * Structured logging and error reporting.
 *
 * Everything goes to stdout as one JSON object per line, because every host
 * worth using (Docker, Fly, Railway, systemd → journald) already ships stdout
 * somewhere and greps it better than a bespoke log table would. The request id
 * is the join key: it is on every line for a request, echoed back to the client
 * in `x-request-id`, and is the only thing you need to correlate a user's
 * "it failed" screenshot with what the server did.
 *
 * Error reporting is a direct POST to a Sentry project when `SENTRY_DSN` is
 * set, and a silent no-op otherwise. A solo project does not need the SDK's
 * bundler integration (source maps, breadcrumbs, performance tracing) to answer
 * "did something break in production tonight", and skipping it keeps the edge
 * and cold-start bundles clean. See docs/OPS.md for the upgrade path.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogFields {
  [key: string]: unknown;
}

const REDACTED = new Set([
  "password",
  "token",
  "secret",
  "authorization",
  "cookie",
  "session",
  "apikey",
  "api_key",
]);

/** Log an event. Never throws and never blocks the response. */
export function logEvent(level: LogLevel, event: string, fields: LogFields = {}): void {
  const line: LogFields = { ts: new Date().toISOString(), level, event };
  for (const [key, value] of Object.entries(fields)) {
    line[REDACTED.has(key.toLowerCase()) ? `${key}_redacted` : key] = value;
  }
  try {
    process.stdout.write(`${JSON.stringify(line)}\n`);
  } catch {
    /* stdout closed during shutdown: dropping a log line must not crash a request */
  }
}

const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Accept an upstream id (a load balancer or a client retry already has one) or
 * mint a UUID. Anything else is replaced: the id ends up in logs and headers,
 * so it must be a safe token, not an arbitrary string.
 */
export function requestIdFrom(headerValue: string | null | undefined): string {
  return headerValue && REQUEST_ID.test(headerValue) ? headerValue : crypto.randomUUID();
}

export interface RequestLogFields {
  /** Route name, so one line is enough to tell which handler was slow. */
  name?: string;
  requestId: string;
  method: string;
  path: string;
  status: number;
  durationMs: number;
  orgId?: string | null;
  error?: string;
}

/**
 * Wrap a route handler so every call logs exactly one completion line with its
 * status and duration, and still rethrows/propagates whatever it returns.
 *
 * Middleware cannot measure this: it hands the request off without waiting for
 * the render. Durations have to come from the handler itself.
 */
export function withRequestLog<Args extends unknown[]>(
  name: string,
  handler: (request: NextRequest, ...args: Args) => Promise<Response>,
): (request: NextRequest, ...args: Args) => Promise<Response> {
  return async (request: NextRequest, ...args: Args): Promise<Response> => {
    const started = Date.now();
    const requestId = requestIdFrom(request.headers.get("x-request-id"));
    const path = new URL(request.url).pathname;
    try {
      const response = await handler(request, ...args);
      response.headers.set("x-request-id", requestId);
      logEvent(response.status >= 500 ? "error" : "info", "request", {
        name,
        requestId,
        method: request.method,
        path,
        status: response.status,
        durationMs: Date.now() - started,
      } satisfies RequestLogFields);
      return response;
    } catch (error) {
      logEvent("error", "request_failed", {
        name,
        requestId,
        method: request.method,
        path,
        status: 500,
        durationMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      } satisfies RequestLogFields);
      throw error;
    }
  };
}

interface SentryTarget {
  storeUrl: string;
  key: string;
  environment: string;
  release: string | null;
}

/** Parse a DSN (`https://key@host/projectId`) into the store endpoint. */
function sentryTarget(): SentryTarget | null {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return null;
  try {
    const url = new URL(dsn);
    const projectId = url.pathname.replace(/^\//, "");
    const key = url.username;
    if (!projectId || !key) return null;
    return {
      storeUrl: `${url.protocol}//${url.host}/api/${projectId}/store/`,
      key,
      environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
      release: process.env.SENTRY_RELEASE?.trim() || null,
    };
  } catch {
    return null;
  }
}

export function errorReportingEnabled(): boolean {
  return sentryTarget() !== null;
}

/**
 * Report an exception. Fire-and-forget with a short timeout: an error reporter
 * that can hang a request or throw is worse than none.
 */
export async function captureException(error: unknown, context: LogFields = {}): Promise<void> {
  const target = sentryTarget();
  const normalized = error instanceof Error ? error : new Error(String(error));

  logEvent("error", "exception", {
    message: normalized.message,
    name: normalized.name,
    ...context,
  });

  if (!target) return;

  const event = {
    event_id: crypto.randomUUID().replace(/-/g, ""),
    timestamp: new Date().toISOString(),
    platform: "node",
    level: "error",
    logger: "appolo",
    environment: target.environment,
    release: target.release ?? undefined,
    exception: {
      values: [
        {
          type: normalized.name,
          value: normalized.message,
          stacktrace: normalized.stack
            ? { frames: normalized.stack.split("\n").slice(1, 20).map((line) => ({ filename: line.trim() })) }
            : undefined,
        },
      ],
    },
    tags: Object.fromEntries(
      Object.entries(context)
        .filter(([, value]) => typeof value === "string" || typeof value === "number")
        .map(([key, value]) => [key, String(value)]),
    ),
    extra: context,
  };

  try {
    await fetch(target.storeUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sentry-auth": [
          "Sentry sentry_version=7",
          `sentry_key=${target.key}`,
          "sentry_client=appolo/1.0",
        ].join(", "),
      },
      body: JSON.stringify(event),
      signal: AbortSignal.timeout(2000),
    });
  } catch {
    /* reporting is best-effort: the log line above already carries the error */
  }
}
