"use client";

import { useState } from "react";

export function WatchlistButton({ itemId, initial }: { itemId: string; initial: boolean }) {
  const [watching, setWatching] = useState(initial);
  const [pending, setPending] = useState(false);

  async function toggle() {
    if (pending) return;
    setPending(true);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (res.ok) {
        const data = (await res.json()) as { watching: boolean };
        setWatching(data.watching);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors ${
        watching
          ? "border-brand/40 bg-brand/15 text-brand"
          : "border-white/15 bg-white/[0.06] text-ink hover:bg-white/10"
      }`}
    >
      {watching ? "✓ Watchlist" : "+ Watchlist"}
    </button>
  );
}