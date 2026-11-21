"use client";

import { useEffect } from "react";
import Link from "next/link";
import { Button } from "@appolo/ui";

/**
 * Root error boundary. Anything that throws while rendering a page below the
 * root layout lands here instead of a bare Next error page; the layout, fonts
 * and design tokens are still available, so the screen stays on-brand.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Digest is the only thing correlating the client error with the server log.
    console.error("[app] render error", error.digest ?? "", error);
  }, [error]);

  return (
    <main className="flex min-h-screen items-center justify-center px-5 py-12">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-6 text-center">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl bg-danger/15 text-xl font-black text-danger">
          !
        </div>
        <h1 className="mt-4 text-lg font-semibold text-ink">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">
          This page hit an unexpected error. Trying again usually fixes it; if it keeps happening, come back in a
          minute.
        </p>
        {error.digest ? (
          <p className="mt-3 font-mono text-[11px] text-muted-2">Reference: {error.digest}</p>
        ) : null}
        <div className="mt-6 flex items-center justify-center gap-2">
          <Button onClick={reset}>Try again</Button>
          <Link
            href="/"
            className="inline-flex h-10 items-center rounded-lg border border-border bg-surface-2 px-4 text-sm font-medium text-ink hover:border-border-strong"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}
