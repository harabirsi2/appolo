import { cn } from "@appolo/ui";
import type { MediaKind } from "@appolo/core/ranking";

const KIND_GLYPH: Record<MediaKind, string> = {
  movie: "🎬",
  tv: "📺",
  music: "🎵",
  podcast: "🎙️",
  book: "📚",
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/**
 * A deterministic, offline-friendly cover tile. There are no external image
 * dependencies, so every item renders consistently in the demo catalog.
 */
export function MediaArt({
  kind,
  title,
  className,
}: {
  kind: MediaKind;
  title: string;
  className?: string;
}) {
  const hue = hashString(title) % 360;
  const initials = title
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word))
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  return (
    <div
      className={cn(
        "relative grid shrink-0 place-items-center overflow-hidden rounded-lg border border-border",
        className,
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 45% 30%), hsl(${(hue + 45) % 360} 45% 15%))`,
      }}
      aria-hidden
    >
      <span className="text-base font-bold tracking-tight text-white/90">{initials || "?"}</span>
      <span className="absolute bottom-0.5 right-1 text-[10px] opacity-80">{KIND_GLYPH[kind]}</span>
    </div>
  );
}

export function ScorePill({ score, className }: { score: number; className?: string }) {
  const tone =
    score >= 9
      ? "text-brand-soft border-brand/40 bg-brand/15"
      : score >= 6
        ? "text-success border-success/30 bg-success/15"
        : score >= 4.5
          ? "text-warn border-warn/30 bg-warn/15"
          : "text-muted border-border bg-surface-2";
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md border px-2 py-0.5 text-sm font-semibold tabular-nums",
        tone,
        className,
      )}
    >
      {score.toFixed(1)}
    </span>
  );
}

/** A thin 0–10 score bar used in ranked lists. */
export function ScoreBar({ score, className }: { score: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, score * 10));
  return (
    <div className={cn("h-1.5 w-full overflow-hidden rounded-full bg-surface-2", className)}>
      <div
        className="h-full rounded-full bg-gradient-to-r from-brand to-brand-soft"
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
