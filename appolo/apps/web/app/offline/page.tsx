import type { Metadata } from "next";
import Link from "next/link";
import { pageMetadata } from "@/lib/seo";

export const metadata: Metadata = pageMetadata({
  title: "Offline",
  description: "You are offline. Your votes are saved and will sync when you reconnect.",
  path: "/offline",
  noindex: true,
});

/**
 * Served by the service worker when a navigation fails, so this page must not
 * depend on the database, the session or any client JavaScript: it is
 * precached at install time and rendered straight from the shell cache.
 */
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-[100dvh] w-full max-w-[560px] flex-col items-center justify-center gap-6 px-6 text-center">
      <div className="rounded-full border border-border bg-surface px-4 py-1.5 text-xs font-medium uppercase tracking-[0.14em] text-muted">
        Offline
      </div>
      <h1 className="font-display text-3xl font-semibold tracking-tight text-ink">
        No connection
      </h1>
      <p className="max-w-[38ch] text-sm leading-relaxed text-muted">
        Anything you voted on is saved on this device and will sync the moment you are back
        online. Nothing you tapped has been lost.
      </p>
      <Link
        href="/app/rate"
        className="rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-black"
      >
        Try the duel again
      </Link>
    </main>
  );
}
