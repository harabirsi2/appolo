import Link from "next/link";
import { Button } from "@appolo/ui";
import { MEDIA_KIND_LABELS } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { tasteStats, topFive } from "@/lib/services/rankings";
import { ratingStreak } from "@/lib/services/streaks";
import { popularThisWeek } from "@/lib/services/rankings";
import {
  ensureProfile,
  feedForYou,
  getProfileByOrgId,
  podsForProfile,
  suggestedProfiles,
  unreadNotificationCount,
} from "@/lib/services/social";
import { MediaArt } from "@/components/media-art";
import { Avatar, PodRow, ReviewCard } from "@/components/podiums";
import { FollowButton } from "@/components/follow-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

const RANKS = ["1", "2", "3", "4", "5"];

export default async function HomePage() {
  const session = await requireSession();
  const profile =
    (await getProfileByOrgId(session.org.id)) ??
    (await ensureProfile(session.org.id, session.org.name, session.org.slug));

  const [stats, top, feed, suggestions, pods, popular, unread, streak] = await Promise.all([
    tasteStats(session.org.id),
    topFive(session.org.id),
    feedForYou(session.org.id, 6),
    suggestedProfiles(session.org.id, 4),
    podsForProfile(profile.orgId, profile.username, profile.displayName),
    popularThisWeek(8),
    unreadNotificationCount(session.org.id),
    ratingStreak(session.org.id),
  ]);

  return (
    <div className="px-5 pt-6">
      <header className="flex items-center justify-between">
        <Link href="/app" className="text-[26px] font-extrabold tracking-tight text-ink">
          appolo
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/app/notifications" aria-label="Notifications" className="relative">
            <span className="text-[20px]">🔔</span>
            {unread > 0 ? (
              <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-brand text-[9px] font-bold text-black">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </Link>
          <Link href="/app/profile" aria-label="Your profile">
            <Avatar name={profile.displayName} hue={profile.avatarHue} size={36} />
          </Link>
        </div>
      </header>

      <p className="mt-4 text-[13px] text-muted">
        {stats.rated} ranked · {stats.matchups} matchups · {stats.averageScore.toFixed(1)} avg
        {stats.topKind ? ` · mostly ${MEDIA_KIND_LABELS[stats.topKind].toLowerCase()}` : ""}
        {streak.current > 0 ? ` · 🔥 ${streak.current}-day streak` : ""}
      </p>

      <section className="mt-7">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[17px] font-semibold text-ink">Your taste</h2>
          <Link href="/app/rankings" className="text-xs text-muted-2 hover:text-ink">
            All rankings
          </Link>
        </div>

        {top.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
            <p className="text-sm font-medium text-ink">Nothing ranked yet</p>
            <p className="mx-auto mt-1 max-w-[280px] text-[13px] text-muted">
              Play a few quick “which is better?” matchups and your top five builds itself.
            </p>
            <Link href="/app/rate" className="mt-4 inline-block">
              <Button size="sm">Rate something</Button>
            </Link>
          </div>
        ) : (
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
            {top.map((item, index) => (
              <Link
                key={item.id}
                href={`/app/item/${item.id}`}
                className="w-[118px] shrink-0"
              >
                <div className="relative">
                  <MediaArt kind={item.kind} title={item.title} className="aspect-square w-full rounded-xl" />
                  <span className="absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/70 text-[11px] font-bold text-white backdrop-blur">
                    {RANKS[index]}
                  </span>
                  <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-bold text-brand backdrop-blur">
                    {item.score.toFixed(1)}
                  </span>
                </div>
                <p className="mt-2 truncate text-[13px] font-medium text-ink">{item.title}</p>
                <p className="truncate text-[11px] text-muted-2">{MEDIA_KIND_LABELS[item.kind]}</p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[17px] font-semibold text-ink">Your pods</h2>
          <Link href={`/${profile.username}`} className="text-xs text-muted-2 hover:text-ink">
            See all
          </Link>
        </div>
        {pods.length === 0 ? (
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
            <div>
              <p className="text-sm font-medium text-ink">Make your first pod</p>
              <p className="text-[12px] text-muted">Shareable lists for any vibe.</p>
            </div>
            <Link href="/app/pods/new">
              <Button size="sm" variant="secondary">Create</Button>
            </Link>
          </div>
        ) : (
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
            {pods.map((pod) => (
              <PodRow key={pod.id} pod={pod} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[17px] font-semibold text-ink">Popular this week</h2>
        </div>
        {popular.length === 0 ? (
          <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">No ratings yet.</p>
        ) : (
          <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
            {popular.map((item) => (
              <Link key={item.id} href={`/app/item/${item.id}`} className="w-[116px] shrink-0">
                <MediaArt kind={item.kind} title={item.title} className="aspect-square w-full rounded-xl" />
                <p className="mt-2 truncate text-[13px] font-medium text-ink">{item.title}</p>
                <p className="truncate text-[11px] text-muted-2">
                  {item.average.toFixed(1)} · {item.ratings} ratings
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <div className="mb-3 flex items-end justify-between">
          <h2 className="text-[17px] font-semibold text-ink">From people you follow</h2>
        </div>
        {feed.length === 0 ? (
          <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">
            Follow someone below and their reviews will show up here.
          </p>
        ) : (
          <div className="grid grid-cols-2 gap-2.5">
            {feed.map((review) => (
              <ReviewCard key={review.id} review={review} />
            ))}
          </div>
        )}
      </section>

      {suggestions.length > 0 ? (
        <section className="mt-8">
          <h2 className="mb-3 text-[17px] font-semibold text-ink">Find your people</h2>
          <ul className="space-y-2">
            {suggestions.map((person) => (
              <li
                key={person.orgId}
                className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3"
              >
                <Link href={`/${person.username}`} className="shrink-0">
                  <Avatar name={person.displayName} hue={person.avatarHue} size={40} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/${person.username}`} className="block truncate text-sm font-semibold text-ink">
                    {person.displayName}
                  </Link>
                  <p className="truncate text-[12px] text-muted-2">
                    {`@${person.username}`}
                    {person.bio ? ` · ${person.bio}` : ""}
                  </p>
                </div>
                <FollowButton username={person.username} initialFollowing={false} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-8 flex items-center justify-between rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <div>
          <p className="text-sm font-medium text-ink">{`@${profile.username}`}</p>
          <p className="text-[12px] text-muted-2">
            {profile.followers} {profile.followers === 1 ? "follower" : "followers"} · {profile.following} following
          </p>
        </div>
        <Link href={`/${profile.username}`}>
          <Button size="sm" variant="secondary">View profile</Button>
        </Link>
      </div>

      <div className="mt-6 flex items-center justify-center gap-2 text-[11px] text-muted-2">
        <span>Signed in as {session.user.email}</span>
      </div>
    </div>
  );
}