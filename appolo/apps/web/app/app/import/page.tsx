"use client";

import { useState } from "react";
import { Button } from "@appolo/ui";
import { BackButton } from "@/components/back-button";

interface Stats {
  imported: number;
  skipped: number;
  created: number;
  updated: number;
  unrated: number;
}

async function upload(endpoint: string, file: File): Promise<Stats> {
  const form = new FormData();
  form.append("file", file);
  const response = await fetch(endpoint, { method: "POST", body: form });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Import failed.");
  }
  return (await response.json()) as Stats;
}

function StatsLine({ stats }: { stats: Stats }) {
  return (
    <p className="text-[12px] text-muted">
      Imported {stats.imported} · rated {stats.created + stats.updated} · unrated {stats.unrated} ·
      skipped {stats.skipped}
    </p>
  );
}

export default function ImportPage() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<Record<string, Stats>>({});

  async function handle(endpoint: string, key: string, file: File | null) {
    if (!file) return;
    setBusy(key);
    setError(null);
    try {
      const result = await upload(endpoint, file);
      setStats((prev) => ({ ...prev, [key]: result }));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Import failed.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="px-5 pt-4 pb-24">
      <div className="flex items-center justify-between">
        <BackButton fallback="/app/profile" />
        <h1 className="text-[20px] font-bold text-ink">Import</h1>
        <span className="w-8" />
      </div>

      <p className="mt-3 text-[13px] text-muted">
        Bring your history in. Explicit ratings are converted to the Appolo 0–10 scale; Spotify
        listening history is imported unrated.
      </p>

      {error ? <p className="mt-3 text-[12px] text-danger">{error}</p> : null}

      <section className="mt-6 space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <h2 className="text-[14px] font-semibold text-ink">Letterboxd</h2>
        <p className="text-[12px] text-muted-2">
          Upload your Letterboxd ratings CSV (diary or ratings export).
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy !== null}
          onChange={(event) => handle("/api/import/letterboxd", "letterboxd", event.target.files?.[0] ?? null)}
          className="block w-full text-[12px] text-muted"
        />
        {busy === "letterboxd" ? <p className="text-[11px] text-muted-2">Importing…</p> : null}
        {stats.letterboxd ? <StatsLine stats={stats.letterboxd} /> : null}
      </section>

      <section className="mt-4 space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <h2 className="text-[14px] font-semibold text-ink">Goodreads</h2>
        <p className="text-[12px] text-muted-2">
          Upload your Goodreads library CSV export.
        </p>
        <input
          type="file"
          accept=".csv,text/csv"
          disabled={busy !== null}
          onChange={(event) => handle("/api/import/goodreads", "goodreads", event.target.files?.[0] ?? null)}
          className="block w-full text-[12px] text-muted"
        />
        {busy === "goodreads" ? <p className="text-[11px] text-muted-2">Importing…</p> : null}
        {stats.goodreads ? <StatsLine stats={stats.goodreads} /> : null}
      </section>

      <section className="mt-4 space-y-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <h2 className="text-[14px] font-semibold text-ink">Spotify</h2>
        <p className="text-[12px] text-muted-2">
          Import your top tracks to your watchlist. They stay unrated until you score them.
        </p>
        <a href="/api/spotify/connect">
          <Button type="button" className="w-full" size="lg">
            Connect Spotify
          </Button>
        </a>
      </section>
    </div>
  );
}