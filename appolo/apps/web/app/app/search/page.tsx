import Link from "next/link";
import { MEDIA_KIND_LABELS, MEDIA_KINDS, GENRES, type MediaKind } from "@appolo/core/ranking";
import { requireSession } from "@/lib/session";
import { listCatalog, rankedRatings } from "@/lib/services/rankings";
import {
  ensureProfile,
  followingOrgIds,
  getProfileByOrgId,
  recordSearch,
  searchHistoryFor,
  searchProfiles,
  suggestedProfiles,
} from "@/lib/services/social";
import { MediaArt } from "@/components/media-art";
import { Avatar, CategoryTile, Icon, ScoreText } from "@/components/podiums";
import { KindIcon } from "@/components/kind-icon";
import { FollowButton } from "@/components/follow-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Search" };

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; people?: string; genre?: string }>;
}) {
  const session = await requireSession();
  const { q, kind, people: peopleParam, genre } = await searchParams;
  const query = q?.trim() ?? "";
  const activeKind = MEDIA_KINDS.includes(kind as MediaKind) ? (kind as MediaKind) : undefined;
  const showPeople = peopleParam === "1";
  const browsing = query.length > 0 || Boolean(activeKind) || Boolean(genre);
  const searching = browsing || showPeople;

  const profile =
    (await getProfileByOrgId(session.org.id)) ??
    (await ensureProfile(session.org.id, session.org.name, session.org.slug));

  if (query.length >= 2) {
    await recordSearch(session.org.id, query);
  }

  const [ratings, items, people, suggestions, following, recentSearches] = await Promise.all([
    rankedRatings(session.org.id),
    browsing ? listCatalog({ kind: activeKind, q: query || undefined, genre: genre || undefined, limit: 60 }) : Promise.resolve([]),
    query ? searchProfiles(query, 6) : showPeople ? suggestedProfiles(session.org.id, 12) : Promise.resolve([]),
    suggestedProfiles(session.org.id, 3),
    followingOrgIds(session.org.id),
    searchHistoryFor(session.org.id),
  ]);

  const followingSet = new Set(following);
  const scoreById = new Map(ratings.map((rating) => [rating.id, rating.score]));
  const recentlyRated = ratings.slice(0, 5);

  return (
    <div className="px-5 pt-6">
      <h1 className="text-[34px] font-extrabold tracking-tight text-ink">Search</h1>

      <form action="/app/search" className="relative mt-4">
        <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-2" />
        <input
          name="q"
          defaultValue={query}
          placeholder="Search songs, movies, users..."
          className="h-11 w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] pl-10 pr-3 text-[14px] text-ink placeholder:text-muted-2 focus:border-white/20 focus:outline-none"
        />
      </form>

      {activeKind ? (
        <div className="mt-4 flex flex-wrap gap-2">
          <Link
            href="/app/search"
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted hover:text-ink"
          >
            All
          </Link>
          {MEDIA_KINDS.map((k) => (
            <Link
              key={k}
              href={`/app/search?kind=${k}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                activeKind === k
                  ? "border-brand/40 bg-brand/15 text-brand"
                  : "border-white/10 bg-white/5 text-muted hover:text-ink"
              }`}
            >
              <KindIcon kind={k} className="h-3.5 w-3.5" />
              {MEDIA_KIND_LABELS[k]}
            </Link>
          ))}
        </div>
      ) : null}
      {activeKind && GENRES[activeKind]?.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {GENRES[activeKind].map((g) => (
            <Link
              key={g}
              href={`/app/search?kind=${activeKind}&genre=${encodeURIComponent(g)}`}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                genre === g
                  ? "border-brand/40 bg-brand/15 text-brand"
                  : "border-white/10 bg-white/5 text-muted hover:text-ink"
              }`}
            >
              {g === "Anime" ? <KindIcon kind="anime" className="h-3.5 w-3.5" /> : null}
              {g}
            </Link>
          ))}
          {genre ? (
            <Link
              href={`/app/search?kind=${activeKind}`}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted hover:text-ink"
            >
              Clear genre
            </Link>
          ) : null}
        </div>
      ) : null}

      {searching ? (
        <div className="mt-6 space-y-7">
          {people.length > 0 ? (
            <section>
              <h2 className="mb-3 text-[17px] font-semibold text-ink">People</h2>
              <ul className="space-y-2">
                {people.map((person) => (
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
                    {person.orgId !== profile.orgId ? (
                      <FollowButton username={person.username} initialFollowing={followingSet.has(person.orgId)} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section>
            <h2 className="mb-3 text-[17px] font-semibold text-ink">
              {activeKind ? MEDIA_KIND_LABELS[activeKind] : "Titles"}
            </h2>
            {!browsing ? null : items.length === 0 ? (
              <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 text-[13px] text-muted">
                Nothing matched “{query}”. Try another spelling or browse a category.
              </p>
            ) : activeKind ? (
              <div className="grid grid-cols-2 gap-3">
                {items.map((item) => (
                  <Link key={item.id} href={`/app/item/${item.id}`} className="group">
                    <div className="relative">
                      <MediaArt kind={item.kind} title={item.title} imageUrl={item.imageUrl} genres={item.genres} className="aspect-square w-full rounded-xl" />
                      {scoreById.has(item.id) ? (
                        <span className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-bold text-brand backdrop-blur">
                          {scoreById.get(item.id)!.toFixed(1)}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-2 truncate text-[13px] font-medium text-ink">{item.title}</p>
                    <p className="truncate text-[11px] text-muted-2">
                      {item.subtitle}
                      {item.year ? ` · ${item.year}` : ""}
                    </p>
                  </Link>
                ))}
              </div>
            ) : (
              <ul className="space-y-1">
                {items.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/app/item/${item.id}`}
                      className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-white/[0.04]"
                    >
                      <MediaArt kind={item.kind} title={item.title} imageUrl={item.imageUrl} genres={item.genres} className="h-12 w-12 rounded-lg" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                        <p className="truncate text-[12px] text-muted-2">
                          {item.subtitle}
                          {item.year ? ` · ${item.year}` : ""}
                        </p>
                      </div>
                      <ScoreText score={scoreById.get(item.id) ?? null} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      ) : (
        <div className="mt-6 space-y-8">
          {recentSearches.length > 0 ? (
            <section>
              <div className="mb-3 flex items-end justify-between">
                <h2 className="text-[17px] font-semibold text-ink">Recent searches</h2>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((q) => (
                  <Link
                    key={q}
                    href={`/app/search?q=${encodeURIComponent(q)}`}
                    className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-muted hover:text-ink"
                  >
                    {q}
                  </Link>
                ))}
              </div>
            </section>
          ) : null}
          {recentlyRated.length > 0 ? (
            <section>
              <div className="mb-3 flex items-end justify-between">
                <h2 className="text-[17px] font-semibold text-ink">Recently rated</h2>
                <Link href="/app/rankings" className="text-xs text-muted-2 hover:text-ink">
                  See all
                </Link>
              </div>
              <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
                {recentlyRated.map((item) => (
                  <Link key={item.id} href={`/app/item/${item.id}`} className="w-[116px] shrink-0">
                    <div className="relative">
                      <MediaArt kind={item.kind} title={item.title} imageUrl={item.imageUrl} genres={item.genres} className="aspect-square w-full rounded-xl" />
                      <span className="absolute bottom-1.5 right-1.5 rounded-md bg-black/75 px-1.5 py-0.5 text-[11px] font-bold text-brand backdrop-blur">
                        {item.score.toFixed(1)}
                      </span>
                    </div>
                    <p className="mt-2 truncate text-[13px] font-medium text-ink">{item.title}</p>
                    <p className="truncate text-[11px] text-muted-2">{item.subtitle || MEDIA_KIND_LABELS[item.kind]}</p>
                  </Link>
                ))}
              </div>
            </section>
          ) : null}

          <section>
            <div className="mb-3 flex items-end justify-between">
              <h2 className="text-[17px] font-semibold text-ink">Browse what&apos;s popular</h2>
              <Link href="/app/browse" className="text-xs text-muted-2 hover:text-ink">
                Browse all
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-3">
              {MEDIA_KINDS.map((k) => (
                <CategoryTile key={k} kind={k} href={`/app/search?kind=${k}`} label={MEDIA_KIND_LABELS[k]} />
              ))}
              <Link
                href="/app/search?people=1"
                className="flex h-[124px] flex-col items-center justify-center gap-3 rounded-2xl border border-white/5 bg-[#141416] transition-colors hover:border-white/15"
              >
                <span className="text-[15px] font-semibold text-ink">People</span>
                <span className="flex -space-x-2">
                  {suggestions.map((person) => (
                    <Avatar
                      key={person.orgId}
                      name={person.displayName}
                      hue={person.avatarHue}
                      size={38}
                      className="ring-2 ring-[#141416]"
                    />
                  ))}
                </span>
              </Link>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}