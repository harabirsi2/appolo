"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/podiums";

export function ItemActions({ title, itemId }: { title: string; itemId: string }) {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    try {
      setSaved(window.localStorage.getItem(`appolo:saved:${itemId}`) === "1");
    } catch {
      // ignore storage failures
    }
  }, [itemId]);

  function toggleSaved() {
    const next = !saved;
    setSaved(next);
    try {
      if (next) window.localStorage.setItem(`appolo:saved:${itemId}`, "1");
      else window.localStorage.removeItem(`appolo:saved:${itemId}`);
    } catch {
      // ignore storage failures
    }
  }

  async function share() {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
        return;
      }
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // user cancelled
    }
  }

  return (
    <div className="mt-4 flex items-center gap-3">
      <button
        type="button"
        onClick={toggleSaved}
        aria-pressed={saved}
        aria-label={saved ? "Remove from saved" : "Save"}
        className={`grid h-10 w-10 place-items-center rounded-full border transition-colors ${
          saved ? "border-brand/40 bg-brand/15 text-brand" : "border-white/10 bg-white/[0.04] text-ink hover:bg-white/10"
        }`}
      >
        <Icon name="bookmark" className="h-[18px] w-[18px]" />
      </button>
      <button
        type="button"
        onClick={share}
        aria-label="Share"
        className="relative grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-ink transition-colors hover:bg-white/10"
      >
        <Icon name="share" className="h-[18px] w-[18px]" />
        {copied ? (
          <span className="absolute -top-8 whitespace-nowrap rounded-md bg-white px-2 py-1 text-[10px] font-medium text-black">
            Link copied
          </span>
        ) : null}
      </button>
    </div>
  );
}