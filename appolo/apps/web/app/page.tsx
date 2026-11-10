import Link from "next/link";
import { Button } from "@appolo/ui";
import { KindIcon, type KindGlyph } from "@/components/kind-icon";

const MEDIA: { kind: KindGlyph; label: string }[] = [
  { kind: "movie", label: "Movies" },
  { kind: "tv", label: "TV" },
  { kind: "music", label: "Music" },
  { kind: "podcast", label: "Podcasts" },
  { kind: "book", label: "Books" },
];

const PILLARS = [
  {
    index: "02",
    label: "The profile",
    title: "Your whole taste, one page",
    body: "Movies, TV, music, podcasts and books live together in a public profile anyone can read in seconds.",
    meta: ["Top five podium", "Tags and reviews", "Shareable pods"],
  },
  {
    index: "03",
    label: "The discovery",
    title: "Discovery through people",
    body: "Follow people whose recommendations land and see what they are actually into — not a faceless algorithm.",
    meta: ["A feed of real reviews", "Follow taste, not trends", "Find your next favourite"],
  },
];

const STEPS = [
  ["Pick something", "Search the catalog or tap a category."],
  ["Vote", "Choose the better of two in quick matchups."],
  ["Finish it", "Add tags, a pod, and a line of review."],
];

const FACTS = [
  ["Media types", "5"],
  ["Scoring", "Elo → 0–10"],
  ["Starting score", "5.0"],
  ["Payments", "None"],
];

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(60%_60%_at_35%_0%,rgba(74,222,128,0.14),transparent)]" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="font-display text-2xl font-semibold tracking-[-0.04em]">
          appolo<span className="text-brand">.</span>
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/demo" className="hidden sm:block">
            <Button variant="ghost" size="sm">
              See a profile
            </Button>
          </Link>
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

      <main className="relative mx-auto max-w-6xl px-6 pb-24">
        <section className="pt-14 sm:pt-20">
          <p className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-2">
            <span aria-hidden className="h-px w-8 bg-brand/70" />
            Rate · review · rank
          </p>
          <h1 className="mt-5 max-w-[11ch] text-[clamp(52px,13vw,132px)] font-extrabold leading-[0.84] tracking-[-0.055em]">
            anything
          </h1>

          <div className="mt-10 grid gap-8 border-t border-white/10 pt-8 lg:grid-cols-12 lg:gap-12">
            <p className="max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg lg:col-span-6">
              Your full taste in one profile. Rank what you love with quick “which is
              better?” matchups, share your top five, and find people whose recommendations
              hit.
            </p>
            <div className="lg:col-span-6 lg:border-l lg:border-white/[0.07] lg:pl-10">
              <div className="flex flex-wrap items-center gap-3">
                <Link href="/signup">
                  <Button size="lg">Create your profile</Button>
                </Link>
                <Link href="/demo">
                  <Button size="lg" variant="secondary">
                    Browse a profile
                  </Button>
                </Link>
              </div>
              <p className="mt-4 text-xs text-muted-2">
                Demo login: owner@appolo.test · appolo-demo-1234
              </p>
              <p className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-2">
                <span>
                  <span className="num font-medium text-ink">5</span> media types
                </span>
                <span>
                  <span className="num font-medium text-ink">0</span> ads or bots
                </span>
                <span>
                  <span className="num font-medium text-ink">1</span> profile
                </span>
              </p>
            </div>
          </div>

          <ul className="mt-10 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-white/[0.07] pt-5">
            {MEDIA.map((medium) => (
              <li key={medium.kind} className="flex items-center gap-2 text-xs text-muted">
                <KindIcon kind={medium.kind} className="h-4 w-4 text-brand/80" />
                {medium.label}
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-16 sm:mt-20">
          <div className="flex items-baseline justify-between border-b border-white/10 pb-3">
            <h2 className="text-[11px] font-medium uppercase tracking-[0.22em] text-muted-2">
              Why it works
            </h2>
            <span className="num text-[11px] text-muted-2">03</span>
          </div>

          <div className="grid gap-12 pt-8 lg:grid-cols-12">
            <article className="lg:col-span-6">
              <p className="num text-xs text-brand/80">01</p>
              <p className="mt-4 text-[11px] uppercase tracking-[0.18em] text-muted-2">
                The method
              </p>
              <h3 className="mt-2 max-w-[18ch] font-display text-4xl font-bold leading-[1.05] tracking-[-0.02em] sm:text-5xl">
                A smarter way to rate
              </h3>
              <p className="mt-5 max-w-md text-sm leading-relaxed text-muted sm:text-base">
                No more stressing over a number. Pick the better of two things in quick
                matchups and your score builds itself.
              </p>
              <p className="mt-6 text-xs uppercase tracking-[0.12em] text-muted-2">
                Head-to-head mini-game · Personal 0–10 scores · Every vote counts twice
              </p>
            </article>

            <div className="divide-y divide-white/[0.07] lg:col-span-6 lg:border-l lg:border-white/[0.07] lg:pl-10">
              {PILLARS.map((pillar) => (
                <article key={pillar.index} className="pb-8 last:pb-0 [&:not(:first-child)]:pt-8">
                  <div className="flex items-center gap-3">
                    <span className="num text-xs text-brand/80">{pillar.index}</span>
                    <span className="text-[11px] uppercase tracking-[0.18em] text-muted-2">
                      {pillar.label}
                    </span>
                  </div>
                  <h3 className="mt-2 text-xl font-semibold tracking-tight">{pillar.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-muted">{pillar.body}</p>
                  <p className="mt-3 text-xs uppercase tracking-[0.12em] text-muted-2">
                    {pillar.meta.join(" · ")}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-20 grid gap-12 border-t border-white/10 pt-12 lg:grid-cols-12">
          <div className="lg:col-span-6">
            <h2 className="max-w-[16ch] font-display text-4xl font-bold leading-[1.05] tracking-[-0.02em] sm:text-5xl">
              How a score is made.
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
              Every item starts at the same rating. Each head-to-head vote moves both items,
              and the resulting Elo maps onto a simple 0–10 score.
            </p>
            <dl className="mt-8 grid grid-cols-2 gap-x-8">
              {FACTS.map(([label, value]) => (
                <div key={label} className="border-t border-white/[0.07] py-3">
                  <dt className="text-xs text-muted-2">{label}</dt>
                  <dd className="num mt-1 text-sm font-medium text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </div>

          <ol className="lg:col-span-6">
            {STEPS.map(([title, body], index) => (
              <li
                key={title}
                className="flex gap-5 border-t border-white/[0.07] py-5 first:border-t-0 first:pt-0"
              >
                <span className="num pt-0.5 text-2xl font-semibold leading-none text-brand/80">
                  0{index + 1}
                </span>
                <span>
                  <span className="block text-sm font-medium text-ink">{title}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-muted">{body}</span>
                </span>
              </li>
            ))}
          </ol>
        </section>

        <p className="mt-12 border-l-2 border-brand/30 pl-4 text-xs leading-relaxed text-muted-2">
          A clean-room implementation. No competitor source code, private APIs, or
          authenticated scraping. The demo catalog is local, with room for documented media
          providers later.
        </p>
      </main>

      <footer className="relative border-t border-white/[0.07] py-6 text-center text-xs text-muted-2">
        appolo · rate · review · rank
      </footer>
    </div>
  );
}
