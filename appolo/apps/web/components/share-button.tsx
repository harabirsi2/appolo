"use client";

import { useState } from "react";
import { Icon } from "@/components/podiums";

/**
 * Share a page.
 *
 * On mobile it uses the native share sheet; when an `imagePath` card exists and
 * the browser can share files, the card is attached. Everywhere else it copies
 * the link and offers the card as a PNG download.
 */
export function ShareButton({
  title,
  path,
  imagePath,
}: {
  title: string;
  path: string;
  /** Optional PNG card, e.g. `/api/og/podium/ava`. */
  imagePath?: string;
}) {
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = `${window.location.origin}${path}`;
    if (navigator.share) {
      try {
        if (imagePath && navigator.canShare) {
          try {
            const response = await fetch(imagePath);
            const blob = await response.blob();
            const file = new File([blob], "appolo.png", { type: blob.type || "image/png" });
            if (navigator.canShare({ files: [file] })) {
              await navigator.share({ title, text: title, files: [file] });
              return;
            }
          } catch {
            // Fall through to a link-only share.
          }
        }
        await navigator.share({ title, url });
        return;
      } catch {
        // User cancelled or sharing is unavailable; fall back to copying.
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 4000);
    } catch {
      // Clipboard blocked; nothing else to do silently.
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
        <span className="absolute left-0 top-10 z-20 flex items-center gap-2 whitespace-nowrap rounded-md bg-white px-2 py-1 text-[10px] font-medium text-black shadow-lg">
          Link copied
          {imagePath ? (
            <a href={imagePath} download="appolo.png" className="rounded bg-black/10 px-1.5 py-0.5 text-[10px] font-semibold text-black">
              Save image
            </a>
          ) : null}
        </span>
      ) : null}
    </span>
  );
}