"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@appolo/ui";
import { MediaArt } from "@/components/media-art";
import type { MediaKind } from "@appolo/core/ranking";

export function CreatePodForm({
  initialItem,
}: {
  initialItem: { id: string; title: string; kind: MediaKind } | null;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/pods", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim() || null,
          itemIds: initialItem ? [initialItem.id] : [],
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not create that pod.");
      }
      const body = (await response.json()) as { pod: { ownerUsername: string; slug: string } };
      router.push(`/${body.pod.ownerUsername}/${body.pod.slug}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="mt-6 space-y-4">
      <div>
        <label htmlFor="pod-title" className="mb-1.5 block text-[12px] font-medium text-muted">
          Title
        </label>
        <input
          id="pod-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          maxLength={80}
          placeholder="2026 bangers"
          className="h-11 w-full rounded-xl border border-white/[0.08] bg-[#1a1a1d] px-3 text-[14px] text-ink placeholder:text-muted-2 focus:border-white/20 focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="pod-description" className="mb-1.5 block text-[12px] font-medium text-muted">
          Description
        </label>
        <textarea
          id="pod-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          maxLength={300}
          rows={3}
          placeholder="What is this list about?"
          className="w-full resize-none rounded-xl border border-white/[0.08] bg-[#1a1a1d] px-3 py-2.5 text-[14px] text-ink placeholder:text-muted-2 focus:border-white/20 focus:outline-none"
        />
      </div>

      {initialItem ? (
        <div className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
          <MediaArt kind={initialItem.kind} title={initialItem.title} className="h-12 w-12 rounded-lg" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium text-ink">{initialItem.title}</p>
            <p className="text-[11px] text-muted-2">Starts this pod</p>
          </div>
        </div>
      ) : null}

      {error ? <p className="text-[12px] text-danger">{error}</p> : null}

      <Button type="submit" className="w-full" size="lg" disabled={busy || !title.trim()}>
        {busy ? "Creating…" : "Create pod"}
      </Button>
    </form>
  );
}