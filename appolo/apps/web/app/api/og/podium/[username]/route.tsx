import { ImageResponse } from "next/og";
import { topFive } from "@/lib/services/rankings";
import { getProfileByUsername } from "@/lib/services/social-graph";
import {
  AvatarBubble,
  OG_COLORS,
  OgFrame,
  ogViewport,
  truncate,
} from "@/lib/og";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ username: string }> };

/**
 * Share card for a profile's podium.
 *
 *   /api/og/podium/ava            1200×630 link preview
 *   /api/og/podium/ava?format=story  1080×1920 portrait
 */
export async function GET(request: Request, { params }: Params) {
  const { username } = await params;
  const viewport = ogViewport(new URL(request.url).searchParams.get("format"));
  const profile = await getProfileByUsername(decodeURIComponent(username));
  if (!profile) return new Response("Not found", { status: 404 });

  const items = await topFive(profile.orgId);
  const { story } = viewport;

  return new ImageResponse(
    (
      <OgFrame viewport={viewport} eyebrow="Podium">
        <div style={{ display: "flex", alignItems: "center", gap: story ? 28 : 16 }}>
          <AvatarBubble name={profile.displayName} hue={profile.avatarHue} size={story ? 108 : 64} />
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <div style={{ display: "flex", fontSize: story ? 56 : 32, fontWeight: 800, lineHeight: 1.05 }}>
              {truncate(profile.displayName, 32)}
            </div>
            <div style={{ display: "flex", fontSize: story ? 28 : 18, color: OG_COLORS.muted }}>
              @{profile.username}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: story ? 64 : 20, gap: story ? 28 : 9 }}>
          {items.length === 0 ? (
            <div style={{ display: "flex", fontSize: story ? 40 : 26, color: OG_COLORS.muted }}>
              No ranked titles yet.
            </div>
          ) : (
            items.map((item, index) => (
              <div
                key={item.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: story ? 28 : 14,
                  padding: story ? "22px 28px" : "9px 16px",
                  borderRadius: 20,
                  backgroundColor: index === 0 ? "rgba(16,185,129,0.14)" : OG_COLORS.panel,
                  border: `1px solid ${index === 0 ? "rgba(16,185,129,0.5)" : "rgba(255,255,255,0.06)"}`,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: story ? 62 : 38,
                    height: story ? 62 : 38,
                    borderRadius: 12,
                    backgroundColor: index === 0 ? OG_COLORS.brand : "rgba(255,255,255,0.08)",
                    color: index === 0 ? "#06210f" : OG_COLORS.ink,
                    fontSize: story ? 34 : 20,
                    fontWeight: 800,
                  }}
                >
                  {index + 1}
                </div>
                <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
                  <div style={{ display: "flex", fontSize: story ? 38 : 21, fontWeight: 700, lineHeight: 1.1 }}>
                    {truncate(item.title, 34)}
                  </div>
                  <div style={{ display: "flex", fontSize: story ? 24 : 14, color: OG_COLORS.muted }}>
                    {truncate([item.subtitle, item.year ? String(item.year) : null].filter(Boolean).join(" · "), 46)}
                  </div>
                </div>
                <div style={{ display: "flex", fontSize: story ? 44 : 24, fontWeight: 800, color: OG_COLORS.brand }}>
                  {item.score.toFixed(1)}
                </div>
              </div>
            ))
          )}
        </div>
      </OgFrame>
    ),
    { width: viewport.width, height: viewport.height },
  );
}
