import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@appolo/ui";
import { MEDIA_KIND_LABELS, MEDIA_KINDS, type MediaKind } from "@appolo/core";
import type { ProfileBundle } from "@/lib/services/social";
import { MediaArt } from "./media-art";
import { Avatar, PodRow, ScoreText } from "./podiums";
import { FollowButton } from "./follow-button";
import { ShareButton } from "./share-button";
import { PodiumOrderEditor } from "./podium-order-editor";

const RANKS = ["1", "2", "3", "4", "5"];

export function ProfileScreen({
  bundle,
  viewerOrgId,
  following,
  footer,
  backHref,
  tab,
  podiumKind,
  matchPercent,
}: {
  bundle: ProfileBundle;
  viewerOrgId: string | null;
  following: boolean;
  footer?: ReactNode;
  backHref?: string;
  tab?: string;
  podiumKind?: string;
  matchPercent?: number | null;
}) {
  const { profile, ratings, topFive, podiums, pods, watchlist, pinnedReview } = bundle;
  const isSelf = viewerOrgId === profile.orgId;
  const activeTab = ["topfive", "everything", "watchlist", "pods", "history"].includes(tab ?? "")
    ? (tab as string)
    : "topfive";
  const requestedKind = MEDIA_KINDS.includes(podiumKind as MediaKind) ? (podiumKind as MediaKind) : null;
  const defaultKind =
    requestedKind ??
    (podiums.find((podium) => podium.items.length > 0)?.kind ?? MEDIA_KINDS[0]);
  const podium = podiums.find((entry) => entry.kind === defaultKind);
  const podiumItems = podium?.items ?? [];
  const profileHref = isSelf ? "/app/profile" : `/${profile.username}`;
  const champion = podiumItems[0] ?? null;

  return (
    <div className="px-5 pt-6">
      {backHref ? (
        <Link href={backHref} className="text-xs text-muted-2 hover:text-ink">
          ← Back
        </Link>
      ) : null}

      <div className="relative -mx-5 mt-2 h-24 overflow-hidden">
        <div
          className="absolute inset-0"
          style={{
            background: `linear-gradient(120deg, hsl(${profile.avatarHue} 55% 26%) 0%, hsl(${(profile.avatarHue + 50) % 360} 45% 14%) 55%, transparent 100%)`,
          }}
        />
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-black" />
      </div>

      <header className="relative -mt-10">
        <div className="flex items-start gap-4">
          <div className="rounded-full p-0.5 ring-2 ring-brand/30">
            <Avatar name={profile.displayName} hue={profile.avatarHue} size={72} />
          </div>
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
            <>
              <Link href="/app/rate">
                <Button size="sm">Rate something</Button>
              </Link>
              <Link href="/app/taste">
                <Button size="sm" variant="secondary">Taste DNA</Button>
              </Link>
              <Link href="/app/profile/edit">
                <Button size="sm" variant="secondary">Edit profile</Button>
              </Link>
            </>
          ) : viewerOrgId ? (
            <FollowButton username={profile.username} initialFollowing={following} />
          ) : (
            <Link href="/login">
              <Button size="sm">Open app</Button>
            </Link>
          )}
          <ShareButton title={`${profile.displayName} on Appolo`} path={profileHref} />
          {footer}
        </div>
      </header>

      {matchPercent !== undefined && matchPercent !== null ? (
        <div className="mt-4 flex items-center justify-between rounded-2xl border border-brand/25 bg-brand/[0.07] p-3 text-[13px] text-ink">
          <span>
            Taste match: <strong>{matchPercent}%</strong>
          </span>
          {viewerOrgId && !isSelf ? (
            <Link href={`/app/compare/${profile.username}`} className="text-[11px] font-medium text-brand hover:underline">
              Compare →
            </Link>
          ) : null}
        </div>
      ) : null}

      {pinnedReview ? (
        <section className="mt-6 rounded-2xl border border-brand/25 bg-brand/[0.07] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-[13px] font-semibold text-ink">Pinned review</h2>
            <ScoreText score={pinnedReview.score} />
          </div>
          <Link href={`/app/item/${pinnedReview.id}`} className="mt-1 block text-[13px] font-medium text-ink hover:underline">
            {pinnedReview.title}
          </Link>
          {pinnedReview.reviewText ? (
            <p className="mt-2 whitespace-pre-line text-[13px] leading-relaxed text-muted">{pinnedReview.reviewText}</p>
          ) : null}
        </section>
      ) : null}

      <div className="mt-6 flex gap-2 overflow-x-auto pb-1">
        {[
          { key: "topfive", label: "Podium" },
          { key: "everything", label: "Everything" },
          { key: "watchlist", label: "Watchlist" },
          { key: "pods", label: "Pods" },
          { key: "history", label: "History" },
        ].map((t) => (
          <Link
            key={t.key}
            href={`${profileHref}?tab=${t.key}`}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              activeTab === t.key
                ? "border-brand/40 bg-brand/15 text-brand"
                : "border-white/10 bg-white/5 text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </div>

      {activeTab === "topfive" ? (
        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between gap-3">
            <h2 className="text-[17px] font-semibold text-ink">Top five</h2>
            <Link
              href="/app/rankings"
              className="text-[11px] text-muted-2 hover:text-ink"
            >
              {podiumItems.length > 0 ? `Their ${MEDIA_KIND_LABELS[defaultKind].toLowerCase()} podium` : "All rankings"}
            </Link>
          </div>

          <div className="mb-4 flex gap-2 overflow-x-auto pb-1">
            {MEDIA_KINDS.map((kind) => {
              const count = podiums.find((entry) => entry.kind === kind)?.items.length ?? 0;
              const active = kind === defaultKind;
              return (
                <Link
                  key={kind}
                  href={`${profileHref}?tab=topfive&kind=${kind}`}
                  aria-current={active ? "page" : undefined}
                  className={`shrink-0 rounded-full border px-3 py-1.5 text-xs transition-colors ${
                    active
                      ? "border-brand/40 bg-brand/15 text-brand"
                      : count === 0
                        ? "border-white/5 bg-white/[0.02] text-muted-2"
                        : "border-white/10 bg-white/5 text-muted hover:text-ink"
                  }`}
                >
                  {MEDIA_KIND_LABELS[kind]}
                  {count > 0 ? <span className="ml-1 text-[10px] opacity-70">{count}</span> : null}
                </Link>
              );
            })}
          </div>

          {podiumItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
              <p className="text-sm font-medium text-ink">No {MEDIA_KIND_LABELS[defaultKind].toLowerCase()} podium yet</p>
              <p className="mt-1 text-[13px] text-muted">Rate a few {MEDIA_KIND_LABELS[defaultKind].toLowerCase()} to fill it in.</p>
              {isSelf ? (
                <Link href={`/app/browse?kind=${defaultKind}`} className="mt-3 inline-block">
                  <Button size="sm" variant="secondary">Find something to rate</Button>
                </Link>
              ) : null}
            </div>
          ) : (
            <div className="space-y-2">
              {champion ? (
                <Link
                  href={`/app/item/${champion.id}`}
                  className="relative block overflow-hidden rounded-2xl border border-brand/35 bg-gradient-to-br from-brand/[0.16] to-transparent p-4"
                >
                  <div className="flex items-center gap-4">
                    <div className="relative">
                      <MediaArt
                        kind={champion.kind}
                        title={champion.title}
                        imageUrl={champion.imageUrl}
                        className="h-24 w-24 rounded-xl"
                      />
                      <span className="absolute -left-1.5 -top-1.5 grid h-6 w-6 place-items-center rounded-full bg-brand text-[11px] font-extrabold text-black shadow">
                        1
                      </span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-brand-soft">Champion</p>
                      <p className="mt-1 truncate text-[17px] font-bold text-ink">{champion.title}</p>
                      <p className="truncate text-[11px] text-muted">
                        {champion.subtitle || MEDIA_KIND_LABELS[champion.kind]}
                        {champion.year ? ` · ${champion.year}` : ""}
                      </p>
                      <p className="mt-2 text-[11px] text-muted-2">
                        {champion.wins}W · {champion.losses}L · {champion.matches} matchups
                      </p>
                    </div>
                    <ScoreText score={champion.score} className="text-[26px]" />
                  </div>
                </Link>
              ) : null}

              <ol className="space-y-2">
                {podiumItems.slice(1).map((item, index) => (
                  <li key={item.id}>
                    <Link
                      href={`/app/item/${item.id}`}
                      className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5 transition-colors hover:border-white/15"
                    >
                      <span
                        className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-extrabold ${
                          index === 0
                            ? "bg-silver/15 text-silver ring-1 ring-silver/30"
                            : index === 1
                              ? "bg-bronze/15 text-bronze ring-1 ring-bronze/30"
                              : "text-white/25"
                        }`}
                      >
                        {RANKS[index + 1]}
                      </span>
                      <MediaArt kind={item.kind} title={item.title} imageUrl={item.imageUrl} className="h-12 w-12 rounded-lg" />
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
            </div>
          )}

          {topFive.length > 0 ? (
            <div className="mt-6 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
              <div className="flex items-center justify-between">
                <p className="text-[12px] font-medium text-ink">Overall top five</p>
                <ShareButton
                  title={`${profile.displayName}'s top five on Appolo`}
                  path={`${profileHref}?tab=topfive`}
                />
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-muted-2">
                {topFive.map((item) => item.title).join(" · ")}
              </p>
            </div>
          ) : null}

          {isSelf && podiumItems.length > 0 ? (
            <PodiumOrderEditor
              key={`${defaultKind}:${podiumItems.map((item) => item.id).join(":")}`}
              kind={defaultKind}
              items={podiumItems.map((item) => ({ id: item.id, title: item.title }))}
            />
          ) : null}
        </section>
      ) : null}

      {activeTab === "everything" ? (
        <section className="mt-6 pb-10">
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
                    <MediaArt kind={item.kind} title={item.title} imageUrl={item.imageUrl} className="aspect-square w-full rounded-lg" />
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
      ) : null}

      {activeTab === "watchlist" ? (
        <section className="mt-6 pb-10">
          <h2 className="mb-3 text-[17px] font-semibold text-ink">Watchlist</h2>
          {watchlist.length === 0 ? (
            <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">
              Nothing saved yet. Add items from an item page or{" "}
              <Link href="/app/browse" className="text-brand hover:underline">browse the catalog</Link>.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {watchlist.map((item) => (
                <Link key={item.id} href={`/app/item/${item.id}`} className="group">
                  <MediaArt kind={item.kind} title={item.title} imageUrl={item.imageUrl} className="aspect-square w-full rounded-xl" />
                  <p className="mt-2 truncate text-[13px] font-medium text-ink">{item.title}</p>
                  <p className="truncate text-[11px] text-muted-2">{item.subtitle}</p>
                </Link>
              ))}
            </div>
          )}
        </section>
      ) : null}

      {activeTab === "pods" ? (
        <section className="mt-6 pb-10">
          <h2 className="mb-3 text-[17px] font-semibold text-ink">Pods</h2>
          {pods.length === 0 ? (
            <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">No pods yet.</p>
          ) : (
            <div className="-mx-5 flex gap-3 overflow-x-auto px-5 pb-1">
              {pods.map((pod) => (
                <div key={pod.id} className="shrink-0">
                  <PodRow pod={pod} />
                  {isSelf ? (
                    <Link href={`/app/pods/${pod.id}`} className="mt-1 block text-center text-[10px] text-brand hover:underline">
                      Edit
                    </Link>
                  ) : null}
                </div>
              ))}
            </div>
          )}
          {isSelf ? (
            <div className="mt-4">
              <Link href="/app/pods/new">
                <Button size="sm" variant="secondary">Create a pod</Button>
              </Link>
            </div>
          ) : null}
        </section>
      ) : null}

      {activeTab === "history" ? (
        <section className="mt-6 pb-10">
          <h2 className="mb-3 text-[17px] font-semibold text-ink">History</h2>
          {isSelf ? (
            <Link href="/app/history" className="block rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted hover:text-ink">
              Open full history →
            </Link>
          ) : (
            <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">
              History is private.
            </p>
          )}
        </section>
      ) : null}
    </div>
  );
}
