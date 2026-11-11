"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Hide one review from the For-you feed, then refresh the server-rendered list. */
export function DismissButton({ ratingId }: { ratingId: string }) {
  const router = useRouter();
  const [hidden, setHidden] = useState(false);
  const [busy, setBusy] = useState(false);

  if (hidden) return null;

  async function dismiss() {
    setBusy(true);
    try {
      const response = await fetch("/api/feed/dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ratingId }),
      });
      if (response.ok) {
        setHidden(true);
        router.refresh();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={dismiss}
      disabled={busy}
      aria-label="Dismiss this recommendation"
      className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] text-muted-2 transition-colors hover:text-ink disabled:opacity-40"
    >
      {busy ? "Dismissing…" : "Dismiss"}
    </button>
  );
}
