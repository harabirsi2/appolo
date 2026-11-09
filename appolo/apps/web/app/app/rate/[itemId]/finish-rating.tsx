"use client";

import { useEffect, useState } from "react";
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
  spoiler: boolean;
  photoUrl: string | null;
  favoriteCharacter: string | null;
  favoriteTracks: string[];
}

interface OpponentSide {
  id: string;
  kind: MediaKind;
  title: string;
  year: number | null;
  imageUrl: string | null;
}

export function FinishRating({
  initialItem,
  initialOpponent,
  kindLabel,
  suggestedTags,
  pods,
  manualMode,
}: {
  initialItem: RatingSide;
  initialOpponent: OpponentSide;
  kindLabel: string;
  suggestedTags: string[];
  pods: Array<{ id: string; title: string }>;
  manualMode: boolean;
}) {
  const router = useRouter();
  const [item, setItem] = useState(initialItem);
  const [opponent, setOpponent] = useState(initialOpponent);
  const [tags, setTags] = useState<string[]>(initialItem.reviewTags);
  const [podIds, setPodIds] = useState<string[]>([]);
  const [text, setText] = useState(initialItem.reviewText);
  const [spoiler, setSpoiler] = useState(initialItem.spoiler);
  const [photoUrl, setPhotoUrl] = useState(initialItem.photoUrl ?? "");
  const [favoriteCharacter, setFavoriteCharacter] = useState(initialItem.favoriteCharacter ?? "");
  const [favoriteTracks, setFavoriteTracks] = useState<string[]>(initialItem.favoriteTracks);
  const [trackInput, setTrackInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [votes, setVotes] = useState(0);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manualScore, setManualScore] = useState(initialItem.score);
  const [manualBusy, setManualBusy] = useState(false);

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

  type VoteResult = "win" | "loss" | "tie" | "undecided" | "skip";

  async function undoLast() {
    setUndoing(true);
    setError(null);
    try {
      const response = await fetch(`/api/rankings/${item.id}/undo`, { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not undo that comparison.");
      }
      const outcome = (await response.json()) as { undone: boolean };
      setMessage(outcome.undone ? "Undid the last comparison." : "Nothing to undo yet.");
      if (outcome.undone) router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setUndoing(false);
    }
  }

  async function vote(result: VoteResult) {
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
        opponent: { id: string; kind: MediaKind; title: string; year: number | null; imageUrl: string | null };
      };

      setItem((current) => ({ ...current, score: outcome.item.score }));
      setOpponent({
        id: next.opponent.id,
        kind: next.opponent.kind,
        title: next.opponent.title,
        year: next.opponent.year,
        imageUrl: next.opponent.imageUrl,
      });
      setVotes((value) => value + 1);
      setMessage(
        result === "skip"
          ? "Skipped — no score change."
          : result === "undecided"
            ? "Too close to call — no score change."
            : result === "tie"
              ? `Tied — now ${outcome.item.score.toFixed(1)} / 10.`
              : `Now ${outcome.item.score.toFixed(1)} / 10.`,
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function setManual() {
    setManualBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/rankings/${item.id}/manual`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ score: manualScore }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Could not set score.");
      }
      const outcome = (await response.json()) as { rating: { score: number } };
      setItem((current) => ({ ...current, score: outcome.rating.score }));
      setMessage(`Set to ${outcome.rating.score.toFixed(1)} / 10.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong.");
    } finally {
      setManualBusy(false);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const response = await fetch(`/api/rankings/${item.id}/review`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: text || null,
          tags,
          podIds,
          spoiler,
          photoUrl: photoUrl || null,
          favoriteCharacter: favoriteCharacter || null,
          favoriteTracks,
        }),
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

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (busy || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (event.key === "1") void vote("win");
      if (event.key === "2") void vote("loss");
      if (event.key === "3") void vote("tie");
      if (event.key === "4") void vote("undecided");
      if (event.key.toLowerCase() === "s") void vote("skip");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

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
          maxLength={10000}
          rows={3}
          placeholder="“One of the greatest movies of the year...”"
          className="mt-4 w-full resize-none rounded-xl border border-white/[0.06] bg-black/40 px-3 py-2.5 text-[13px] italic leading-relaxed text-ink placeholder:text-muted-2 focus:border-white/20 focus:outline-none"
        />

        <div className="mt-4 space-y-3">
          <label className="flex items-center gap-2 text-[12px] text-muted">
            <input type="checkbox" checked={spoiler} onChange={(e) => setSpoiler(e.target.checked)} />
            Contains spoilers
          </label>
          <input
            value={photoUrl}
            onChange={(e) => setPhotoUrl(e.target.value)}
            placeholder="Photo URL (optional)"
            className="h-10 w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 text-[13px] text-ink focus:border-white/20 focus:outline-none"
          />
          <input
            value={favoriteCharacter}
            onChange={(e) => setFavoriteCharacter(e.target.value)}
            placeholder="Favorite character"
            className="h-10 w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 text-[13px] text-ink focus:border-white/20 focus:outline-none"
          />
          <div className="flex gap-2">
            <input
              value={trackInput}
              onChange={(e) => setTrackInput(e.target.value)}
              placeholder="Favorite track"
              className="h-10 flex-1 rounded-xl border border-white/[0.06] bg-[#1a1a1d] px-3 text-[13px] text-ink focus:border-white/20 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => {
                const v = trackInput.trim();
                if (!v) return;
                if (favoriteTracks.includes(v)) return;
                setFavoriteTracks((prev) => [...prev, v].slice(0, 10));
                setTrackInput("");
              }}
              className="rounded-full border border-white/10 px-3 text-[12px] text-muted hover:text-ink"
            >
              Add
            </button>
          </div>
          {favoriteTracks.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {favoriteTracks.map((track) => (
                <button
                  key={track}
                  type="button"
                  onClick={() => setFavoriteTracks((prev) => prev.filter((t) => t !== track))}
                  className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-muted hover:text-ink"
                >
                  {track} ×
                </button>
              ))}
            </div>
          ) : null}
        </div>

        {manualMode ? (
          <div className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
            <p className="text-[12px] font-semibold text-ink">Manual mode</p>
            <div className="mt-2 flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={10}
                step={0.1}
                value={manualScore}
                onChange={(e) => setManualScore(Number(e.target.value))}
                className="flex-1"
              />
              <span className="w-10 text-right text-[13px] text-ink">{manualScore.toFixed(1)}</span>
              <button
                type="button"
                onClick={setManual}
                disabled={manualBusy}
                className="rounded-full border border-white/10 px-3 py-1 text-[12px] text-muted hover:text-ink disabled:opacity-60"
              >
                Set
              </button>
            </div>
          </div>
        ) : null}

        <div className="mt-5">
          <p className="text-center text-[13px] font-semibold text-ink">Which is better?</p>
          <p className="mt-0.5 text-center text-[11px] text-muted-2">
            Pick one to keep fine-tuning your score.
          </p>

          <div className="relative mt-3 grid grid-cols-2 gap-3">
            <CompareCard
              title={item.title}
              year={item.year}
              kind={item.kind}
              imageUrl={item.photoUrl}
              hint="1"
              disabled={busy}
              onPick={() => vote("win")}
            />
            <CompareCard
              title={opponent.title}
              year={opponent.year}
              kind={opponent.kind}
              imageUrl={opponent.imageUrl}
              hint="2"
              disabled={busy}
              onPick={() => vote("loss")}
            />
            <span className="pointer-events-none absolute left-1/2 top-1/2 z-10 grid h-7 w-7 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black text-[9px] font-bold tracking-wide text-white/70">
              VS
            </span>
          </div>
          <p className="mt-1.5 text-center text-[10px] text-muted-2">Tip: press 1, 2, 3, 4, or S</p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => vote("tie")}
              className="min-h-11 rounded-xl border border-white/10 bg-white/[0.03] text-[12px] font-medium text-ink transition-colors hover:border-white/20 disabled:opacity-50"
            >
              Equally good
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => vote("undecided")}
              className="min-h-11 rounded-xl border border-white/10 bg-white/[0.03] text-[12px] font-medium text-ink transition-colors hover:border-white/20 disabled:opacity-50"
            >
              Too close to call
            </button>
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                disabled={busy}
                onClick={() => vote("skip")}
                className="text-[11px] text-muted-2 transition-colors hover:text-ink disabled:opacity-50"
              >
                Skip this one
              </button>
              <button
                type="button"
                disabled={undoing || busy}
                onClick={undoLast}
                className="text-[11px] text-muted-2 transition-colors hover:text-ink disabled:opacity-50"
              >
                {undoing ? "Undoing…" : "Undo last"}
              </button>
            </div>
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
  kind,
  imageUrl,
  hint,
  disabled,
  onPick,
}: {
  title: string;
  year: number | null;
  kind: MediaKind;
  imageUrl: string | null;
  hint: string;
  disabled: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onPick}
      className="group relative flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-3 text-center shadow-card transition-all hover:border-brand/40 hover:from-brand/[0.12] active:scale-[0.98] disabled:opacity-60"
    >
      <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white/50">{hint}</span>
      <MediaArt kind={kind} title={title} imageUrl={imageUrl} className="h-[72px] w-[72px] rounded-xl" />
      <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-white">{title}</span>
      <span className="text-[11px] text-white/45">{year ?? "—"}</span>
    </button>
  );
}