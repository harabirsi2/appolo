"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { ModerationAction } from "@/lib/moderation-constants";

/** Hide/remove/dismiss controls for one report in the moderator queue. */
export function ModerationActions({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<ModerationAction | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(action: ModerationAction) {
    setPending(action);
    setError(null);
    try {
      const response = await fetch(`/api/moderation/reports/${reportId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(data.error ?? "Could not apply that action.");
        return;
      }
      router.refresh();
    } catch {
      setError("Could not apply that action. Check your connection.");
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => act("hide")}
        className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] text-ink hover:border-white/30 disabled:opacity-60"
      >
        {pending === "hide" ? "Hiding…" : "Hide"}
      </button>
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => act("remove")}
        className="rounded-full border border-danger/40 bg-danger/10 px-3 py-1 text-[11px] text-danger hover:bg-danger/20 disabled:opacity-60"
      >
        {pending === "remove" ? "Removing…" : "Remove"}
      </button>
      <button
        type="button"
        disabled={pending !== null}
        onClick={() => act("dismiss")}
        className="rounded-full px-3 py-1 text-[11px] text-muted-2 hover:text-ink disabled:opacity-60"
      >
        {pending === "dismiss" ? "Dismissing…" : "Dismiss"}
      </button>
      {error ? (
        <span className="text-[11px] text-danger" role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}
