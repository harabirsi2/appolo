import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@appolo/ui";
import { MEDIA_KIND_LABELS } from "@appolo/core";
import { MediaArt } from "@/components/media-art";
import { TOUR_POD_SLUG, TOUR_PROFILE_USERNAME } from "@/lib/constants";
import { pageMetadata } from "@/lib/seo";
import { getProfileByUsername, profileBundle } from "@/lib/services/social";
import { podByOwnerAndSlug } from "@/lib/services/pods";

/**
 * The landing page's "see a profile" link. There is no demo login any more:
 * `packages/db/src/seed.ts` creates the tour profile and pod in every
 * deployment, so this page always shows real, seeded content and never needs a
 * published password.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Tour a real profile",
  description:
    "See a filled-in Appolo profile — a ranked top five, scores, reviews and a shared pod. No login required.",
  path: "/demo",
});

export default async function DemoTourPage() {
  // A deployment that has not been seeded must still render a page, not a 404
  // or a 500: both reads are best-effort.
  const profile = await getProfileByUsername(TOUR_PROFILE_USERNAME).catch(() => null);
  const bundle = profile ? await profileBundle(profile).catch(() => null) : null;
  const pod = await podByOwnerAndSlug(TOUR_PROFILE_USERNAME, TOUR_POD_SLUG).catch(() => null);

  const sample = (bundle?.ratings ?? [])
    .filter((item) => Boolean(item.imageUrl))
    .slice(0, 5);

  return (
    <div className="mx-auto min-h-screen w-full max-w-3xl px-5 pb-16">
      <header className="flex items-center justify-between py-5">
        <Link href="/" className="font-display text-xl font-semibold tracking-[-0.04em]">
          appolo<span className="text-brand">.</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">
              Sign in
            </Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Start rating</Button>
          </Link>
        </nav>
      </header>

      <p className="mt-6 text-[11px] uppercase tracking-[0.18em] text-muted-2">Public tour</p>
      <h1 className="mt-2 text-[32px] font-extrabold leading-tight tracking-tight text-ink">
        A real profile, not a mockup
      </h1>
      <p className="mt-3 max-w-xl text-[14px] leading-relaxed text-muted">
        This is an actual account from the seeded catalog: real scores, real reviews, a
        public pod. Browse it without signing in, then make your own.
      </p>

      {profile ? (
        <>
          <section className="mt-8 rounded-3xl border border-white/[0.08] bg-[#141416] p-5">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="grid h-11 w-11 place-items-center rounded-full text-[15px] font-semibold text-ink"
                style={{ background: `hsl(${profile.avatarHue} 45% 26%)` }}
              >
                {profile.displayName.slice(0, 1)}
              </span>
              <div>
                <p className="text-[15px] font-semibold text-ink">{profile.displayName}</p>
                <p className="text-[12px] text-muted">@{profile.username}</p>
              </div>
            </div>
            {profile.bio ? <p className="mt-3 text-[13px] leading-relaxed text-muted">{profile.bio}</p> : null}

            {sample.length > 0 ? (
              <ul className="mt-5 divide-y divide-white/[0.06] border-t border-white/[0.06]">
                {sample.map((item) => (
                  <li key={item.id} className="flex items-center gap-3 py-3">
                    <MediaArt
                      kind={item.kind}
                      title={item.title}
                      imageUrl={item.imageUrl}
                      sizes="44px"
                      className="h-11 w-11 shrink-0 rounded-lg"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {item.title}
                      </span>
                      <span className="block text-[11px] text-muted-2">
                        {[MEDIA_KIND_LABELS[item.kind], item.year ? String(item.year) : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    </span>
                    <span className="num text-[15px] font-semibold text-brand">
                      {item.score.toFixed(1)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-5 flex flex-wrap gap-3">
              <Link href={`/${encodeURIComponent(profile.username)}`}>
                <Button size="md">Open the full profile</Button>
              </Link>
              {pod ? (
                <Link href={`/${encodeURIComponent(profile.username)}/${encodeURIComponent(TOUR_POD_SLUG)}`}>
                  <Button size="md" variant="secondary">
                    See the “{pod.title}” pod
                  </Button>
                </Link>
              ) : null}
            </div>
          </section>

          <section className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-2">What you are looking at</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                Scores come from head-to-head matchups, not a slider. The top five is the
                podium; the reviews and tags are optional extras.
              </p>
            </div>
            <div className="rounded-2xl border border-white/[0.07] bg-white/[0.03] p-4">
              <p className="text-[11px] uppercase tracking-[0.14em] text-muted-2">Your turn</p>
              <p className="mt-2 text-[13px] leading-relaxed text-muted">
                Six comparisons is enough for a first ranking. Most people get their first
                score in under a minute.
              </p>
            </div>
          </section>
        </>
      ) : (
        <section className="mt-8 rounded-3xl border border-white/[0.08] bg-[#141416] p-5">
          <p className="text-[15px] font-semibold text-ink">This deployment is not seeded yet</p>
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            The tour profile is created by <code className="text-ink">pnpm db:seed</code>. Until
            then there is nothing public to show — make your own profile and you will be the
            first one on the podium.
          </p>
          <Link href="/signup" className="mt-4 inline-block">
            <Button size="md">Create your profile</Button>
          </Link>
        </section>
      )}

      <p className="mt-10 border-t border-white/[0.07] pt-4 text-[11px] leading-relaxed text-muted-2">
        No demo password is published anywhere on this site. The tour is read-only public
        content; accounts are created by signing up.
      </p>
    </div>
  );
}
