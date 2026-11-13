"use client";

import { useState } from "react";
import Link from "next/link";
import type { PodDetail } from "@/lib/services/social";
import { MediaArt } from "./media-art";

export function PodEditor({ pod: initial }: { pod: PodDetail }) {
  const [pod, setPod] = useState(initial);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function saveMeta() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/pods/${pod.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, description }),
      });
      if (res.ok) {
        const data = (await res.json()) as { pod: PodDetail };
        setPod(data.pod);
        setMessage("Saved");
      } else {
        setMessage("Could not save");
      }
    } finally {
      setSaving(false);
    }
  }

  async function removeItem(itemId: string) {
    const res = await fetch(`/api/pods/${pod.id}/items`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemId }),
    });
    if (res.ok) {
      const data = (await res.json()) as { pod: PodDetail };
      setPod(data.pod);
    }
  }

  async function move(itemId: string, direction: -1 | 1) {
    const ids = pod.entries.map((e) => e.id);
    const index = ids.indexOf(itemId);
    if (index < 0) return;
    const next = index + direction;
    if (next < 0 || next >= ids.length) return;
    const reordered = [...ids];
    const tmp = reordered[index]!;
    reordered[index] = reordered[next]!;
    reordered[next] = tmp;
    const res = await fetch(`/api/pods/${pod.id}/items`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ itemIds: reordered }),
    });
    if (res.ok) {
      const data = (await res.json()) as { pod: PodDetail };
      setPod(data.pod);
    }
  }

  async function deletePod() {
    if (!confirm("Delete this pod?")) return;
    const res = await fetch(`/api/pods/${pod.id}`, { method: "DELETE" });
    if (res.ok) {
      window.location.href = "/app/profile";
    }
  }

  return (
    <div className="mt-4 space-y-6">
      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="h-11 w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 text-[14px] text-ink focus:border-white/20 focus:outline-none"
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 py-2 text-[14px] text-ink focus:border-white/20 focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            type="button"
            onClick={saveMeta}
            disabled={saving}
            className="rounded-full bg-white px-4 py-2 text-[13px] font-semibold text-black disabled:opacity-60"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            onClick={deletePod}
            className="rounded-full border border-red-500/40 px-4 py-2 text-[13px] font-semibold text-red-300"
          >
            Delete pod
          </button>
          {message ? <span className="self-center text-[12px] text-muted-2">{message}</span> : null}
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-[15px] font-semibold text-ink">Items ({pod.entries.length})</h2>
        <ul className="space-y-2">
          {pod.entries.map((entry, index) => (
            <li key={entry.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5">
              <MediaArt kind={entry.kind} title={entry.title} imageUrl={entry.imageUrl} sizes="40px" className="h-10 w-10 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-ink">{entry.title}</p>
                <p className="truncate text-[11px] text-muted-2">{entry.subtitle}</p>
              </div>
              <div className="flex gap-1">
                <button type="button" aria-label={`Move ${entry.title} up`} onClick={() => move(entry.id, -1)} disabled={index === 0} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-muted disabled:opacity-30">↑</button>
                <button type="button" aria-label={`Move ${entry.title} down`} onClick={() => move(entry.id, 1)} disabled={index === pod.entries.length - 1} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-muted disabled:opacity-30">↓</button>
                <button type="button" onClick={() => removeItem(entry.id)} className="rounded-full border border-white/10 px-2 py-1 text-[11px] text-red-300">Remove</button>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-[12px] text-muted-2">
          Add items from any item page using “Add to pod”.
        </p>
      </div>

      <div>
        <Link href={`/pods/${pod.id}`} className="text-[12px] text-brand hover:underline">
          View public pod →
        </Link>
      </div>
    </div>
  );
}