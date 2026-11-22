import Link from "next/link";
import { notFound } from "next/navigation";
import { after } from "next/server";
import { MEDIA_KIND_LABELS, MEDIA_KIND_SINGULAR, scoreBand, scoreInterval, youtubeEmbedUrl } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { getCatalogItem, getRating, creditsForItem, isWatchlisted, similarItems } from "@/lib/services/rankings";
import { getRankingModel } from "@/lib/services/ranking-math";
import { explainPosition } from "@/lib/services/explain";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { itemCommunity } from "@/lib/services/social";
import { hydrateCatalogItem } from "@/lib/services/catalog-search";
import { MediaArt, mediaHue } from "@/components/media-art";
import { Icon, RatingCurve, ReviewCard, ScoreText } from "@/components/podiums";
import { ItemActions } from "@/components/item-actions";
import { WatchlistButton } from "@/components/watchlist-button";
import { AddToPod } from "@/components/add-to-pod";
import { KindIcon, isAnime } from "@/components/kind-icon";
import { BackButton } from "@/components/back-button";
import { ReviewBody } from "@/components/review-body";
import { TrailerModal } from "@/components/trailer-modal";

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

  const [community, rating, credits, watching, similar, model] = await Promise.all([
    itemCommunity(item.id, 12, session.org.id),
    getRating(session.org.id, item.id),
    creditsForItem(item.id),
    isWatchlisted(session.org.id, item.id),
    similarItems(item.id, 8),
    // The fitted model supplies the confidence interval; a missing snapshot
    // must not take the page down, so it degrades to no badge.
    getRankingModel(session.org.id, item.kind).catch(() => null),
  ]);

  // Only a rated title has a position to explain, and the drill-down reads the
  // matchup log, so it is skipped entirely for unrated catalog pages.
  const explanation = rating ? await explainPosition(session.org.id, item.id).catch(() => null) : null;
  const fit = model?.byId.get(item.id) ?? null;
  const interval = fit && model ? scoreInterval(fit, model.items, model.tieParameter) : null;
  const topMover = explanation?.movers[0] ?? null;

  const hue = mediaHue(item.title);
  const spotify = item.links.spotify;
  const displayScore = community.average ?? rating?.score ?? null;
  const band = displayScore === null ? null : scoreBand(displayScore);
  const anime = isAnime(item.kind, item.genres);
  const trailerEmbed = youtubeEmbedUrl(item.trailerUrl);
  const subScores = rating ? Object.entries(rating.subScores) : [];
  const highlights = rating?.highlights ?? [];

  // Provider-sourced rows arrive with search-level metadata only; fill in the
  // trailer, backdrop, cast and tracklist after the page has been served.
  if (item.source && item.metadata.hydrated !== true) {
    after(() => hydrateCatalogItem(item.id));
  }

  return (
    <div className="relative">
      {item.backdropUrl ? (
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[340px] overflow-hidden" aria-hidden>
          <img src={item.backdropUrl} alt="" className="h-full w-full object-cover opacity-40" />
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-black/65 to-black" />
        </div>
      ) : null}
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
            sizes="236px"
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

          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-[0.12em] text-muted-2">Community</p>
              <p className="mt-0.5 font-semibold text-ink">
                {item.bayesianScore === null ? "—" : item.bayesianScore.toFixed(1)}
                <span className="text-muted-2"> /10</span>
              </p>
              <p className="text-[10px] text-muted-2">
                Bayesian · {item.totalReviews} {item.totalReviews === 1 ? "rating" : "ratings"}
              </p>
            </div>
            <div className="rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-2">
              <p className="text-[9px] uppercase tracking-[0.12em] text-muted-2">You</p>
              <p className="mt-0.5 font-semibold text-brand">
                {rating ? rating.score.toFixed(1) : "—"}
                <span className="text-muted-2"> /10</span>
              </p>
              <p className="text-[10px] text-muted-2">
                {rating ? `${rating.wins}W · ${rating.losses}L` : "Not rated yet"}
              </p>
            </div>
          </div>

          {interval ? (
            <div className="mt-3 border-t border-white/[0.06] pt-2.5">
              <p className="mb-1 text-[9px] uppercase tracking-[0.12em] text-muted-2">Ranking model</p>
              <ConfidenceBadge interval={interval} />
            </div>
          ) : null}
        </div>

        {explanation ? (
          <Link
            href={`/app/item/${item.id}/why`}
            className="mt-3 flex items-center justify-between gap-3 rounded-2xl border border-white/[0.07] bg-white/[0.02] px-4 py-3 transition-colors hover:border-white/[0.14] hover:bg-white/[0.04]"
          >
            <div className="min-w-0">
              <p className="text-[9px] uppercase tracking-[0.12em] text-muted-2">
                Why it&apos;s #{explanation.position} in {MEDIA_KIND_LABELS[item.kind]}
              </p>
              <p className="mt-0.5 truncate text-[12px] text-muted">
                {topMover
                  ? `${topMover.result === "win" ? "Picked over" : topMover.result === "loss" ? "Lost to" : "Tied with"} ${topMover.opponentTitle} · ${topMover.delta >= 0 ? "+" : ""}${topMover.delta} Elo`
                  : `${explanation.countedMatchups} counted comparison${explanation.countedMatchups === 1 ? "" : "s"}`}
              </p>
            </div>
            <span className="shrink-0 text-[12px] font-semibold text-brand">See why →</span>
          </Link>
        ) : null}

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
            {trailerEmbed ? (
              <TrailerModal embedUrl={trailerEmbed} title={item.title} />
            ) : item.trailerUrl ? (
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
                  href={`/app/creator/${credit.personSlug}`}
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
                  <MediaArt kind={entry.kind} title={entry.title} imageUrl={entry.imageUrl} genres={entry.genres} sizes="104px" className="aspect-square w-full rounded-xl" />
                  <p className="mt-1.5 truncate text-[12px] font-medium text-ink">{entry.title}</p>
                  <p className="truncate text-[10px] text-muted-2">
                    {entry.average === null ? "Unrated" : `${entry.average.toFixed(1)} avg`}
                  </p>
                </Link>
              ))}
            </div>
          </section>
        ) : null}

        {rating && (rating.reviewText || rating.reviewTags.length > 0 || subScores.length > 0 || highlights.length > 0) ? (
          <section className="mt-6 rounded-2xl border border-brand/25 bg-brand/[0.07] p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-[13px] font-semibold text-ink">Your review</h2>
              <ScoreText score={rating.score} />
            </div>
            {rating.reviewText ? (
              <ReviewBody text={rating.reviewText} spoiler={rating.spoiler} className="mt-2" />
            ) : null}
            {highlights.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {highlights.map((highlight) => (
                  <span key={highlight} className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] text-brand">
                    {highlight}
                  </span>
                ))}
              </div>
            ) : null}
            {subScores.length > 0 ? (
              <div className="mt-3 space-y-1.5">
                {subScores.map(([name, value]) => (
                  <div key={name} className="flex items-center gap-2">
                    <span className="w-20 shrink-0 truncate text-[11px] capitalize text-muted-2">{name}</span>
                    <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/10">
                      <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, value * 10)}%` }} />
                    </span>
                    <span className="w-8 shrink-0 text-right text-[11px] text-ink">{value.toFixed(1)}</span>
                  </div>
                ))}
              </div>
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
