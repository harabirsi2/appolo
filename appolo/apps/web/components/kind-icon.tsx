import { cn } from "@appolo/ui";
import type { MediaKind } from "@appolo/core/ranking";

export type KindGlyph = MediaKind | "anime";

/**
 * Anime is stored as a genre rather than a medium, but people treat it as its
 * own category, so titles tagged Anime get their own glyph instead of the TV one.
 */
export function isAnime(kind: MediaKind, genres?: readonly string[] | null): boolean {
  if (kind !== "tv" && kind !== "movie") return false;
  return (genres ?? []).some((genre) => genre.trim().toLowerCase() === "anime");
}

/** One distinct line icon per medium, used in chips, badges, and cover art. */
export function KindIcon({ kind, className }: { kind: KindGlyph; className?: string }) {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className: cn("h-4 w-4", className),
    "aria-hidden": true,
  };

  switch (kind) {
    case "movie":
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="2" />
          <path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4" />
        </svg>
      );
    case "tv":
      return (
        <svg {...common}>
          <rect x="3" y="7" width="18" height="12" rx="2.5" />
          <path d="m8 3 4 4 4-4" />
        </svg>
      );
    case "music":
      return (
        <svg {...common}>
          <path d="M9 17V6l10-2v11" />
          <circle cx="6.5" cy="17.5" r="2.5" />
          <circle cx="16.5" cy="15.5" r="2.5" />
        </svg>
      );
    case "podcast":
      return (
        <svg {...common}>
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0" />
          <path d="M12 18v3M8.5 21h7" />
        </svg>
      );
    case "book":
      return (
        <svg {...common}>
          <path d="M12 6c-2-1.6-4.4-2-7-2v14c2.6 0 5 .4 7 2 2-1.6 4.4-2 7-2V4c-2.6 0-5 .4-7 2Z" />
          <path d="M12 6v14" />
        </svg>
      );
    case "game":
      return (
        <svg {...common}>
          <path d="M7 8h10a4 4 0 0 1 3.9 3.1l.9 4.4A2.6 2.6 0 0 1 17 18l-1.6-2H8.6L7 18a2.6 2.6 0 0 1-4.8-2.5l.9-4.4A4 4 0 0 1 7 8Z" />
          <path d="M8 11v4M6 13h4M15.5 12h.01M17.5 14h.01" />
        </svg>
      );
    case "anime":
      return (
        <svg {...common}>
          <path d="m12 3 1.7 4.8 4.8 1.7-4.8 1.7L12 16l-1.7-4.8L5.5 9.5l4.8-1.7Z" />
          <path d="m18.5 14.5.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8Z" />
        </svg>
      );
  }
}
