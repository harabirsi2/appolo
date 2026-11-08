"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/podiums";

interface PodOption {
  id: string;
  title: string;
  ownerUsername: string;
  owned: boolean;
  contains: boolean;
}

export function AddToPod({ itemId }: { itemId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pods, setPods] = useState<PodOption[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setOpen((value) => !value);
    if (pods !== null) return;
    try {
      const response = await fetch(`/api/pods/available?itemId=${itemId}`, { cache: "no-store" });
      if (!response.ok) throw new Error("Could not load your pods.");
      const data = (await response.json()) as { pods: PodOption[] };
      setPods(data.pods);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setPods([]);
    }
  }

  async function toggle(pod: PodOption) {
    setBusyId(pod.id);
    setError(null);
    try {
      const response = await fetch(`/api/pods/${pod.id}/items`, {
        method: pod.contains ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not update that pod.");
      }
      setPods((current) =>
        current ? current.map((entry) => (entry.id === pod.id ? { ...entry, contains: !entry.contains } : entry)) : current,
      );
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={load}
        aria-expanded={open}
        className="grid h-10 w-10 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-ink transition-colors hover:bg-white/10"
        aria-label="Add to a pod"
      >
        <Icon name="plus" className="h-[18px] w-[18px]" />
      </button>

      {open ? (
        <div className="absolute right-0 top-12 z-30 w-[min(268px,calc(100vw-40px))] rounded-2xl border border-white/10 bg-[#141417] p-3 shadow-float">
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-semibold text-ink">Save to a pod</p>
            <span className="text-[10px] text-muted-2">public pods welcome</span>
          </div>

          {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}

          {pods === null ? (
            <p className="mt-2 text-[11px] text-muted-2">Loading pods…</p>
          ) : pods.length === 0 ? (
            <div className="mt-2">
              <p className="text-[11px] text-muted">No pods yet.</p>
              <Link href={`/app/pods/new?item=${itemId}`} className="mt-1 inline-block text-[11px] text-brand hover:underline">
                Create one →
              </Link>
            </div>
          ) : (
            <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
              {pods.map((pod) => (
                <li key={pod.id}>
                  <button
                    type="button"
                    disabled={busyId === pod.id}
                    onClick={() => toggle(pod)}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.06] disabled:opacity-60"
                  >
                    <span
                      className={`grid h-4 w-4 shrink-0 place-items-center rounded border text-[9px] ${
                        pod.contains ? "border-brand/50 bg-brand/20 text-brand" : "border-white/20 text-transparent"
                      }`}
                    >
                      ✓
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{pod.title}</span>
                    <span className="shrink-0 text-[10px] text-muted-2">
                      {pod.owned ? "yours" : `@${pod.ownerUsername}`}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
