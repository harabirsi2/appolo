import Link from "next/link";
import { MEDIA_KIND_LABELS, scoreBand } from "@appolo/core";
import { videoEmbed } from "@/lib/video-embed";
import type { ReviewView } from "@/lib/services/social";
import { MediaArt } from "./media-art";
import { Avatar, Icon, ScoreText } from "./podiums";
import { ReviewEngagement } from "./review-engagement";
import { SpoilerText } from "./spoiler-text";
import { ShareButton } from "./share-button";

/** The full, shareable view of a single review. */
export function ReviewScreen({
  review,
  backHref,
}: {
  review: ReviewView;
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
          <Link href={`/${review.username}`} className="shrink-0">
            <Avatar name={review.displayName} hue={review.avatarHue} size={40} />
          </Link>
          <div className="min-w-0 flex-1">
            <Link href={`/${review.username}`} className="block truncate text-[14px] font-semibold text-ink hover:underline">
              {review.displayName}
            </Link>
            <p className="truncate text-[11px] text-muted-2">{`@${review.username}`}</p>
          </div>
          <ShareButton title={`${review.displayName} on ${review.itemTitle}`} path={`/review/${review.id}`} />
        </div>

        <div className="mt-4 flex items-center gap-3 rounded-xl border border-white/[0.06] bg-black/25 p-3">
          <Link href={`/app/item/${review.itemId}`} className="shrink-0">
            <MediaArt kind={review.kind} title={review.itemTitle} sizes="64px" className="h-16 w-16 rounded-lg" />
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
          <SpoilerText
            text={review.text}
            spoiler={review.spoiler}
            className="mt-4 whitespace-pre-line text-[14px] leading-relaxed text-muted"
          />
        ) : (
          <p className="mt-4 text-[13px] text-muted-2">Rated without a written note.</p>
        )}

        {review.photoUrl ? (
          <img src={review.photoUrl} alt="" className="mt-3 max-h-80 w-full rounded-xl object-cover" />
        ) : null}

        {video ? (
          video.kind === "iframe" ? (
            <iframe src={video.src} className="mt-3 aspect-video w-full rounded-xl" allowFullScreen />
          ) : (
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
            Favourite tracks: <span className="text-ink">{review.favoriteTracks.join(", ")}</span>
          </p>
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
