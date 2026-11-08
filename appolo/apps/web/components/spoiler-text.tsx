"use client";

import { useState } from "react";

/** Renders a review body, keeping spoilers hidden until the reader opts in. */
export function SpoilerText({
  text,
  spoiler,
  className,
}: {
  text: string;
  spoiler: boolean;
  className?: string;
}) {
  const [revealed, setRevealed] = useState(!spoiler);

  if (revealed) {
    return <p className={className}>{text}</p>;
  }

  return (
    <button
      type="button"
      onClick={() => setRevealed(true)}
      className={`${className ?? ""} w-full rounded-xl border border-red-500/25 bg-red-500/[0.08] px-3 py-4 text-left text-[13px] text-red-200`}
    >
      <span className="mr-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-300">
        Spoiler
      </span>
      Tap to reveal this review.
    </button>
  );
}
