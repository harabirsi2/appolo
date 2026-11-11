import { NextResponse } from "next/server";
import { isDomainError } from "./services/errors";

export function apiError(error: unknown): NextResponse {
  if (isDomainError(error)) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }
  console.error("[api] unhandled error:", error);
  return NextResponse.json({ error: "Something went wrong." }, { status: 500 });
}

export function jsonError(message: string, status = 400, code?: string): NextResponse {
  return NextResponse.json(code ? { error: message, code } : { error: message }, { status });
}

/** 429 with the standard retry hint used by the credential endpoints. */
export function rateLimited(retryAfterSeconds: number): NextResponse {
  return NextResponse.json(
    {
      error: `Too many requests. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`,
      code: "RATE_LIMITED",
    },
    { status: 429, headers: { "retry-after": String(retryAfterSeconds) } },
  );
}

export function clientIpFrom(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return headers.get("x-real-ip");
}