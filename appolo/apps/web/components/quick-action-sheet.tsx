"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/podiums";

const ACTIONS = [
  { href: "/app/rate", label: "Rate something", icon: "plus" as const, tone: "brand" },
  { href: "/app/duel", label: "Start a duel", icon: "spark" as const, tone: "neutral" },
  { href: "/app/search", label: "Add media", icon: "search" as const, tone: "neutral" },
  { href: "/app/pods/new", label: "Create collection", icon: "grid" as const, tone: "neutral" },
  { href: "/app/reviews", label: "Write a review", icon: "share" as const, tone: "neutral" },
  { href: "/app/profile?tab=watchlist", label: "View watchlist", icon: "bookmark" as const, tone: "neutral" },
];

/**
 * Mobile quick-action sheet opened by the floating dock's center FAB.
 *
 * Replaces the old "link straight to /app/rate" behaviour with a real sheet
 * so every quick action is reachable from the thumb zone.
 */
export function QuickActionSheet() {
  const [open, setOpen] = useState(false);

  // The sheet is dismissable by pointer (backdrop, or any action link); Escape
  // is the keyboard path, so the backdrop handler below never strands anyone.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label="Quick actions"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="-mt-7 grid h-14 w-14 place-items-center rounded-full bg-gradient-to-b from-brand-soft to-brand text-black shadow-[0_10px_30px_-6px_rgba(16,185,129,0.55)] ring-4 ring-black transition-transform active:scale-95"
      >
        <Icon name="plus" className="h-7 w-7" />
      </button>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center">
          {/* Backdrop dismissal as a button: keyboard reachable and announced,
              instead of a div that only a pointer can dismiss. */}
          <button
            type="button"
            aria-label="Close quick actions"
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Quick actions"
            className="relative w-full max-w-[560px] rounded-t-3xl border-t border-white/[0.08] bg-[#111318] px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] pt-5"
          >
            <div className="mx-auto mb-4 h-1 w-10 rounded-full bg-white/20" />
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-2">Quick actions</p>
            <div className="mt-3 grid grid-cols-2 gap-2">
              {ACTIONS.map((action) => (
                <Link
                  key={action.href}
                  href={action.href}
                  onClick={() => setOpen(false)}
                  className={`flex min-h-12 items-center gap-3 rounded-2xl border px-3 text-[13px] font-medium transition-colors ${
                    action.tone === "brand"
                      ? "border-brand/30 bg-brand/10 text-brand hover:bg-brand/15"
                      : "border-white/[0.06] bg-white/[0.03] text-ink hover:bg-white/[0.06]"
                  }`}
                >
                  <Icon name={action.icon} className="h-5 w-5" />
                  {action.label}
                </Link>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="mt-4 w-full rounded-full border border-white/10 py-2.5 text-[13px] font-medium text-muted transition-colors hover:text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}