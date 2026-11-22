import Link from "next/link";
import { MEDIA_KIND_LABELS, scoreBand } from "@appolo/core";
import { videoEmbed } from "@/lib/video-embed";
import { REVIEW_FIELD_COPY } from "@/lib/review-copy";
import type { ReviewView } from "@/lib/services/social";
import { MediaArt } from "./media-art";
import { Avatar, Icon, ScoreText } from "./podiums";
import { ReviewEngagement } from "./review-engagement";
import { ReviewBody } from "./review-body";
import { ReportButton } from "./report-button";
import { ShareButton } from "./share-button";

/** The full, shareable view of a single review. */
export function ReviewScreen({
  review,
  viewerOrgId = null,
  backHref,
}: {
  review: ReviewView;
  viewerOrgId?: string | null;
  backHref?: string;
}) {
  const band = scoreBand(review.score);
  const video = review.videoUrl ? videoEmbed(review.videoUrl) : null;

  return (
    <div className="px-5 pt-6">
      {backHref ? (
        <Link href={backHref} className="text-xs text-muted-2 hover:text-ink">
          ← Back
        </Link>
      ) : null}

      <article className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.04] p-4">
        <div className="flex items-center gap-2.5">
          <Link href={`/${review.username}`} aria-label={`View ${review.displayName}'s profile`} className="shrink-0">
            <Avatar name={review.displayName} hue={review.avatarHue} size={40} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={`/${review.username}`} className="block truncate text-[14px] font-semibold text-ink hover:underline">
              {review.displayName}
            </Link>
            <p className="truncate text-[11px] text-muted-2">{`@${review.username}`}</p>
          </div>
          <div className="flex items-center gap-3">
            {viewerOrgId && viewerOrgId !== review.orgId ? (
              <ReportButton contentType="review" contentId={review.id} />
            ) : null}
            <ShareButton
              title={`${review.displayName} on ${review.itemTitle}`}
              path={`/review/${review.id}`}
              imagePath={`/api/og/review/${review.id}`}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/25 p-3">
          <Link href={`/app/item/${review.itemId}`} aria-label={`View ${review.itemTitle}`} className="shrink-0">
            <MediaArt kind={review.kind} title={review.itemTitle} imageUrl={review.imageUrl} sizes="64px" className="h-16 w-16 rounded-lg" />
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={`/app/item/${review.itemId}`} className="block truncate text-[14px] font-semibold text-ink hover:underline">
              {review.itemTitle}
            </Link>
            <p className="truncate text-[11px] text-muted-2">
              {review.itemSubtitle || MEDIA_KIND_LABELS[review.kind]}
              {review.year ? ` · ${review.year}` : ""}
            </p>
            <p className="mt-1 text-[11px] text-muted-2">{band.label}</p>
          </div>
          <div className="text-right">
            <ScoreText score={review.score} className="text-[24px]" />
            <p className="text-[9px] uppercase tracking-[0.14em] text-muted-2">/10</p>
          </div>
        </div>

        {review.text ? (
          <ReviewBody text={review.text} spoiler={review.spoiler} className="mt-4 text-[14px]" />
        ) : (
          <p className="mt-4 text-[13px] text-muted-2">Rated without a written note.</p>
        )}

        {review.photoUrl ? (
          <img src={review.photoUrl} alt="" className="mt-3 max-h-80 w-full rounded-xl object-cover" />
        ) : null}

        {video ? (
          video.kind === "iframe" ? (
            <iframe
              src={video.src}
              title="Your review video"
              className="mt-3 aspect-video w-full rounded-xl"
              allowFullScreen
            />
          ) : (
            // The clip is chosen by the reviewer; there is no caption file to attach.
            // eslint-disable-next-line jsx-a11y/media-has-caption
            <video src={video.src} controls className="mt-3 w-full rounded-xl" />
          )
        ) : null}

        {review.favoriteCharacter ? (
          <p className="mt-3 text-[12px] text-muted-2">
            Favourite character: <span className="text-ink">{review.favoriteCharacter}</span>
          </p>
        ) : null}

        {review.favoriteTracks.length > 0 ? (
          <p className="mt-1 text-[12px] text-muted-2">
            {REVIEW_FIELD_COPY[review.kind].favorites}:{" "}
            <span className="text-ink">{review.favoriteTracks.join(", ")}</span>
          </p>
        ) : null}

        {review.highlights && review.highlights.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {review.highlights.map((highlight) => (
              <span key={highlight} className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] text-brand">
                {highlight}
              </span>
            ))}
          </div>
        ) : null}

        {review.subScores && Object.keys(review.subScores).length > 0 ? (
          <div className="mt-3 space-y-1.5">
            {Object.entries(review.subScores).map(([name, value]) => (
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

        {review.tags.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {review.tags.map((tag) => (
              <span key={tag} className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-muted">
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        <ReviewEngagement
          ratingId={review.id}
          viewerOrgId={viewerOrgId}
          initialReactions={review.reactions}
          initialCommentCount={review.commentCount}
        />
      </article>

      <div className="mt-5 flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div>
          <p className="text-[13px] font-medium text-ink">Rank it yourself</p>
          <p className="text-[11px] text-muted-2">Your score is personal — compare two at a time.</p>
        </div>
        <Link
          href={`/app/rate/${review.itemId}`}
          className="flex items-center gap-1 rounded-full bg-white px-4 py-2 text-[12px] font-semibold text-black"
        >
          Rate <Icon name="back" className="h-3.5 w-3.5 rotate-180" />
        </Link>
      </div>
    </div>
  );
}
