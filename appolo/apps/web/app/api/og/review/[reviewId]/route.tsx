import { ImageResponse } from "next/og";
import { reviewById } from "@/lib/services/social";
import {
  AvatarBubble,
  OG_COLORS,
  OgFrame,
  ogViewport,
  truncate,
} from "@/lib/og";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ reviewId: string }> };

/**
 * Share card for a single review.
 *
 *   /api/og/review/<ratingId>
 *   /api/og/review/<ratingId>?format=story
 */
export async function GET(request: Request, { params }: Params) {
  const { reviewId } = await params;
  const viewport = ogViewport(new URL(request.url).searchParams.get("format"));
  const review = await reviewById(reviewId);
  if (!review) return new Response("Not found", { status: 404 });
  const { story } = viewport;
  // Spoiler text never lands on a share card; the reader has to open the review.
  const body = review.spoiler
    ? "This review is marked as a spoiler. Tap through to reveal it."
    : review.text
      ? truncate(review.text, story ? 520 : 200)
      : "Rated without a written note.";

  return new ImageResponse(
    (
      <OgFrame viewport={viewport} eyebrow="Review">
        <div style={{ display: "flex", alignItems: "center", gap: story ? 24 : 16 }}>
          <AvatarBubble name={review.displayName} hue={review.avatarHue} size={story ? 84 : 58} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", fontSize: story ? 36 : 24, fontWeight: 700 }}>
              {truncate(review.displayName, 28)}
            </div>
            <div style={{ display: "flex", fontSize: story ? 24 : 16, color: OG_COLORS.muted }}>
              @{review.username}
            </div>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: story ? 44 : 26, gap: 20 }}>
          <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", fontSize: story ? 54 : 34, fontWeight: 800, lineHeight: 1.1 }}>
              {truncate(review.itemTitle, 40)}
            </div>
            <div style={{ display: "flex", fontSize: story ? 26 : 18, color: OG_COLORS.muted }}>
              {truncate([review.itemSubtitle, review.year ? String(review.year) : null].filter(Boolean).join(" · "), 48)}
            </div>
          </div>
          <div style={{ display: "flex", fontSize: story ? 96 : 64, fontWeight: 900, color: OG_COLORS.brand }}>
            {review.score.toFixed(1)}
          </div>
        </div>

        <div
          style={{
            display: "flex",
            marginTop: story ? 40 : 22,
            padding: story ? "28px 32px" : "16px 22px",
            borderRadius: 20,
            backgroundColor: OG_COLORS.panel,
            border: `1px solid ${review.spoiler ? "rgba(248,113,113,0.35)" : "rgba(255,255,255,0.06)"}`,
            fontSize: story ? 32 : 20,
            lineHeight: 1.45,
            color: review.spoiler ? OG_COLORS.danger : OG_COLORS.ink,
          }}
        >
          {review.spoiler ? "Spoiler · " : ""}
          {body}
        </div>
      </OgFrame>
    ),
    { width: viewport.width, height: viewport.height },
  );
}