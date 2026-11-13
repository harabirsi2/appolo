import Image from "next/image";
import { cn } from "@appolo/ui";
import type { MediaKind } from "@appolo/core/ranking";

const KIND_GLYPH: Record<MediaKind, string> = {
  movie: "🎬",
  tv: "📺",
  music: "🎵",
  podcast: "🎙️",
  book: "📚",
  game: "🎮",
};

const KIND_LABEL: Record<MediaKind, string> = {
  movie: "FILM",
  tv: "TV",
  music: "ALBUM",
  podcast: "POD",
  book: "BOOK",
  game: "GAME",
};

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Deterministic cover hue, reused for ambient page glows. */
export function mediaHue(title: string): number {
  return hashString(title) % 360;
}

/**
 * A deterministic, offline-friendly cover tile. There are no external image
 * dependencies, so every item renders consistently in the demo catalog.
 */
export function MediaArt({
  kind,
  title,
  imageUrl,
  className,
  sizes,
}: {
  kind: MediaKind;
  title: string;
  imageUrl?: string | null;
  genres?: readonly string[] | null;
  className?: string;
  /** Rendered width hint for the image optimizer; defaults to a grid tile. */
  sizes?: string;
}) {
  const hue = mediaHue(title);
  const initials = title
    .split(/\s+/)
    .filter((word) => /[a-z0-9]/i.test(word))
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();

  if (imageUrl) {
    return (
      <div
        className={cn(
          "relative shrink-0 overflow-hidden rounded-lg border border-white/10 bg-elevated shadow-card",
          className,
        )}
        aria-hidden
      >
        <Image
          src={imageUrl}
          alt=""
          fill
          sizes={sizes ?? "(max-width: 768px) 45vw, 360px"}
          className="object-cover"
        />
        <span className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-white/10" />
      </div>
    );
  }

  return (
    <div
      className={cn(
        "relative isolate grid shrink-0 place-items-center overflow-hidden rounded-lg border border-white/10 shadow-card",
        className,
      )}
      style={{
        background: `linear-gradient(150deg, hsl(${hue} 52% 32%) 0%, hsl(${(hue + 28) % 360} 48% 17%) 52%, hsl(${(hue + 60) % 360} 40% 9%) 100%)`,
      }}
      aria-hidden
    >
      <span
        className="pointer-events-none absolute -right-6 -top-8 h-20 w-20 rotate-12 rounded-full blur-2xl"
        style={{ background: `hsl(${(hue + 80) % 360} 70% 60% / 0.4)` }}
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/55 to-transparent" />
      <span className="relative text-[2.1em] leading-none drop-shadow-[0_2px_10px_rgba(0,0,0,0.45)]">{KIND_GLYPH[kind]}</span>
      <span className="absolute left-1.5 top-1.5 rounded bg-black/35 px-1 py-0.5 text-[0.5em] font-bold tracking-[0.12em] text-white/70 backdrop-blur">
        {KIND_LABEL[kind]}
      </span>
      <span className="absolute bottom-1 left-1.5 text-[0.62em] font-black leading-none tracking-tight text-white/85">
        {initials || "?"}
      </span>
      <span className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-white/10" />
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
