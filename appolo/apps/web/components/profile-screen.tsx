import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@appolo/ui";
import { MEDIA_KIND_LABELS } from "@appolo/core";
import type { ProfileBundle } from "@/lib/services/social";
import { MediaArt } from "./media-art";
import { Avatar, PodRow, ScoreText } from "./podiums";
import { FollowButton } from "./follow-button";
import { ShareButton } from "./share-button";

const RANKS = ["1", "2", "3", "4", "5"];

export function ProfileScreen({
  bundle,
  viewerOrgId,
  following,
  footer,
  backHref,
}: {
  bundle: ProfileBundle;
  viewerOrgId: string | null;
  following: boolean;
  footer?: ReactNode;
  backHref?: string;
}) {
  const { profile, ratings, topFive, pods } = bundle;
  const isSelf = viewerOrgId === profile.orgId;

  return (
    <div className="px-5 pt-6">
      {backHref ? (
        <Link href={backHref} className="text-xs text-muted-2 hover:text-ink">
          ← Back
        </Link>
      ) : null}

      <header className={backHref ? "mt-4" : ""}>
        <div className="flex items-start gap-4">
          <Avatar name={profile.displayName} hue={profile.avatarHue} size={72} />
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[24px] font-bold leading-tight tracking-tight text-ink">
              {profile.displayName}
            </h1>
            <p className="text-[13px] text-muted-2">{`@${profile.username}`}</p>
            <p className="mt-2 text-[13px] leading-snug text-muted">
              {profile.bio || "Rating everything, one matchup at a time."}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-4 text-[12px] text-muted-2">
          <span>
            <strong className="text-ink">{profile.followers}</strong> {profile.followers === 1 ? "follower" : "followers"}
          </span>
          <span>
            <strong className="text-ink">{profile.following}</strong> following
          </span>
          <span>
            <strong className="text-ink">{ratings.length}</strong> ranked
          </span>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {isSelf ? (
            <Link href="/app/rate">
              <Button size="sm">Rate something</Button>
            </Link>
          ) : viewerOrgId ? (
            <FollowButton username={profile.username} initialFollowing={following} />
          ) : (
            <Link href="/login">
              <Button size="sm">Open app</Button>
            </Link>
          )}
          <ShareButton title={`${profile.displayName} on Appolo`} path={`/${profile.username}`} />
          {footer}
        </div>
      </header>

      <section className="mt-8">
        <h2 className="mb-3 text-[17px] font-semibold text-ink">Top five</h2>
        {topFive.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
            <p className="text-sm font-medium text-ink">No podium yet</p>
            <p className="mt-1 text-[13px] text-muted">Rate a few things to start the list.</p>
            {isSelf ? (
              <Link href="/app/rate" className="mt-3 inline-block">
                <Button size="sm" variant="secondary">Start rating</Button>
              </Link>
            ) : null}
          </div>
        ) : (
          <ol className="space-y-2">
            {topFive.map((item, index) => (
              <li key={item.id}>
                <Link
                  href={`/app/item/${item.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5 transition-colors hover:border-white/15"
                >
                  <span className="grid w-6 shrink-0 place-items-center text-[18px] font-extrabold text-white/25">
                    {RANKS[index]}
                  </span>
                  <MediaArt kind={item.kind} title={item.title} className="h-12 w-12 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[14px] font-semibold text-ink">{item.title}</p>
                    <p className="truncate text-[11px] text-muted-2">
                      {item.subtitle || MEDIA_KIND_LABELS[item.kind]}
                      {item.year ? ` · ${item.year}` : ""}
                    </p>
                  </div>
                  <ScoreText score={item.score} className="text-[15px]" />
                </Link>
              </li>
            ))}
          </ol>
        )}
      </section>

      {pods.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-[17px] font-semibold text-ink">Pods</h2>
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
            {pods.map((pod) => (
              <PodRow key={pod.id} pod={pod} />
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-8 pb-10">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[17px] font-semibold text-ink">Everything</h2>
          <span className="text-[11px] text-muted-2">{ratings.length} ranked</span>
        </div>
        {ratings.length === 0 ? (
          <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">
            Nothing here yet.
          </p>
        ) : (
          <div className="grid grid-cols-3 gap-2.5">
            {ratings.map((item) => (
              <Link key={item.id} href={`/app/item/${item.id}`} className="group">
                <div className="relative">
                  <MediaArt kind={item.kind} title={item.title} className="aspect-square w-full rounded-lg" />
                  <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-0.5 text-[10px] font-bold text-brand backdrop-blur">
                    {item.score.toFixed(1)}
                  </span>
                </div>
                <p className="mt-1.5 truncate text-[11px] font-medium text-ink">{item.title}</p>
              </Link>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}