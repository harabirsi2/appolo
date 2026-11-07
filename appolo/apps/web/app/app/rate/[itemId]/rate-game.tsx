"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge, Button } from "@appolo/ui";
import { MEDIA_KIND_LABELS, scoreBand, type MediaKind } from "@appolo/core/ranking";
import { MediaArt, ScorePill } from "@/components/media-art";

export interface GameSide {
  id: string;
  kind: MediaKind;
  title: string;
  subtitle: string;
  year: number | null;
  score: number;
  elo: number;
}

type Result = "win" | "loss" | "skip";

export function RateGame({
  initialItem,
  initialOpponent,
}: {
  initialItem: GameSide;
  initialOpponent: GameSide;
}) {
  const [item, setItem] = useState<GameSide>(initialItem);
  const [opponent, setOpponent] = useState<GameSide>(initialOpponent);
  const [busy, setBusy] = useState(false);
  const [votes, setVotes] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function vote(result: Result) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/rankings/${item.id}/vote`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ opponentId: opponent.id, result }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save that vote.");
      }
      const outcome = (await response.json()) as { item: GameSide };

      const nextResponse = await fetch(`/api/rankings/${item.id}/matchup`, { cache: "no-store" });
      if (!nextResponse.ok) {
        const body = (await nextResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not load the next matchup.");
      }
      const next = (await nextResponse.json()) as { item: GameSide; opponent: GameSide };

      setItem(next.item);
      setOpponent(next.opponent);
      setVotes((value) => value + 1);
      setMessage(
        result === "skip"
          ? "Skipped — no score change."
          : `${outcome.item.title} is now ${outcome.item.score.toFixed(1)} / 10.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  const band = scoreBand(item.score);

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center justify-between gap-3">
        <Link href="/app/rate" className="text-xs text-muted hover:text-ink">
          ← All items
        </Link>
        <div className="flex items-center gap-2">
          {votes > 0 ? <Badge tone="neutral">{votes} vote{votes === 1 ? "" : "s"} this session</Badge> : null}
          <Link href="/app/rankings" className="text-xs text-muted hover:text-ink">
            Rankings →
          </Link>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wide text-muted-2">Ranking</p>
            <p className="truncate text-lg font-semibold text-ink">{item.title}</p>
            <p className="truncate text-xs text-muted-2">
              {item.subtitle}
              {item.year ? ` · ${item.year}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <ScorePill score={item.score} className="text-base" />
            <Badge tone={band.tone}>{band.label}</Badge>
          </div>
        </div>
        {message ? <p className="mt-2 text-xs text-success">{message}</p> : null}
        {error ? <p className="mt-2 text-xs text-danger">{error}</p> : null}
      </div>

      <div className="text-center">
        <h1 className="text-lg font-semibold text-ink">Which is better?</h1>
        <p className="mt-1 text-sm text-muted">Pick one — the other goes the other way.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <ContenderCard
          side={item}
          label="Your pick"
          disabled={busy}
          onPick={() => vote("win")}
        />
        <ContenderCard
          side={opponent}
          label="The challenger"
          disabled={busy}
          onPick={() => vote("loss")}
        />
      </div>

      <div className="flex flex-col items-center gap-2">
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => vote("skip")}>
          Can’t decide — skip
        </Button>
        <p className="text-[11px] text-muted-2">
          Items start at 5.0. Each matchup is Elo-based, so wins against stronger items count more.
        </p>
      </div>
    </div>
  );
}

function ContenderCard({
  side,
  label,
  disabled,
  onPick,
}: {
  side: GameSide;
  label: string;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs uppercase tracking-wide text-muted-2">{label}</span>
        <Badge tone="neutral">{MEDIA_KIND_LABELS[side.kind]}</Badge>
      </div>
      <MediaArt kind={side.kind} title={side.title} className="mb-3 aspect-[4/3] w-full" />
      <p className="text-sm font-semibold text-ink">{side.title}</p>
      <p className="mt-0.5 text-xs text-muted-2">
        {side.subtitle}
        {side.year ? ` · ${side.year}` : ""}
      </p>
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[11px] text-muted-2">Current score</span>
        <ScorePill score={side.score} />
      </div>
      <Button className="mt-4 w-full" disabled={disabled} onClick={onPick}>
        Pick this one
      </Button>
    </div>
  );
}