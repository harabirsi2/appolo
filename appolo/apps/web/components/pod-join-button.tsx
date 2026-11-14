"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Join or leave a collaborative pod as the signed-in profile. */
export function PodJoinButton({
  podId,
  joined,
  role,
}: {
  podId: string;
  joined: boolean;
  role?: "owner" | "editor" | "viewer" | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/pods/${podId}/members`, {
        method: joined ? "DELETE" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? (joined ? "Could not leave the pod." : "Could not join the pod."));
      }
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  if (role === "owner") {
    return <span className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] text-brand">Owner</span>;
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={act}
        disabled={busy}
        className={
          joined
            ? "rounded-full border border-white/15 px-3 py-1.5 text-[12px] font-medium text-muted hover:text-ink disabled:opacity-60"
            : "rounded-full bg-white px-3 py-1.5 text-[12px] font-semibold text-black disabled:opacity-60"
        }
      >
        {busy ? "…" : joined ? "Leave pod" : "Join pod"}
      </button>
      {error ? <p className="max-w-[180px] text-right text-[10px] text-danger">{error}</p> : null}
    </div>
  );
}