import Link from "next/link";
import { GENRES, MEDIA_KIND_LABELS, MEDIA_KINDS, scoreBand, type MediaKind } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { catalogLeaderboard, rankedRatings, weeklyMovers, type LeaderboardSort } from "@/lib/services/rankings";
import { followingOrgIds, tasteTwins } from "@/lib/services/social";
import { MediaArt } from "@/components/media-art";
import { Avatar, ScoreText } from "@/components/podiums";
import { KindIcon } from "@/components/kind-icon";
import { FollowButton } from "@/components/follow-button";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Browse" };

const SORTS: Array<{ key: LeaderboardSort; label: string }> = [
  { key: "top", label: "Top rated" },
  { key: "rated", label: "Most rated" },
  { key: "new", label: "Newest" },
];

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; genre?: string; sort?: string }>;
}) {
  const session = await requireSession();
  const { kind, genre, sort } = await searchParams;
  const activeKind = MEDIA_KINDS.includes(kind as MediaKind) ? (kind as MediaKind) : undefined;
  const activeGenre = activeKind && genre && GENRES[activeKind]?.includes(genre) ? genre : undefined;
  const activeSort: LeaderboardSort = SORTS.some((entry) => entry.key === sort)
    ? (sort as LeaderboardSort)
    : "top";

  const [items, mine, movers, twins, following] = await Promise.all([
    catalogLeaderboard({ kind: activeKind, genre: activeGenre, sort: activeSort, limit: 30 }),
    rankedRatings(session.org.id),
    weeklyMovers(session.org.id, 5),
    tasteTwins(session.org.id, 5),
    followingOrgIds(session.org.id),
  ]);

  const myScores = new Map(mine.map((item) => [item.id, item.score]));
  const followingSet = new Set(following);

  function browseHref(next: { kind?: MediaKind; genre?: string; sort?: LeaderboardSort }) {
    const params = new URLSearchParams();
    const nextKind = next.kind === undefined ? activeKind : next.kind;
    const nextGenre = next.genre === undefined ? activeGenre : next.genre;
    const nextSort = next.sort ?? activeSort;
    if (nextKind) params.set("kind", nextKind);
    if (nextGenre) params.set("genre", nextGenre);
    if (nextSort !== "top") params.set("sort", nextSort);
    const query = params.toString();
    return query ? `/app/browse?${query}` : "/app/browse";
  }

  return (
    <div className="px-5 pt-4 pb-10">
      <BackButton fallback="/app" />

      <h1 className="mt-4 text-[30px] font-extrabold tracking-tight text-ink">Browse</h1>
      <p className="mt-1 text-[13px] text-muted">
        What the community is rating — across everything, not just your feed.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={browseHref({ kind: undefined, genre: undefined })}
          className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
            !activeKind
              ? "border-brand/40 bg-brand/15 text-brand"
              : "border-white/10 bg-white/5 text-muted hover:text-ink"
          }`}
        >
          All
        </Link>
        {MEDIA_KINDS.map((entry) => (
          <Link
            key={entry}
            href={browseHref({ kind: entry, genre: undefined })}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              activeKind === entry
                ? "border-brand/40 bg-brand/15 text-brand"
                : "border-white/10 bg-white/5 text-muted hover:text-ink"
            }`}
          >
            <KindIcon kind={entry} className="h-3.5 w-3.5" />
            {MEDIA_KIND_LABELS[entry]}
          </Link>
        ))}
      </div>

      {activeKind && GENRES[activeKind]?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {GENRES[activeKind].map((entry) => (
            <Link
              key={entry}
              href={browseHref({ genre: activeGenre === entry ? undefined : entry })}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                activeGenre === entry
                  ? "border-brand/40 bg-brand/15 text-brand"
                  : "border-white/10 bg-white/5 text-muted hover:text-ink"
              }`}
            >
              {entry === "Anime" ? <KindIcon kind="anime" className="h-3.5 w-3.5" /> : null}
              {entry}
            </Link>
          ))}
        </div>
      ) : null}

      <div className="mt-4 flex items-center gap-2">
        {SORTS.map((entry) => (
          <Link
            key={entry.key}
            href={browseHref({ sort: entry.key })}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              activeSort === entry.key
                ? "border-ink/30 bg-white/10 text-ink"
                : "border-white/10 bg-white/5 text-muted hover:text-ink"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </div>

      <div className="mt-5 grid grid-cols-2 gap-3">
        {items.map((item) => {
          const mineScore = myScores.get(item.id);
          const band = item.average === null ? null : scoreBand(item.average);
          return (
            <Link key={item.id} href={`/app/item/${item.id}`} className="group">
              <div className="relative">
                <MediaArt
                  kind={item.kind}
                  title={item.title}
                  imageUrl={item.imageUrl}
                  genres={item.genres}
                  className="aspect-square w-full rounded-xl"
                />
                {item.average !== null ? (
                  <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-bold text-brand backdrop-blur">
                    {item.average.toFixed(1)}
                  </span>
                ) : null}
                {mineScore !== undefined ? (
                  <span className="absolute left-2 top-2 rounded-md bg-brand/90 px-1.5 py-0.5 text-[10px] font-bold text-black">
                    You {mineScore.toFixed(1)}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 truncate text-[13px] font-medium text-ink">{item.title}</p>
              <p className="truncate text-[11px] text-muted-2">
                {item.subtitle || MEDIA_KIND_LABELS[item.kind]}
                {item.year ? ` · ${item.year}` : ""}
              </p>
              <p className="truncate text-[10px] text-muted-2">
                {item.ratings === 0 ? "No ratings yet" : `${item.ratings} rating${item.ratings === 1 ? "" : "s"}`}
                {band ? ` · ${band.label}` : ""}
              </p>
            </Link>
          );
        })}
      </div>

      {items.length === 0 ? (
        <p className="mt-5 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 text-[13px] text-muted">
          Nothing here yet. Try another category, or search for a title to add it to the catalog.
        </p>
      ) : null}

      {movers.length > 0 ? (
        <section className="mt-9">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-[17px] font-semibold text-ink">On the move</h2>
            <Link href="/app/history" className="text-xs text-muted-2 hover:text-ink">
              History
            </Link>
          </div>
          <p className="mb-3 text-[12px] text-muted-2">Biggest score swings in your matchups this week.</p>
          <ol className="space-y-2">
            {movers.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/app/item/${item.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5 transition-colors hover:border-white/15"
                >
                  <MediaArt kind={item.kind} title={item.title} imageUrl={item.imageUrl} genres={item.genres} className="h-11 w-11 rounded-lg" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{item.title}</p>
                    <p className="truncate text-[11px] text-muted-2">{item.votes} decided matchups</p>
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

      {twins.length > 0 ? (
        <section className="mt-9">
          <h2 className="mb-1 text-[17px] font-semibold text-ink">Taste twins</h2>
          <p className="mb-3 text-[12px] text-muted-2">People whose scores line up with yours.</p>
          <ul className="space-y-2">
            {twins.map((twin) => (
              <li
                key={twin.profile.orgId}
                className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3"
              >
                <Link href={`/${twin.profile.username}`} className="shrink-0">
                  <Avatar name={twin.profile.displayName} hue={twin.profile.avatarHue} size={40} />
                </Link>
                <div className="min-w-0 flex-1">
                  <Link href={`/${twin.profile.username}`} className="block truncate text-sm font-semibold text-ink">
                    {twin.profile.displayName}
                  </Link>
                  <p className="truncate text-[11px] text-muted-2">
                    {twin.match}% match · {twin.shared} shared titles
                  </p>
                </div>
                <FollowButton username={twin.profile.username} initialFollowing={followingSet.has(twin.profile.orgId)} />
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="mt-8 text-center">
        <Link href="/app/search" className="text-[12px] text-brand hover:underline">
          Search for something specific →
        </Link>
      </div>
    </div>
  );
}
