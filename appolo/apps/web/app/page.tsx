import Link from "next/link";
import { desc, isNotNull } from "drizzle-orm";
import { Button } from "@appolo/ui";
import type { MediaKind } from "@appolo/core";
import { KindIcon, type KindGlyph } from "@/components/kind-icon";
import { MediaArt } from "@/components/media-art";
import { getDb, schema } from "@/lib/db";

// The CSP nonce is attached during rendering. A prerendered page cannot carry
// a per-request nonce, so render the landing page dynamically.
export const dynamic = "force-dynamic";

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
  ["Pick two", "Search the catalog or tap a category; we put an opponent in front of you."],
  ["Tap the better one", "No slider, no number to agonise over. At most six comparisons and the score settles."],
  ["Finish it", "Add tags, a pod, and a line of review if you want to."],
];

const FACTS = [
  ["Media types", "5"],
  ["How you rate", "One tap"],
  ["What you never do", "Pick a number"],
  ["Payments", "None"],
];

interface DuelCard {
  id: string;
  kind: MediaKind;
  title: string;
  year: number | null;
  imageUrl: string | null;
}

/**
 * Two real catalog rows for the hero's duel frame. A landing page must render
 * even when the database is unreachable or unseeded, so this degrades to
 * placeholder cards instead of failing the request.
 */
async function duelPair(): Promise<[DuelCard | null, DuelCard | null]> {
  try {
    const rows = await getDb()
      .select({
        id: schema.catalogItems.id,
        kind: schema.catalogItems.kind,
        title: schema.catalogItems.title,
        year: schema.catalogItems.year,
        imageUrl: schema.catalogItems.imageUrl,
      })
      .from(schema.catalogItems)
      .where(isNotNull(schema.catalogItems.imageUrl))
      .orderBy(desc(schema.catalogItems.year))
      .limit(2);
    return [rows[0] ?? null, rows[1] ?? null];
  } catch {
    return [null, null];
  }
}

export default async function HomePage() {
  const [left, right] = await duelPair();

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
        <section className="pt-12 sm:pt-16">
          <div className="grid items-center gap-10 lg:grid-cols-12 lg:gap-14">
            <div className="lg:col-span-6">
              <p className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-[0.22em] text-muted-2">
                <span aria-hidden className="h-px w-8 bg-brand/70" />
                Compare, don&rsquo;t score
              </p>
              <h1 className="mt-5 max-w-[13ch] text-[clamp(44px,9vw,88px)] font-extrabold leading-[0.9] tracking-[-0.05em]">
                Which is better?
              </h1>
              <p className="mt-6 max-w-xl text-pretty text-base leading-relaxed text-muted sm:text-lg">
                That is the whole rating flow. Two titles at a time, one tap, and your
                0&ndash;10 score builds itself from the choices you make. No sliders, no
                agonising over a number, no five-star inflation.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Link href="/signup">
                  <Button size="lg">Start rating</Button>
                </Link>
                <Link href="/demo">
                  <Button size="lg" variant="secondary">
                    Tour a real profile
                  </Button>
                </Link>
              </div>
              <p className="mt-6 flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-2">
                <span>
                  <span className="num font-medium text-ink">5</span> media types
                </span>
                <span>
                  <span className="num font-medium text-ink">1</span> tap per comparison
                </span>
                <span>
                  <span className="num font-medium text-ink">0</span> score sliders
                </span>
              </p>
            </div>

            {/*
              Hero visual. Screenshot to drop in: the real duel screen
              (/app/rate/{itemId}) with two posters, the VS badge between them,
              and the keyboard hints underneath — captured at 720x900, no
              browser chrome, dark theme. Until that shot exists this frame
              renders two real catalog covers so the page still shows the
              product, not a mockup.
            */}
            <figure className="lg:col-span-6" data-screenshot="duel-pair">
              <div className="rounded-3xl border border-white/[0.08] bg-[#101012] p-5 shadow-2xl">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-2">Which is better?</p>
                  <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] text-muted-2">
                    1 vote · score updated
                  </span>
                </div>
                <div className="relative mt-4 grid grid-cols-2 gap-3">
                  <DuelSide card={left} placeholder="Dune" hint="1" />
                  <DuelSide card={right} placeholder="Parasite" hint="2" />
                  <span className="pointer-events-none absolute left-1/2 top-1/2 z-10 grid h-8 w-8 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black text-[9px] font-bold tracking-wide text-white/70">
                    VS
                  </span>
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <span className="min-h-9 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-[12px] text-ink">
                    Equally good
                  </span>
                  <span className="min-h-9 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-center text-[12px] text-ink">
                    Too close to call
                  </span>
                </div>
                <p className="mt-3 text-[11px] text-muted-2">
                  Your score moves after every pick &mdash; and you can always undo the last one.
                </p>
              </div>
              <figcaption className="mt-3 text-center text-[11px] text-muted-2">
                The duel screen, with real covers. One tap, then the next pair.
              </figcaption>
            </figure>
          </div>

          <ul className="mt-12 flex flex-wrap items-center gap-x-8 gap-y-3 border-t border-white/[0.07] pt-5">
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
                Compare two, not one in ten
              </h3>
              <p className="mt-5 max-w-md text-sm leading-relaxed text-muted sm:text-base">
                Rating one thing in isolation is guesswork — everyone&rsquo;s 7 means
                something different. Choosing between two titles you already know is a
                decision you can actually make, so the ranking reflects preference
                instead of mood.
              </p>
              <p className="mt-6 text-xs uppercase tracking-[0.12em] text-muted-2">
                Head-to-head matchups · Personal 0&ndash;10 scores · Every vote counts twice
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
              Every title starts level. Each matchup moves both sides, and the resulting Elo
              maps onto a simple 0&ndash;10 score &mdash; so the number is a summary of your
              choices, never an input.
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
        appolo · compare · review · rank
      </footer>
    </div>
  );
}

function DuelSide({
  card,
  placeholder,
  hint,
}: {
  card: DuelCard | null;
  placeholder: string;
  hint: string;
}) {
  return (
    <div className="relative flex flex-col items-center gap-2 rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.03] p-3 text-center">
      <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 text-[9px] font-bold text-white/50">
        {hint}
      </span>
      <MediaArt
        kind={card?.kind ?? "movie"}
        title={card?.title ?? placeholder}
        imageUrl={card?.imageUrl ?? null}
        sizes="96px"
        className="h-[96px] w-[96px] rounded-xl"
      />
      <span className="line-clamp-2 text-[13px] font-semibold leading-tight text-ink">
        {card?.title ?? placeholder}
      </span>
      <span className="text-[11px] text-muted-2">{card?.year ?? "—"}</span>
    </div>
  );
}
