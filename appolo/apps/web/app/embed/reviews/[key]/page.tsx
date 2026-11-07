import { notFound } from "next/navigation";
import { getPublicWidget } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";
export const metadata = { title: "Reviews" };

function initials(name: string | null): string {
  if (!name) return "★";
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export default async function ReviewWidgetPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  const widget = await getPublicWidget(key);
  if (!widget) notFound();

  const { config, reviews, aggregate, orgName } = widget;
  const dark = config.theme === "dark";
  const surface = dark ? "#0b0f19" : "#ffffff";
  const ink = dark ? "#f8fafc" : "#0f172a";
  const muted = dark ? "#94a3b8" : "#64748b";
  const border = dark ? "rgba(148,163,184,0.22)" : "#e2e8f0";
  const card = dark ? "rgba(148,163,184,0.08)" : "#f8fafc";

  return (
    <div style={{ background: surface, color: ink, fontFamily: "system-ui, sans-serif", padding: 16 }}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "LocalBusiness",
            name: orgName,
            ...(aggregate.count > 0
              ? {
                  aggregateRating: {
                    "@type": "AggregateRating",
                    ratingValue: aggregate.average,
                    reviewCount: aggregate.count,
                    bestRating: 5,
                    worstRating: 1,
                  },
                }
              : {}),
          }),
        }}
      />
      <div style={{ textAlign: "center", marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 18, fontWeight: 600 }}>{config.headline}</p>
        <p style={{ margin: "4px 0 0", fontSize: 13, color: muted }}>
          {orgName}
          {config.showRating && aggregate.count > 0
            ? ` · ${aggregate.average.toFixed(1)} ★ from ${aggregate.count} reviews`
            : ""}
        </p>
      </div>

      {reviews.length === 0 ? (
        <p style={{ textAlign: "center", color: muted, fontSize: 14 }}>No reviews to show yet.</p>
      ) : (
        <div
          style={{
            display: "grid",
            gap: 12,
            gridTemplateColumns: config.layout === "list" ? "1fr" : "repeat(auto-fit, minmax(220px, 1fr))",
          }}
        >
          {reviews.map((review) => (
            <figure
              key={review.id}
              style={{
                margin: 0,
                padding: 14,
                borderRadius: 12,
                border: `1px solid ${border}`,
                background: card,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: "9999px",
                    background: "#6366f1",
                    color: "#fff",
                    display: "grid",
                    placeItems: "center",
                    fontSize: 12,
                    fontWeight: 700,
                  }}
                >
                  {initials(review.authorName)}
                </div>
                <div style={{ minWidth: 0 }}>
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{review.authorName ?? "Anonymous"}</p>
                  <p style={{ margin: 0, fontSize: 12, color: "#f59e0b" }}>
                    {"★".repeat(Math.round(review.rating))}
                    <span style={{ color: muted }}>{"★".repeat(Math.max(0, 5 - Math.round(review.rating)))}</span>
                  </p>
                </div>
                <span style={{ marginLeft: "auto", fontSize: 11, color: muted }}>
                  {new Date(review.reviewedAt).toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                </span>
              </div>
              {review.body ? (
                <blockquote style={{ margin: "10px 0 0", fontSize: 13, color: muted, lineHeight: 1.5 }}>
                  {review.body}
                </blockquote>
              ) : null}
              {review.platformName ? (
                <figcaption style={{ marginTop: 8, fontSize: 11, color: muted }}>via {review.platformName}</figcaption>
              ) : null}
            </figure>
          ))}
        </div>
      )}
    </div>
  );
}