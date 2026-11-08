"use client";

import { useState } from "react";
import { Icon } from "@/components/podiums";

export function ShareButton({ title, path }: { title: string; path: string }) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}${path}`;
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
    <span className="relative">
      <button
        type="button"
        onClick={share}
        className="inline-flex h-9 items-center gap-1.5 rounded-full border border-white/12 bg-white/[0.05] px-3 text-[12px] font-medium text-ink transition-colors hover:bg-white/10"
      >
        <Icon name="share" className="h-4 w-4" />
        Share
      </button>
      {copied ? (
        <span className="absolute -top-8 left-0 whitespace-nowrap rounded-md bg-white px-2 py-1 text-[10px] font-medium text-black">
          Link copied
        </span>
      ) : null}
    </span>
  );
}