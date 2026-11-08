"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@appolo/ui";
import { scoreBand, type MediaKind } from "@appolo/core/ranking";
import { MediaArt } from "@/components/media-art";
import { GradientSlider, Icon } from "@/components/podiums";
import { BackButton } from "@/components/back-button";

interface RatingSide {
  id: string;
  kind: MediaKind;
  title: string;
  subtitle: string;
  year: number | null;
  score: number;
  reviewText: string;
  reviewTags: string[];
}

interface OpponentSide {
  id: string;
  title: string;
  year: number | null;
}

export function FinishRating({
  initialItem,
  initialOpponent,
  kindLabel,
  suggestedTags,
  pods,
}: {
  initialItem: RatingSide;
  initialOpponent: OpponentSide;
  kindLabel: string;
  suggestedTags: string[];
  pods: Array<{ id: string; title: string }>;
}) {
  const router = useRouter();
  const [item, setItem] = useState(initialItem);
  const [opponent, setOpponent] = useState(initialOpponent);
  const [tags, setTags] = useState<string[]>(initialItem.reviewTags);
  const [podIds, setPodIds] = useState<string[]>([]);
  const [text, setText] = useState(initialItem.reviewText);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [votes, setVotes] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function toggleTag(tag: string) {
    setTags((current) =>
      current.includes(tag) ? current.filter((value) => value !== tag) : current.length >= 6 ? current : [...current, tag],
    );
  }

  function togglePod(podId: string) {
    setPodIds((current) =>
      current.includes(podId) ? current.filter((value) => value !== podId) : [...current, podId],
    );
  }

  async function vote(result: "win" | "loss" | "skip") {
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
      const outcome = (await response.json()) as { item: { score: number } };

      const nextResponse = await fetch(`/api/rankings/${item.id}/matchup`, { cache: "no-store" });
      if (!nextResponse.ok) {
        const body = (await nextResponse.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not load the next matchup.");
      }
      const next = (await nextResponse.json()) as {
        opponent: { id: string; title: string; year: number | null };
      };

      setItem((current) => ({ ...current, score: outcome.item.score }));
      setOpponent({ id: next.opponent.id, title: next.opponent.title, year: next.opponent.year });
      setVotes((value) => value + 1);
      setMessage(
        result === "skip"
          ? "Skipped — no score change."
          : `Now ${outcome.item.score.toFixed(1)} / 10.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/rankings/${item.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: text || null, tags, podIds }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not save your rating.");
      }
      router.push(`/app/item/${item.id}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
      setSaving(false);
    }
  }

  const band = scoreBand(item.score);

  return (
    <div className="px-5 pt-4">
      <div className="flex items-center justify-between">
        <BackButton fallback={`/app/item/${item.id}`} />
        <Link href={`/app/item/${item.id}`} className="text-xs text-muted-2 hover:text-ink">
          View item
        </Link>
      </div>

      <div className="mt-4 flex flex-col items-center text-center">
        <MediaArt kind={item.kind} title={item.title} className="aspect-square w-[156px] rounded-2xl shadow-xl" />
        <h1 className="mt-4 text-[24px] font-bold leading-tight tracking-tight text-ink">{item.title}</h1>
        <p className="mt-1 text-[12px] text-muted">
          {[item.subtitle, kindLabel, item.year ? String(item.year) : null].filter(Boolean).join(" · ")}
        </p>
      </div>

      <div className="mt-5 rounded-3xl border border-white/[0.08] bg-[#141416] p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-[22px] font-semibold tracking-tight text-ink">Finish rating</h2>
          <Link
            href={`/app/item/${item.id}`}
            aria-label="Close"
            className="grid h-8 w-8 place-items-center rounded-full text-muted transition-colors hover:bg-white/10 hover:text-ink"
          >
            <Icon name="close" className="h-4 w-4" />
          </Link>
        </div>

        <GradientSlider score={item.score} className="mt-6" />
        <div className="mt-1.5 flex justify-between text-[10px] text-muted-2">
          <span>0</span>
          <span>5</span>
          <span>10</span>
        </div>

        <div className="mt-4 flex items-end justify-between">
          <div>
            <p className="text-[10px] uppercase tracking-[0.14em] text-muted-2">Your score</p>
            <p className="text-[30px] font-bold leading-none text-brand">
              {item.score.toFixed(1)}
              <span className="ml-1 text-[13px] font-normal text-muted-2">/10</span>
            </p>
          </div>
          <div className="text-right">
            <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-muted">
              {band.label}
            </span>
            {votes > 0 ? <p className="mt-1.5 text-[10px] text-muted-2">{votes} votes this session</p> : null}
          </div>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5">
          {suggestedTags.map((tag) => {
            const active = tags.includes(tag);
            return (
              <button
                key={tag}
                type="button"
                onClick={() => toggleTag(tag)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  active
                    ? "border-brand/50 bg-brand/20 text-brand"
                    : "border-white/10 bg-white/[0.05] text-muted hover:text-ink"
                }`}
              >
                {tag}
              </button>
            );
          })}
          {pods.map((pod) => {
            const active = podIds.includes(pod.id);
            return (
              <button
                key={pod.id}
                type="button"
                onClick={() => togglePod(pod.id)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  active
                    ? "border-fuchsia-400/50 bg-fuchsia-400/20 text-fuchsia-200"
                    : "border-fuchsia-400/25 bg-fuchsia-400/10 text-fuchsia-200/80 hover:text-fuchsia-100"
                }`}
              >
                {pod.title}
              </button>
            );
          })}
          <Link
            href={`/app/pods/new?item=${item.id}`}
            className="rounded-full border border-dashed border-white/15 px-2.5 py-1 text-[11px] text-muted-2 hover:text-ink"
          >
            + pod
          </Link>
        </div>

        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="“One of the greatest movies of the year...”"
          className="mt-4 w-full resize-none rounded-xl border border-white/[0.06] bg-black/40 px-3 py-2.5 text-[13px] italic leading-relaxed text-ink placeholder:text-muted-2 focus:border-white/20 focus:outline-none"
        />

        <div className="mt-5">
          <p className="text-center text-[13px] font-semibold text-ink">Which is better?</p>
          <p className="mt-0.5 text-center text-[11px] text-muted-2">
            Pick one to keep fine-tuning your score.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-3">
            <CompareCard
              title={item.title}
              year={item.year}
              disabled={busy}
              onPick={() => vote("win")}
            />
            <CompareCard
              title={opponent.title}
              year={opponent.year}
              disabled={busy}
              onPick={() => vote("loss")}
            />
          </div>

          <div className="mt-2 flex items-center justify-between">
            <button
              type="button"
              disabled={busy}
              onClick={() => vote("skip")}
              className="text-[11px] text-muted-2 transition-colors hover:text-ink disabled:opacity-50"
            >
              Can’t decide — skip
            </button>
            {message ? <p className="text-[11px] text-brand">{message}</p> : null}
          </div>
          {error ? <p className="mt-1 text-center text-[11px] text-danger">{error}</p> : null}
        </div>

        <Button className="mt-5 w-full" size="lg" disabled={saving || busy} onClick={save}>
          {saving ? "Saving…" : "Save rating"}
        </Button>
      </div>
    </div>
  );
}

function CompareCard({
  title,
  year,
  disabled,
  onPick,
}: {
  title: string;
  year: number | null;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className="flex h-[104px] flex-col items-center justify-center gap-1 rounded-xl border border-white/15 bg-gradient-to-b from-[#3c3c40] to-[#232327] px-3 text-center shadow-inner transition-all hover:from-[#4a4a4f] hover:to-[#2b2b30] active:scale-[0.99] disabled:opacity-60"
    >
      <span className="text-[14px] font-medium leading-tight text-white">{title}</span>
      <span className="text-[11px] text-white/45">{year ?? "—"}</span>
    </button>
  );
}