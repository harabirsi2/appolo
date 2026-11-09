import Link from "next/link";
import { Button } from "@appolo/ui";
import { MEDIA_KIND_LABELS } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { tasteStats, topFive } from "@/lib/services/rankings";
import { ratingStreak } from "@/lib/services/streaks";
import { popularThisWeek, weeklyMovers } from "@/lib/services/rankings";
import {
  ensureProfile,
  feedForYou,
  getProfileByOrgId,
  podsForProfile,
  suggestedProfiles,
  unreadNotificationCount,
} from "@/lib/services/social";
import { MediaArt } from "@/components/media-art";
import { KindIcon, isAnime } from "@/components/kind-icon";
import { Avatar, Icon, PodRow, ReviewCard } from "@/components/podiums";
import { FollowButton } from "@/components/follow-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Home" };

const RANKS = ["1", "2", "3", "4", "5"];

function rankTone(index: number): string {
  if (index === 0) return "bg-gold/20 text-gold ring-1 ring-gold/40";
  if (index === 1) return "bg-silver/15 text-silver ring-1 ring-silver/30";
  if (index === 2) return "bg-bronze/15 text-bronze ring-1 ring-bronze/30";
  return "bg-black/70 text-white/60";
}

export default async function HomePage() {
  const session = await requireSession();
  const profile =
    (await getProfileByOrgId(session.org.id)) ??
    (await ensureProfile(session.org.id, session.org.name, session.org.slug));

  const [stats, top, feed, suggestions, pods, popular, unread, streak, movers] = await Promise.all([
    tasteStats(session.org.id),
    topFive(session.org.id),
    feedForYou(session.org.id, 6),
    suggestedProfiles(session.org.id, 4),
    podsForProfile(profile.orgId, profile.username, profile.displayName),
    popularThisWeek(8),
    unreadNotificationCount(session.org.id),
    ratingStreak(session.org.id),
    weeklyMovers(session.org.id, 4),
  ]);

  const firstName = profile.displayName.split(/\s+/)[0] ?? profile.displayName;

  return (
    <div className="px-5 pt-5">
      <header className="flex items-center justify-between lg:justify-end">
        <Link href="/app" className="flex items-baseline gap-0.5 font-display text-[26px] font-semibold leading-none tracking-[-0.04em] text-ink lg:hidden">
          appolo
          <span className="mb-1 h-1.5 w-1.5 rounded-full bg-brand" />
        </Link>
        <div className="flex items-center gap-2.5">
          <Link
            href="/app/notifications"
            aria-label="Notifications"
            className="relative grid h-11 w-11 place-items-center rounded-full border border-white/10 bg-white/[0.04] text-muted transition-colors hover:bg-white/[0.08] hover:text-ink"
          >
            <Icon name="bell" className="h-[18px] w-[18px]" />
            {unread > 0 ? (
              <span className="absolute -right-0.5 -top-0.5 grid h-4 min-w-4 place-items-center rounded-full bg-brand px-1 text-[9px] font-bold text-black">
                {unread > 9 ? "9+" : unread}
              </span>
            ) : null}
          </Link>
          <Link href="/app/profile" aria-label="Your profile" className="grid h-11 w-11 place-items-center rounded-full ring-2 ring-white/10 transition hover:ring-brand/50">
            <Avatar name={profile.displayName} hue={profile.avatarHue} size={36} />
          </Link>
        </div>
      </header>

      <section className="relative mt-5 overflow-hidden rounded-3xl border border-white/[0.07] bg-gradient-to-br from-white/[0.07] via-white/[0.03] to-transparent p-4 shadow-card">
        <div
          className="pointer-events-none absolute -right-10 -top-16 h-40 w-40 rounded-full blur-3xl"
          style={{ background: `hsl(${profile.avatarHue} 70% 45% / 0.28)` }}
          aria-hidden
        />
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] uppercase tracking-[0.16em] text-muted-2">
              {new Date().toLocaleDateString("en-US", { weekday: "long" })}
            </p>
            <h1 className="mt-1 text-[24px] font-bold leading-tight tracking-[-0.02em] text-ink">
              Hey, {firstName}
            </h1>
            <p className="mt-0.5 text-[12px] text-muted">
              {stats.rated === 0
                ? "Your podium is waiting for its first title."
                : `Mostly ${stats.topKind ? MEDIA_KIND_LABELS[stats.topKind] : "everything"} · ${stats.matchups} matchups played`}
            </p>
          </div>
          <span
            className={`shrink-0 rounded-full border px-2.5 py-1 text-[11px] font-semibold ${
              streak.current > 0
                ? "border-brand/30 bg-brand/10 text-brand"
                : "border-white/10 bg-white/5 text-muted-2"
            }`}
          >
            {streak.current > 0 ? `🔥 ${streak.current}d` : "No streak"}
          </span>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          {[
            { label: "Ranked", value: String(stats.rated) },
            { label: "Matchups", value: String(stats.matchups) },
            { label: "Average", value: stats.rated === 0 ? "—" : stats.averageScore.toFixed(1) },
          ].map((stat) => (
            <div key={stat.label} className="rounded-2xl border border-white/[0.06] bg-black/25 px-3 py-2.5">
              <p className="text-[18px] font-bold leading-none tabular-nums text-ink">{stat.value}</p>
              <p className="mt-1 text-[10px] uppercase tracking-[0.12em] text-muted-2">{stat.label}</p>
            </div>
          ))}
        </div>

        <div className="mt-3 flex gap-2">
          <Link href="/app/rate" className="flex-1">
            <Button size="md" className="w-full">Rate something</Button>
          </Link>
          <Link href="/app/taste">
            <Button size="md" variant="secondary">Taste DNA</Button>
          </Link>
        </div>
      </section>

      <section className="mt-8">
        <SectionHeader title="Your taste" href="/app/rankings" action="All rankings" />
        {top.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
            <p className="text-sm font-medium text-ink">Nothing ranked yet</p>
            <p className="mx-auto mt-1 max-w-[280px] text-[13px] text-muted">
              Play a few quick “which is better?” matchups and your top five builds itself.
            </p>
            <Link href="/app/rate" className="mt-4 inline-block">
              <Button size="sm">Start rating</Button>
            </Link>
          </div>
        ) : (
          <div className="snap-rail no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
            {top.map((item, index) => (
              <Link key={item.id} href={`/app/item/${item.id}`} className="w-[124px] shrink-0">
                <div className="relative">
                  <MediaArt kind={item.kind} title={item.title} imageUrl={item.imageUrl} genres={item.genres} className="aspect-square w-full rounded-xl" />
                  <span
                    className={`absolute left-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full text-[11px] font-extrabold backdrop-blur ${rankTone(index)}`}
                  >
                    {RANKS[index]}
                  </span>
                  <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-bold text-brand backdrop-blur">
                    {item.score.toFixed(1)}
                  </span>
                </div>
                <p className="mt-2 truncate text-[13px] font-medium text-ink">{item.title}</p>
                <p className="flex items-center gap-1 truncate text-[11px] text-muted-2">
                  <KindIcon kind={isAnime(item.kind, item.genres) ? "anime" : item.kind} className="h-3 w-3 shrink-0" />
                  {MEDIA_KIND_LABELS[item.kind]}
                </p>
              </Link>
            ))}
          </div>
        )}
      </section>

      {movers.length > 0 ? (
        <section className="mt-8">
          <SectionHeader title="On the move" href="/app/browse" action="Browse all" />
          <ol className="space-y-1.5">
            {movers.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/app/item/${item.id}`}
                  className="card-surface card-hover flex items-center gap-3 rounded-2xl p-2.5"
                >
                  <MediaArt kind={item.kind} title={item.title} imageUrl={item.imageUrl} className="h-11 w-11 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{item.title}</p>
                    <p className="truncate text-[11px] text-muted-2">{item.votes} decided matchups this week</p>
                  </div>
                  <span className={`text-[13px] font-bold tabular-nums ${item.delta >= 0 ? "text-brand" : "text-danger"}`}>
                    {item.delta >= 0 ? "+" : ""}
                    {item.delta}
                  </span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      <section className="mt-8">
        <SectionHeader title="Your pods" href={`/${profile.username}`} action="See all" />
        {pods.length === 0 ? (
          <div className="card-surface flex items-center justify-between gap-3 rounded-2xl p-4">
            <div>
              <p className="text-sm font-medium text-ink">Make your first pod</p>
              <p className="text-[12px] text-muted">Shareable lists for any vibe.</p>
            </div>
            <Link href="/app/pods/new">
              <Button size="sm" variant="secondary">Create</Button>
            </Link>
          </div>
        ) : (
          <div className="snap-rail no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
            {pods.map((pod) => (
              <PodRow key={pod.id} pod={pod} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <SectionHeader title="Popular this week" href="/app/browse" action="Browse" />
        {popular.length === 0 ? (
          <p className="card-surface rounded-2xl p-4 text-[13px] text-muted">No ratings yet.</p>
        ) : (
          <div className="snap-rail no-scrollbar -mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
            {popular.map((item) => (
              <Link key={item.id} href={`/app/item/${item.id}`} className="w-[116px] shrink-0">
                <MediaArt kind={item.kind} title={item.title} imageUrl={item.imageUrl} genres={item.genres} className="aspect-square w-full rounded-xl" />
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
        <SectionHeader title="For you" href="/app/browse" action="Discover" />
        {feed.length === 0 ? (
          <p className="card-surface rounded-2xl p-4 text-[13px] text-muted">
            Follow someone or rate a few titles and your feed will fill in.
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
          <h2 className="mb-3 text-[17px] font-semibold tracking-[-0.01em] text-ink">Find your people</h2>
          <ul className="space-y-1.5">
            {suggestions.map((person) => (
              <li key={person.orgId} className="card-surface flex items-center gap-3 rounded-2xl p-3">
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

      <div className="card-surface mt-8 flex items-center justify-between rounded-2xl p-4">
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

      <p className="mt-6 text-center text-[11px] text-muted-2">Signed in as {session.user.email}</p>
    </div>
  );
}

function SectionHeader({ title, href, action }: { title: string; href: string; action: string }) {
  return (
    <div className="mb-3 flex items-end justify-between">
      <h2 className="text-[17px] font-semibold tracking-[-0.01em] text-ink">{title}</h2>
      <Link href={href} className="text-[11px] text-muted-2 transition-colors hover:text-ink">
        {action}
      </Link>
    </div>
  );
}
