import type { ReactNode } from "react";

/**
 * Shared look for the social share cards.
 *
 * `format=story` produces the 1080×1920 portrait card for stories and Reels;
 * everything else gets the 1200×630 link-preview card. Both are drawn with
 * satori (`next/og`), so only flex layouts and inline styles are safe here.
 */
export const OG_COLORS = {
  bg: "#07080A",
  panel: "#111318",
  ink: "#F2F4F8",
  muted: "#949BA8",
  faint: "#71717a",
  brand: "#10B981",
  brandDeep: "#059669",
  danger: "#ef4444",
  clash: "#e879f9",
} as const;

export interface OgViewport {
  width: number;
  height: number;
  story: boolean;
}

export function ogViewport(format: string | null | undefined): OgViewport {
  if (format === "story" || format === "portrait" || format === "9:16") {
    return { width: 1080, height: 1920, story: true };
  }
  return { width: 1200, height: 630, story: false };
}

export function truncate(value: string, max: number): string {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase() ?? "")
      .join("") || "?"
  );
}

/** Full-bleed dark card with the brand glow and a small footer attribution. */
export function OgFrame({
  viewport,
  eyebrow,
  children,
}: {
  viewport: OgViewport;
  eyebrow: string;
  children: ReactNode;
}) {
  const { story } = viewport;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: story ? 80 : 56,
        backgroundColor: OG_COLORS.bg,
        backgroundImage: "radial-gradient(circle at 18% 8%, rgba(74,222,128,0.22), transparent 42%), radial-gradient(circle at 88% 92%, rgba(232,121,249,0.16), transparent 46%)",
        color: OG_COLORS.ink,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 18, flexShrink: 0 }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: story ? 64 : 44,
            height: story ? 64 : 44,
            borderRadius: 16,
            backgroundColor: OG_COLORS.brand,
            color: "#06210f",
            fontSize: story ? 38 : 26,
            fontWeight: 900,
          }}
        >
          A
        </div>
        <div
          style={{
            display: "flex",
            fontSize: story ? 26 : 20,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: OG_COLORS.muted,
            fontWeight: 600,
          }}
        >
          {eyebrow}
        </div>
      </div>

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          minHeight: 0,
          overflow: "hidden",
          justifyContent: "center",
          paddingTop: story ? 48 : 20,
          paddingBottom: story ? 48 : 20,
        }}
      >
        {children}
      </div>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, fontSize: story ? 24 : 18, color: OG_COLORS.faint }}>
        <span style={{ display: "flex" }}>appolo</span>
        <span style={{ display: "flex" }}>Rank what you love</span>
      </div>
    </div>
  );
}

export function AvatarBubble({
  name,
  hue,
  size,
}: {
  name: string;
  hue: number;
  size: number;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: `hsl(${hue} 58% 42%)`,
        color: "#fff",
        fontSize: size * 0.4,
        fontWeight: 800,
      }}
    >
      {initials(name)}
    </div>
  );
}