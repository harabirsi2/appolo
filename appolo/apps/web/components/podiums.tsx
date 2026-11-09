import Link from "next/link";
import { cn } from "@appolo/ui";
import { videoEmbed } from "@/lib/video-embed";
import { ReviewEngagement } from "./review-engagement";
import type { MediaKind } from "@appolo/core/ranking";
import { MediaArt } from "./media-art";
import { KindIcon } from "./kind-icon";

/* ------------------------------------------------------------------ */
/* avatars + icons                                                     */
/* ------------------------------------------------------------------ */

export function Avatar({
  name,
  hue = 250,
  size = 36,
  className,
}: {
  name: string;
  hue?: number;
  size?: number;
  className?: string;
}) {
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();

  return (
    <span
      className={cn(
        "inline-grid shrink-0 place-items-center rounded-full font-semibold text-white ring-1 ring-white/10",
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: Math.max(10, Math.round(size * 0.34)),
        background: `linear-gradient(135deg, hsl(${hue} 62% 42%), hsl(${(hue + 48) % 360} 58% 24%))`,
      }}
      aria-hidden
    >
      {initials || "?"}
    </span>
  );
}

export function Icon({
  name,
  className,
}: {
  name:
    | "home"
    | "search"
    | "plus"
    | "person"
    | "back"
    | "share"
    | "bookmark"
    | "spotify"
    | "close"
    | "grid"
    | "rank"
    | "spark"
    | "settings"
    | "bell";
  className?: string;
}) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: cn("h-5 w-5", className),
  };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m16 16 4 4" />
        </svg>
      );
    case "grid":
      return (
        <svg {...common}>
          <rect x="4" y="4" width="7" height="7" rx="2" />
          <rect x="13" y="4" width="7" height="7" rx="2" />
          <rect x="4" y="13" width="7" height="7" rx="2" />
          <rect x="13" y="13" width="7" height="7" rx="2" />
        </svg>
      );
    case "person":
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="3.5" />
          <path d="M5 20c.8-3.6 3.5-5.5 7-5.5s6.2 1.9 7 5.5" />
        </svg>
      );
    case "plus":
      return (
        <svg {...common}>
          <path d="M12 5v14M5 12h14" />
        </svg>
      );
    case "back":
      return (
        <svg {...common}>
          <path d="m14.5 5-7 7 7 7" />
        </svg>
      );
    case "share":
      return (
        <svg {...common}>
          <path d="M12 15V3m0 0L8 7m4-4 4 4" />
          <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
        </svg>
      );
    case "bookmark":
      return (
        <svg {...common}>
          <path d="M6 4h12v17l-6-4-6 4z" />
        </svg>
      );
    case "spotify":
      return (
        <svg viewBox="0 0 24 24" fill="currentColor" className={cn("h-5 w-5", className)}>
          <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 14.5a.8.8 0 0 1-1.1.3c-3-1.8-6.8-2.2-11.2-1.2a.8.8 0 1 1-.4-1.6c4.9-1.1 9-.6 12.4 1.4.4.2.5.7.3 1.1Zm1.2-2.7a1 1 0 0 1-1.3.4c-3.4-2.1-8.5-2.7-12.5-1.5a1 1 0 1 1-.6-1.9c4.6-1.4 10.3-.7 14.2 1.7.5.3.6.9.2 1.3Zm.1-2.8C14.1 8.5 7.9 8.3 4.8 9.3a1.2 1.2 0 1 1-.7-2.3c3.6-1.1 10.4-.9 14.5 1.6a1.2 1.2 0 0 1-1.2 2Z" />
        </svg>
      );
    case "rank":
      return (
        <svg {...common}>
          <path d="M5 20v-9M12 20V4M19 20v-6" />
        </svg>
      );
    case "spark":
      return (
        <svg {...common}>
          <path d="M12 3.5l1.9 5.1L19 10.5l-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z" />
        </svg>
      );
    case "settings":
      return (
        <svg {...common}>
          <path d="M4 7h8M18 7h2M4 17h2M10 17h10" />
          <circle cx="15" cy="7" r="2" />
          <circle cx="7" cy="17" r="2" />
        </svg>
      );
    case "bell":
      return (
        <svg {...common}>
          <path d="M6.5 9a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5S6.5 13 6.5 9Z" />
          <path d="M10 18.5a2 2 0 0 0 4 0" />
        </svg>
      );
    case "close":
      return (
        <svg {...common}>
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      );
  }
}

/* ------------------------------------------------------------------ */
/* rating curve + slider                                               */
/* ------------------------------------------------------------------ */

function smoothPath(values: number[], width = 320, height = 70): string {
  const n = values.length;
  if (n === 0) return "";
  const points = values.map((value, index) => ({
    x: (index / n) * width,
    y: height - 6 - value * (height - 14),
  }));
  let path = `M ${points[0]!.x.toFixed(1)} ${points[0]!.y.toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i]!;
    const p1 = points[i + 1]!;
    const mx = (p0.x + p1.x) / 2;
    path += ` C ${mx.toFixed(1)} ${p0.y.toFixed(1)}, ${mx.toFixed(1)} ${p1.y.toFixed(1)}, ${p1.x.toFixed(1)} ${p1.y.toFixed(1)}`;
  }
  return path;
}

/** The signature red-to-green score distribution wave. */
export function RatingCurve({
  distribution,
  className,
}: {
  distribution: number[];
  className?: string;
}) {
  const buckets = Array.from({ length: 10 }, (_, index) => distribution[index] ?? 0);
  const total = buckets.reduce((sum, value) => sum + value, 0);
  const smoothed = buckets.map((_, index) => {
    let weight = 0;
    let sum = 0;
    for (let offset = -2; offset <= 2; offset += 1) {
      const bucket = buckets[index + offset];
      if (bucket === undefined) continue;
      const k = 1 / (1 + Math.abs(offset));
      weight += k;
      sum += bucket * k;
    }
    return weight === 0 ? 0 : sum / weight;
  });
  const max = Math.max(1, ...smoothed);
  const values = total === 0 ? smoothed.map(() => 0.12) : smoothed.map((value) => 0.1 + (value / max) * 0.9);
  const line = smoothPath(values);
  const area = `${line} L 320 70 L 0 70 Z`;

  return (
    <svg viewBox="0 0 320 70" preserveAspectRatio="none" className={cn("h-16 w-full", className)} aria-hidden>
      <defs>
        <linearGradient id="curve-stroke" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#f43f5e" />
          <stop offset="45%" stopColor="#facc15" />
          <stop offset="100%" stopColor="#4ade80" />
        </linearGradient>
        <linearGradient id="curve-fill" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.42" />
          <stop offset="45%" stopColor="#facc15" stopOpacity="0.36" />
          <stop offset="100%" stopColor="#4ade80" stopOpacity="0.42" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#curve-fill)" />
      <path d={line} fill="none" stroke="url(#curve-stroke)" strokeWidth="2.4" />
    </svg>
  );
}

/** Static gradient rail with a thumb, mirroring the finishing sheet. */
export function GradientSlider({ score, className }: { score: number; className?: string }) {
  const pct = Math.max(0, Math.min(100, score * 10));
  return (
    <div className={cn("relative h-2 w-full rounded-full", className)} style={{
      background: "linear-gradient(90deg, #fb7185 0%, #f59e0b 35%, #a3e635 68%, #22c55e 100%)",
    }}>
      <span
        className="absolute top-1/2 grid h-8 w-12 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 border-[#86efac] bg-black/30 shadow-[0_0_18px_rgba(74,222,128,0.45)] backdrop-blur"
        style={{ left: `${pct}%` }}
      >
        <span className="h-1 w-6 rounded-full bg-white/80" />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* scores                                                             */
/* ------------------------------------------------------------------ */

export function ScoreText({ score, className }: { score: number | null; className?: string }) {
  return (
    <span className={cn("num font-semibold", score === null ? "text-muted-2" : "text-brand", className)}>
      {score === null ? "—" : score.toFixed(1)}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* discover tiles                                                      */
/* ------------------------------------------------------------------ */

const TILE_ART: Record<MediaKind, string[]> = {
  movie: ["The Godfather", "Parasite", "Dune"],
  tv: ["Breaking Bad", "The Bear", "Severance"],
  music: ["Blonde", "Kid A", "In Rainbows"],
  podcast: ["Serial", "Hardcore History", "The Daily"],
  book: ["Beloved", "Piranesi", "Project Hail Mary"],
  game: ["Hollow Knight", "Elden Ring", "Hades"],
};

export function CategoryTile({
  kind,
  href,
  label,
}: {
  kind: MediaKind;
  href: string;
  label: string;
}) {
  const titles = TILE_ART[kind];
  return (
    <Link
      href={href}
      className="group relative isolate flex h-[124px] flex-col overflow-hidden rounded-2xl border border-white/5 bg-[#141416] px-3 pt-3 text-center transition-colors hover:border-white/15"
    >
      <span className="relative z-10 inline-flex items-center gap-1.5 self-center text-[15px] font-semibold text-ink">
        <KindIcon kind={kind} className="h-4 w-4 text-brand" />
        {label}
      </span>
      <span className="pointer-events-none absolute inset-x-2 bottom-1 h-[86px]">
        {titles.map((title, index) => {
          const rotations = ["-rotate-6", "rotate-2", "rotate-8"];
          const offsets = ["left-0", "left-[30%]", "right-0"];
          return (
            <span
              key={title}
              className={cn(
                "absolute bottom-0 w-[46%] overflow-hidden rounded-md shadow-xl ring-1 ring-black/40 transition-transform duration-300 group-hover:-translate-y-1",
                rotations[index],
                offsets[index],
              )}
              style={{ zIndex: index === 1 ? 2 : 1 }}
            >
              <MediaArt kind={kind} title={title} className="aspect-square w-full rounded-md border-0" />
            </span>
          );
        })}
      </span>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* reviews + pods                                                      */
/* ------------------------------------------------------------------ */

export interface ReviewCardData {
  id: string;
  username: string;
  displayName: string;
  avatarHue: number;
  itemId: string;
  itemTitle: string;
  itemSubtitle: string;
  kind: MediaKind;
  score: number;
  text: string | null;
  tags: string[];
  spoiler?: boolean;
  photoUrl?: string | null;
  videoUrl?: string | null;
  favoriteCharacter?: string | null;
  favoriteTracks?: string[];
  reactions?: Array<{ emoji: string; count: number; mine: boolean }>;
  commentCount?: number;
  /** Feed explanation, e.g. "From someone you follow". */
  reason?: string;
}

export function ReviewCard({ review, className }: { review: ReviewCardData; className?: string }) {
  return (
    <article
      className={cn(
        "card-surface card-hover flex flex-col rounded-2xl p-3.5 shadow-card",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <Avatar name={review.displayName} hue={review.avatarHue} size={30} />
        <Link href={`/${review.username}`} className="min-w-0 flex-1 truncate text-xs font-medium text-ink hover:underline">
          {`@${review.username}`}
        </Link>
        <Link href={`/review/${review.id}`} className="shrink-0 text-[10px] text-muted-2 hover:text-ink">
          view
        </Link>
        <ScoreText score={review.score} className="text-sm" />
      </div>
      <p className="mt-2.5 text-[13px] font-semibold leading-tight text-ink">
        <Link href={`/app/item/${review.itemId}`} className="hover:underline">
          {review.itemTitle}
        </Link>
      </p>
      <p className="text-[11px] text-muted-2">{review.itemSubtitle || review.kind}</p>
      {review.reason ? (
        <p className="mt-1 text-[10px] font-medium tracking-[0.02em] text-brand/80">{review.reason}</p>
      ) : null}
      {review.text ? (
        <p className="mt-2 line-clamp-6 whitespace-pre-line text-[13px] leading-relaxed text-muted">
          {review.spoiler ? <span className="mr-1 rounded bg-red-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-red-300">Spoiler</span> : null}
          {review.text}
        </p>
      ) : null}
      {review.photoUrl ? (
        <img src={review.photoUrl} alt="" className="mt-2 max-h-40 w-full rounded-lg object-cover" />
      ) : null}
      {review.videoUrl ? (
        (() => {
          const embed = videoEmbed(review.videoUrl);
          return embed.kind === "iframe" ? (
            <iframe src={embed.src} className="mt-2 aspect-video w-full rounded-lg" allowFullScreen />
          ) : (
            <video src={embed.src} controls className="mt-2 w-full rounded-lg" />
          );
        })()
      ) : null}
      {review.favoriteCharacter ? (
        <p className="mt-1.5 text-[11px] text-muted-2">Fav character: <span className="text-ink">{review.favoriteCharacter}</span></p>
      ) : null}
      {review.favoriteTracks && review.favoriteTracks.length > 0 ? (
        <p className="mt-0.5 text-[11px] text-muted-2">Fav tracks: <span className="text-ink">{review.favoriteTracks.join(", ")}</span></p>
      ) : null}
      {review.tags.length > 0 ? (
        <div className="mt-auto flex flex-wrap gap-1 pt-2.5">
          {review.tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
      {review.reactions && review.reactions.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1">
          {review.reactions.map((reaction) => (
            <span key={reaction.emoji} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted">
              {reaction.emoji} {reaction.count}
            </span>
          ))}
        </div>
      ) : null}
      {review.commentCount ? (
        <p className="mt-1 text-[10px] text-muted-2">{review.commentCount} comment{review.commentCount === 1 ? "" : "s"}</p>
      ) : null}
      <ReviewEngagement
        ratingId={review.id}
        initialReactions={review.reactions ?? []}
        initialCommentCount={review.commentCount ?? 0}
      />
    </article>
  );
}

export function PodRow({
  pod,
}: {
  pod: {
    id: string;
    title: string;
    slug: string;
    description: string | null;
    count: number;
    ownerUsername: string;
    items: Array<{ id: string; kind: MediaKind; title: string }>;
  };
}) {
  return (
    <Link
      href={`/${pod.ownerUsername}/${pod.slug}`}
      className="flex w-[230px] shrink-0 flex-col gap-2.5 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-3 transition-colors hover:border-white/15"
    >
      <div className="flex gap-1.5">
        {pod.items.slice(0, 3).map((item) => (
          <MediaArt key={item.id} kind={item.kind} title={item.title} className="aspect-square flex-1 rounded-md border-0" />
        ))}
      </div>
      <div>
        <p className="truncate text-sm font-semibold text-ink">{pod.title}</p>
        <p className="truncate text-[11px] text-muted-2">
          {pod.count} {pod.count === 1 ? "item" : "items"}
          {pod.description ? ` · ${pod.description}` : ""}
        </p>
      </div>
    </Link>
  );
}

/* ------------------------------------------------------------------ */
/* misc                                                                */
/* ------------------------------------------------------------------ */