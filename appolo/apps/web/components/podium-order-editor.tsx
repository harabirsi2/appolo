"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MediaKind } from "@appolo/core/ranking";

interface Entry {
  id: string;
  title: string;
}

/**
 * Reorder controls for a profile's own top five. Each move saves the full
 * order, so the podium stays honest even if the browser closes mid-edit.
 */
export function PodiumOrderEditor({ kind, items }: { kind: MediaKind; items: Entry[] }) {
  const router = useRouter();
  const [order, setOrder] = useState<Entry[]>(items);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= order.length || busy) return;
    const next = [...order];
    const moved = next[index]!;
    next[index] = next[target]!;
    next[target] = moved;
    setOrder(next);
    await save(next);
  }

  async function save(next: Entry[]) {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/profile/podium", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, itemIds: next.map((entry) => entry.id) }),
      });
      if (!response.ok) {
        setOrder(items);
        setMessage("Could not save that order.");
        return;
      }
      setMessage("Saved.");
      router.refresh();
    } catch {
      setOrder(items);
      setMessage("Network error — order not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
      <div className="flex items-center justify-between">
        <p className="text-[12px] font-medium text-ink">Curate your order</p>
        {message ? <p className="text-[10px] text-muted-2">{message}</p> : null}
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-2">
        Elo sets the score. This sets the story.
      </p>
      <ol className="mt-2 space-y-1.5">
        {order.map((entry, index) => (
          <li key={entry.id} className="flex items-center gap-2 rounded-lg bg-black/25 px-2 py-1.5">
            <span className="w-4 shrink-0 text-[12px] font-bold text-white/30">{index + 1}</span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{entry.title}</span>
            <button
              type="button"
              aria-label={`Move ${entry.title} up`}
              disabled={index === 0 || busy}
              onClick={() => move(index, -1)}
              className="grid h-6 w-6 place-items-center rounded-md border border-white/10 text-[11px] text-muted disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${entry.title} down`}
              disabled={index === order.length - 1 || busy}
              onClick={() => move(index, 1)}
              className="grid h-6 w-6 place-items-center rounded-md border border-white/10 text-[11px] text-muted disabled:opacity-30"
            >
              ↓
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
