"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { MEDIA_KIND_LABELS, type MediaKind } from "@appolo/core/ranking";
import { cn } from "@appolo/ui";

interface Option {
  kind: MediaKind;
  genres: string[];
}

const keyOf = (kind: MediaKind, genre: string): string => `${kind}:${genre.toLowerCase()}`;

/**
 * Interest chips grouped by media kind. Saving replaces the stored interests;
 * the onboarding page then offers a starter title from those genres.
 */
export function InterestPicker({
  options,
  initial,
}: {
  options: Option[];
  initial: Array<{ kind: MediaKind; genre: string }>;
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(initial.map((pick) => keyOf(pick.kind, pick.genre))),
  );
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function toggle(kind: MediaKind, genre: string) {
    setSelected((current) => {
      const next = new Set(current);
      const key = keyOf(kind, genre);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
    setMessage(null);
  }

  async function save() {
    const picks = [...selected].map((entry) => {
      const split = entry.indexOf(":");
      return { kind: entry.slice(0, split) as MediaKind, genre: entry.slice(split + 1) };
    });
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/onboarding/interests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ picks }),
      });
      if (!response.ok) {
        setMessage("Could not save those interests.");
        return;
      }
      setMessage("Saved — your first comparison is waiting below.");
      router.refresh();
    } catch {
      setMessage("Network error — interests were not saved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-6 space-y-5">
      {options.map((option) => (
        <section key={option.kind}>
          <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-muted-2">
            {MEDIA_KIND_LABELS[option.kind]}
          </h2>
          <div className="mt-2 flex flex-wrap gap-2">
            {option.genres.map((genre) => {
              const active = selected.has(keyOf(option.kind, genre));
              return (
                <button
                  key={genre}
                  type="button"
                  aria-pressed={active}
                  onClick={() => toggle(option.kind, genre)}
                  className={cn(
                    "rounded-full border px-3 py-1.5 text-xs transition-colors",
                    active
                      ? "border-brand/50 bg-brand/15 text-brand"
                      : "border-white/10 bg-white/5 text-muted hover:text-ink",
                  )}
                >
                  {genre}
                </button>
              );
            })}
          </div>
        </section>
      ))}

      <div className="flex flex-wrap items-center gap-3 border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-full bg-brand px-4 py-2 text-sm font-semibold text-black disabled:opacity-40"
        >
          {busy ? "Saving…" : "Save interests"}
        </button>
        <span className="text-[11px] text-muted-2">
          {selected.size === 0 ? "Pick a few genres" : `${selected.size} picked`}
        </span>
        {message ? <span className="text-[11px] text-brand">{message}</span> : null}
      </div>
    </div>
  );
}
