import Link from "next/link";
import { notFound } from "next/navigation";
import { MEDIA_KIND_LABELS, MEDIA_KIND_SINGULAR } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { getCatalogItem, getRating } from "@/lib/services/rankings";
import { itemCommunity } from "@/lib/services/social";
import { MediaArt, mediaHue } from "@/components/media-art";
import { Icon, RatingCurve, ReviewCard, ScoreText } from "@/components/podiums";
import { ItemActions } from "@/components/item-actions";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const item = await getCatalogItem(id);
  return { title: item ? item.title : "Item" };
}

export default async function ItemPage({ params }: Params) {
  const session = await requireSession();
  const { id } = await params;
  const item = await getCatalogItem(id);
  if (!item) notFound();

  const [community, rating] = await Promise.all([
    itemCommunity(item.id),
    getRating(session.org.id, item.id),
  ]);

  const hue = mediaHue(item.title);
  const spotify = item.links.spotify;
  const displayScore = community.average ?? rating?.score ?? null;

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[420px]"
        style={{
          background: `radial-gradient(120% 70% at 50% 0%, hsl(${hue} 70% 34% / 0.55) 0%, hsl(${(hue + 40) % 360} 65% 16% / 0.35) 45%, transparent 75%)`,
        }}
        aria-hidden
      />

      <div className="relative px-5 pt-4">
        <div className="flex items-center justify-between">
          <BackButton fallback="/app/search" />
          <span className="rounded-full bg-black/35 px-3 py-1 text-[11px] font-medium text-white/80 backdrop-blur">
            {MEDIA_KIND_LABELS[item.kind]}
          </span>
        </div>

        <div className="mt-5 flex justify-center">
          <MediaArt kind={item.kind} title={item.title} className="aspect-square w-[248px] rounded-2xl shadow-2xl" />
        </div>

        <h1 className="mt-6 text-[28px] font-bold leading-tight tracking-tight text-ink">{item.title}</h1>
        <p className="mt-1 text-[13px] text-muted">
          {[item.subtitle, MEDIA_KIND_SINGULAR[item.kind], item.year ? String(item.year) : null]
            .filter(Boolean)
            .join(" · ")}
        </p>

        <ItemActions title={item.title} itemId={item.id} />

        <div className="mt-6 rounded-2xl border border-white/[0.06] bg-[#141416] px-4 pb-3 pt-4">
          <div className="flex items-end justify-between">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-[32px] font-bold leading-none tracking-tight text-ink">
                  {displayScore === null ? "—" : displayScore.toFixed(1)}
                </span>
                <span className="text-sm text-muted-2">/10</span>
              </div>
              <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-2">Avg rating</p>
            </div>
            <div className="text-right">
              <p className="text-[11px] text-muted-2">
                {community.count} {community.count === 1 ? "rating" : "ratings"}
              </p>
              {rating ? (
                <p className="mt-1 text-[11px] text-brand">
                  You: {rating.score.toFixed(1)}
                </p>
              ) : (
                <Link href={`/app/rate/${item.id}`} className="mt-1 inline-block text-[11px] text-brand hover:underline">
                  Rate it →
                </Link>
              )}
            </div>
          </div>

          <RatingCurve distribution={community.distribution} className="mt-3" />
          <div className="flex justify-between text-[10px] text-muted-2">
            <span>0</span>
            <span>5</span>
            <span>10</span>
          </div>
        </div>

        <section className="mt-6">
          <h2 className="text-[15px] font-semibold text-ink">Overview</h2>
          {item.tags.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span
                  key={tag}
                  className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] text-ink"
                >
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {item.description ? (
            <p className="mt-3 text-[13px] leading-relaxed text-muted">{item.description}</p>
          ) : (
            <p className="mt-3 text-[13px] text-muted-2">No overview yet.</p>
          )}
          {spotify ? (
            <a
              href={spotify}
              target="_blank"
              rel="noreferrer noopener"
              className="mt-3 inline-flex items-center gap-2 text-[13px] font-medium text-ink hover:text-brand"
            >
              Listen in Spotify <Icon name="spotify" className="h-4 w-4" />
            </a>
          ) : null}
        </section>

        {rating && (rating.reviewText || rating.reviewTags.length > 0) ? (
          <section className="mt-6 rounded-2xl border border-brand/25 bg-brand/[0.07] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-ink">Your review</h2>
              <ScoreText score={rating.score} />
            </div>
            {rating.reviewText ? (
              <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-muted">{rating.reviewText}</p>
            ) : null}
            {rating.reviewTags.length > 0 ? (
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {rating.reviewTags.map((tag) => (
                  <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </section>
        ) : null}

        <section className="mt-7 pb-24">
          <h2 className="text-[15px] font-semibold text-ink">Reviews</h2>
          {community.reviews.length === 0 ? (
            <p className="mt-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">
              No reviews yet. Be the first to say something.
            </p>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {community.reviews.map((review) => (
                <ReviewCard key={review.id} review={review} />
              ))}
            </div>
          )}
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-[74px] z-20 mx-auto w-full max-w-[560px] px-5">
        <Link
          href={`/app/rate/${item.id}`}
          className="flex h-12 items-center justify-center rounded-full bg-white text-[15px] font-semibold text-black shadow-lg transition-transform active:scale-[0.99]"
        >
          {rating ? "Update your rating" : "Rate this"}
        </Link>
      </div>
    </div>
  );
}