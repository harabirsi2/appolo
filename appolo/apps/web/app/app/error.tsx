"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@appolo/ui";

/**
 * Error boundary for the signed-in app shell. It renders inside `app/app`, so
 * the navigation chrome survives and the person can move somewhere else
 * instead of being stuck on a dead page.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("[app] render error", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="px-5 pt-10">
      <div className="rounded-2xl border border-border bg-surface p-6">
        <h1 className="text-base font-semibold text-ink">That screen could not load</h1>
        <p className="mt-2 text-sm text-muted">
          Nothing you saved was lost. Retry, or head back to the home feed.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-muted-2">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-5 flex items-center gap-2">
          <Button size="sm" onClick={reset}>
            Try again
          </Button>
          <Link
            href="/app"
            className="inline-flex h-8 items-center rounded-lg border border-border bg-surface-2 px-3 text-xs font-medium text-ink hover:border-border-strong"
          >
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}
