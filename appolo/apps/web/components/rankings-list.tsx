"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { MediaKind } from "@appolo/core/ranking";
import { cn } from "@appolo/ui";
import { MediaArt } from "./media-art";
import { ScoreText } from "./podiums";

export interface RankingsListEntry {
  id: string;
  kind: MediaKind;
  title: string;
  subtitle: string;
  year: number | null;
  genres: string[];
  score: number;
  bandLabel: string;
  fitText: string | null;
}

/**
 * The rankings list with an explicit manual order. Reordering saves the whole
 * list in one request, which the server stores as positions plus audit events —
 * never as fake matchups — and the statistical model keeps its own order.
 */
export function RankingsList({ kind, items }: { kind: MediaKind | null; items: RankingsListEntry[] }) {
  const router = useRouter();
  const [order, setOrder] = useState(items);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dragFrom = useRef<number | null>(null);

  const canReorder = kind !== null && items.length > 1;

  async function save(next: RankingsListEntry[]) {
    if (!kind) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/rankings/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, itemIds: next.map((entry) => entry.id) }),
      });
      if (!response.ok) {
        setOrder(items);
        setMessage("Could not save that order.");
        return;
      }
      setOrder(next);
      setMessage("Order saved.");
      router.refresh();
    } catch {
      setOrder(items);
      setMessage("Network error — order not saved.");
    } finally {
      setBusy(false);
    }
  }

  function move(from: number, to: number) {
    if (busy || from === to || to < 0 || to >= order.length) return;
    const next = [...order];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved!);
    setOrder(next);
    void save(next);
  }

  function toggleEditing() {
    setEditing((current) => !current);
    setOrder(items);
    setMessage(null);
  }

  if (order.length === 0) {
    return (
      <p className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">
        Nothing ranked in this category yet.
      </p>
    );
  }

  return (
    <div className="mt-4 pb-10">
      {canReorder ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted-2">
            {editing ? "Drag a title, or use the arrows, then done." : "Your saved order overrides the model order."}
          </p>
          <button
            type="button"
            onClick={toggleEditing}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-[11px] text-muted transition-colors hover:text-ink disabled:opacity-40"
            disabled={busy}
          >
            {editing ? "Done" : "Reorder"}
          </button>
        </div>
      ) : null}
      {message ? <p className="mt-2 text-[11px] text-muted-2">{message}</p> : null}

      <ol className="mt-4 space-y-2">
        {order.map((item, index) => {
          const inner = (
            <>
              <span className="grid w-6 shrink-0 place-items-center text-[16px] font-extrabold text-white/25">
                {index + 1}
              </span>
              <MediaArt kind={item.kind} title={item.title} genres={item.genres} sizes="48px" className="h-12 w-12 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">{item.title}</p>
                <p className="truncate text-[11px] text-muted-2">
                  {item.subtitle || item.kind}
                  {item.year ? ` · ${item.year}` : ""} · {item.bandLabel}
                </p>
                {item.fitText ? <p className="truncate text-[10px] text-muted-2">{item.fitText}</p> : null}
              </div>
              <ScoreText score={item.score} className="text-[15px]" />
            </>
          );

          return (
            <li
              key={item.id}
              draggable={editing}
              onDragStart={() => {
                dragFrom.current = index;
              }}
              onDragOver={(event) => {
                if (editing) event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const from = dragFrom.current;
                dragFrom.current = null;
                if (from !== null) move(from, index);
              }}
              onDragEnd={() => {
                dragFrom.current = null;
              }}
              className={cn(
                "rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5 transition-colors",
                editing ? "cursor-grab active:cursor-grabbing" : "hover:border-white/15",
              )}
            >
              {editing ? (
                <div className="flex items-center gap-3">
                  <span aria-hidden className="grid w-3 shrink-0 place-items-center text-[15px] text-white/30">
                    ⠿
                  </span>
                  {inner}
                  <div className="flex shrink-0 flex-col gap-1">
                    <button
                      type="button"
                      aria-label={`Move ${item.title} up`}
                      onClick={() => move(index, index - 1)}
                      disabled={index === 0 || busy}
                      className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-muted disabled:opacity-30"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${item.title} down`}
                      onClick={() => move(index, index + 1)}
                      disabled={index === order.length - 1 || busy}
                      className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-muted disabled:opacity-30"
                    >
                      ↓
                    </button>
                  </div>
                </div>
              ) : (
                <Link href={`/app/item/${item.id}`} className="flex items-center gap-3">
                  {inner}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
