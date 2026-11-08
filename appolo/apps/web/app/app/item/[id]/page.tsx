import Link from "next/link";
import { notFound } from "next/navigation";
import { MEDIA_KIND_LABELS, MEDIA_KIND_SINGULAR, scoreBand } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { getCatalogItem, getRating, creditsForItem, isWatchlisted, similarItems } from "@/lib/services/rankings";
import { itemCommunity } from "@/lib/services/social";
import { MediaArt, mediaHue } from "@/components/media-art";
import { Icon, RatingCurve, ReviewCard, ScoreText } from "@/components/podiums";
import { ItemActions } from "@/components/item-actions";
import { WatchlistButton } from "@/components/watchlist-button";
import { AddToPod } from "@/components/add-to-pod";
import { KindIcon, isAnime } from "@/components/kind-icon";
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

  const [community, rating, credits, watching, similar] = await Promise.all([
    itemCommunity(item.id, 12, session.org.id),
    getRating(session.org.id, item.id),
    creditsForItem(item.id),
    isWatchlisted(session.org.id, item.id),
    similarItems(item.id, 8),
  ]);

  const hue = mediaHue(item.title);
  const spotify = item.links.spotify;
  const displayScore = community.average ?? rating?.score ?? null;
  const band = displayScore === null ? null : scoreBand(displayScore);
  const anime = isAnime(item.kind, item.genres);

  return (
    <div className="relative">
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[520px]"
        style={{
          background: `radial-gradient(90% 60% at 50% 0%, hsl(${hue} 70% 38% / 0.55) 0%, hsl(${(hue + 40) % 360} 65% 18% / 0.4) 42%, transparent 78%)`,
        }}
        aria-hidden
      />
      <div
        className="pointer-events-none absolute left-1/2 top-6 h-64 w-64 -translate-x-1/2 rounded-full blur-3xl"
        style={{ background: `hsl(${hue} 75% 50% / 0.22)` }}
        aria-hidden
      />

      <div className="relative px-5 pt-4">
        <div className="flex items-center justify-between">
          <BackButton fallback="/app/browse" />
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-black/35 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-white/80 backdrop-blur">
            <KindIcon kind={anime ? "anime" : item.kind} className="h-3.5 w-3.5" />
            {anime ? "Anime" : MEDIA_KIND_LABELS[item.kind]}
          </span>
        </div>

        <div className="mt-6 flex justify-center">
          <MediaArt
            kind={item.kind}
            title={item.title}
            imageUrl={item.imageUrl}
            genres={item.genres}
            className="aspect-square w-[236px] rounded-3xl shadow-[0_30px_70px_-25px_rgba(0,0,0,0.95)] ring-1 ring-white/15"
          />
        </div>

        <div className="mt-6 text-center">
          <h1 className="text-[30px] font-bold leading-[1.05] tracking-[-0.03em] text-ink text-balance">
            {item.title}
          </h1>
          <p className="mt-1.5 text-[13px] text-muted">
            {[item.subtitle, anime ? "Anime" : MEDIA_KIND_SINGULAR[item.kind], item.year ? String(item.year) : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          <ItemActions title={item.title} itemId={item.id} />
          <WatchlistButton itemId={item.id} initial={watching} />
          <AddToPod itemId={item.id} />
        </div>

        <div className="mt-6 overflow-hidden rounded-3xl border border-white/[0.07] bg-[#111113] p-4 shadow-card">
          <div className="flex items-end justify-between">
            <div>
              <div className="flex items-baseline gap-1">
                <span className="text-[40px] font-bold leading-none tracking-[-0.03em] text-ink">
                  {displayScore === null ? "—" : displayScore.toFixed(1)}
                </span>
                <span className="text-sm text-muted-2">/10</span>
              </div>
              <p className="mt-1.5 text-[10px] uppercase tracking-[0.14em] text-muted-2">
                {band ? band.label : "Avg rating"}
              </p>
            </div>
            <div className="text-right">
              <span className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-muted">
                {community.count} {community.count === 1 ? "rating" : "ratings"}
              </span>
              {rating ? (
                <p className="mt-2 text-[12px] font-semibold text-brand">You: {rating.score.toFixed(1)}</p>
              ) : (
                <Link href={`/app/rate/${item.id}`} className="mt-2 inline-block text-[12px] font-semibold text-brand hover:underline">
                  Rate it →
                </Link>
              )}
            </div>
          </div>

          <RatingCurve distribution={community.distribution} className="mt-4" />
          <div className="flex justify-between text-[10px] text-muted-2">
            <span>0</span>
            <span>5</span>
            <span>10</span>
          </div>
        </div>

        <section className="mt-7">
          <h2 className="text-[15px] font-semibold text-ink">Overview</h2>
          {item.tags.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {item.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] text-ink">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
          {item.genres.length > 0 ? (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {item.genres.map((genre) => (
                <Link
                  key={genre}
                  href={`/app/browse?kind=${item.kind}&genre=${encodeURIComponent(genre)}`}
                  className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] text-brand transition-colors hover:bg-brand/20"
                >
                  {genre}
                </Link>
              ))}
            </div>
          ) : null}
          {item.description ? (
            <p className="mt-3 text-[13px] leading-relaxed text-muted">{item.description}</p>
          ) : (
            <p className="mt-3 text-[13px] text-muted-2">No overview yet.</p>
          )}
          <div className="mt-3 flex flex-wrap gap-4">
            {spotify ? (
              <a
                href={spotify}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 text-[13px] font-medium text-ink hover:text-brand"
              >
                Listen in Spotify <Icon name="spotify" className="h-4 w-4" />
              </a>
            ) : null}
            {item.trailerUrl ? (
              <a
                href={item.trailerUrl}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-2 text-[13px] font-medium text-ink hover:text-brand"
              >
                Watch trailer
              </a>
            ) : null}
          </div>
        </section>

        {credits.length > 0 ? (
          <section className="mt-6">
            <h2 className="text-[15px] font-semibold text-ink">Cast & crew</h2>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {credits.map((credit) => (
                <Link
                  key={credit.id}
                  href={`/app/person/${credit.personSlug}`}
                  className="rounded-full border border-white/15 bg-white/[0.06] px-2.5 py-1 text-[11px] text-ink transition-colors hover:bg-white/10"
                >
                  {credit.personName}
                  {credit.character ? <span className="text-muted-2"> - {credit.character}</span> : null}
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {similar.length > 0 ? (
          <section className="mt-6">
            <h2 className="text-[15px] font-semibold text-ink">More like this</h2>
            <div className="snap-rail no-scrollbar -mx-5 mt-2.5 flex gap-3 overflow-x-auto px-5 pb-1">
              {similar.map((entry) => (
                <Link key={entry.id} href={`/app/item/${entry.id}`} className="w-[104px] shrink-0">
                  <MediaArt kind={entry.kind} title={entry.title} imageUrl={entry.imageUrl} genres={entry.genres} className="aspect-square w-full rounded-xl" />
                  <p className="mt-1.5 truncate text-[12px] font-medium text-ink">{entry.title}</p>
                  <p className="truncate text-[10px] text-muted-2">
                    {entry.average === null ? "Unrated" : `${entry.average.toFixed(1)} avg`}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

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
          <div className="flex items-end justify-between">
            <h2 className="text-[15px] font-semibold text-ink">Reviews</h2>
            <span className="text-[11px] text-muted-2">{community.count} ratings</span>
          </div>
          {community.reviews.length === 0 ? (
            <p className="card-surface mt-3 rounded-2xl p-4 text-[13px] text-muted">
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

      <div className="fixed inset-x-0 bottom-[76px] z-20 mx-auto w-full max-w-[560px] px-5">
        <Link
          href={`/app/rate/${item.id}`}
          className="flex h-12 items-center justify-center rounded-full bg-gradient-to-b from-white to-white/90 text-[15px] font-semibold text-black shadow-[0_18px_40px_-16px_rgba(255,255,255,0.35)] transition-transform active:scale-[0.99]"
        >
          {rating ? "Update your rating" : "Rate this"}
        </Link>
      </div>
    </div>
  );
}
