import { ImageResponse } from "next/og";
import { compareTaste, getProfileByUsername } from "@/lib/services/social-graph";
import {
  AvatarBubble,
  OG_COLORS,
  OgFrame,
  ogViewport,
  truncate,
} from "@/lib/og";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ userA: string; userB: string }> };

/**
 * Share card for a taste clash.
 *
 *   /api/og/clash/ava/noah
 *   /api/og/clash/ava/noah?format=story
 */
export async function GET(request: Request, { params }: Params) {
  const { userA, userB } = await params;
  const viewport = ogViewport(new URL(request.url).searchParams.get("format"));
  const [a, b] = await Promise.all([
    getProfileByUsername(decodeURIComponent(userA)),
    getProfileByUsername(decodeURIComponent(userB)),
  ]);
  if (!a || !b) return new Response("Not found", { status: 404 });

  const comparison = await compareTaste(a.orgId, b.orgId);
  if (!comparison) return new Response("Not found", { status: 404 });
  const { story } = viewport;
  const match = Math.round(comparison.match);

  return new ImageResponse(
    (
      <OgFrame viewport={viewport} eyebrow="Taste clash">
        <div style={{ display: "flex", alignItems: "center", gap: story ? 22 : 14 }}>
          <AvatarBubble name={a.displayName} hue={a.avatarHue} size={story ? 88 : 60} />
          <div style={{ display: "flex", fontSize: story ? 34 : 22, fontWeight: 700 }}>
            @{truncate(a.username, 18)}
          </div>
          <div style={{ display: "flex", fontSize: story ? 34 : 22, color: OG_COLORS.clash, fontWeight: 800 }}>
            vs
          </div>
          <AvatarBubble name={b.displayName} hue={b.avatarHue} size={story ? 88 : 60} />
          <div style={{ display: "flex", fontSize: story ? 34 : 22, fontWeight: 700 }}>
            @{truncate(b.username, 18)}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", gap: story ? 24 : 16, marginTop: story ? 48 : 28 }}>
          <div style={{ display: "flex", fontSize: story ? 200 : 120, fontWeight: 900, lineHeight: 0.9, color: OG_COLORS.brand }}>
            {match}%
          </div>
          <div style={{ display: "flex", flexDirection: "column", paddingBottom: story ? 22 : 12 }}>
            <div style={{ display: "flex", fontSize: story ? 34 : 22, fontWeight: 700 }}>taste match</div>
            <div style={{ display: "flex", fontSize: story ? 26 : 18, color: OG_COLORS.muted }}>
              {comparison.confidence} confidence · {comparison.shared} shared
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: story ? 44 : 24, gap: story ? 18 : 10 }}>
          {comparison.clashes.slice(0, story ? 4 : 2).map((clash) => (
            <div
              key={clash.itemId}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: story ? "18px 24px" : "10px 18px",
                borderRadius: 16,
                backgroundColor: OG_COLORS.panel,
                border: "1px solid rgba(255,255,255,0.06)",
              }}
            >
              <div style={{ display: "flex", fontSize: story ? 32 : 21, fontWeight: 600, maxWidth: "68%" }}>
                {truncate(clash.title, 30)}
              </div>
              <div style={{ display: "flex", fontSize: story ? 30 : 20, fontWeight: 700 }}>
                <span style={{ color: OG_COLORS.brand }}>{clash.mine.toFixed(1)}</span>
                <span style={{ color: OG_COLORS.faint, padding: "0 8px" }}>/</span>
                <span style={{ color: OG_COLORS.clash }}>{clash.theirs.toFixed(1)}</span>
              </div>
            </div>
          ))}
          {comparison.clashes.length === 0 ? (
            <div style={{ display: "flex", fontSize: story ? 32 : 22, color: OG_COLORS.muted }}>
              {comparison.shared === 0
                ? "No shared titles to compare yet."
                : comparison.sharedFavorites.length > 0
                  ? `${comparison.sharedFavorites.length} shared favorites, no clashes.`
                  : `${comparison.shared} shared titles, none far apart.`}
            </div>
          ) : null}
        </div>
      </OgFrame>
    ),
    { width: viewport.width, height: viewport.height },
  );
}