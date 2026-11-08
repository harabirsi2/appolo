"use client";

import { useState } from "react";

export function FollowButton({
  username,
  initialFollowing,
  className,
}: {
  username: string;
  initialFollowing: boolean;
  className?: string;
}) {
  const [following, setFollowing] = useState(initialFollowing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggle() {
    setBusy(true);
    setError(null);
    const next = !following;
    try {
      const response = await fetch("/api/follow", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username, follow: next }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not update follow.");
      }
      setFollowing(next);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={
          className ??
          `h-8 rounded-full px-3 text-xs font-semibold transition-colors disabled:opacity-50 ${
            following
              ? "border border-white/15 bg-transparent text-muted hover:text-ink"
              : "bg-brand text-black hover:bg-brand-strong"
          }`
        }
      >
        {following ? "Following" : "Follow"}
      </button>
      {error ? <span className="text-[10px] text-danger">{error}</span> : null}
    </span>
  );
}