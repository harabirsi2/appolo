import Link from "next/link";
import { Badge, Button } from "@appolo/ui";

const PILLARS = [
  {
    title: "Head-to-head scoring",
    body: "Pick between two things you know. Every matchup nudges an Elo rating, so your score reflects real preferences instead of guesswork.",
    items: ["Quick “which is better?” mini-game", "Personal 0–10 scores", "Wins against stronger items count more"],
  },
  {
    title: "Your top five",
    body: "Rankings roll up into a podium. See your favourites across movies, TV, music, podcasts, and books at a glance.",
    items: ["Live ranked list", "Filter by media kind", "Wins, losses, and matchups tracked"],
  },
  {
    title: "A catalog to explore",
    body: "Browse a curated demo catalog, search by title or creator, and start a rating session in one tap.",
    items: ["Five media types", "Search by title or creator", "Responsive, installable PWA"],
  },
];

const STEPS = [
  ["Browse", "Pick something from the catalog."],
  ["Vote", "Choose the better of two in quick matchups."],
  ["Rank", "Watch your personalised score and top five take shape."],
];

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[420px] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(99,102,241,0.22),transparent)]" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <div className="flex items-center gap-2">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-brand text-sm font-bold text-white">A</div>
          <span className="text-lg font-semibold tracking-tight">Appolo</span>
        </div>
        <nav className="flex items-center gap-2">
          <Link href="/login">
            <Button variant="ghost" size="sm">Sign in</Button>
          </Link>
          <Link href="/signup">
            <Button size="sm">Start rating</Button>
          </Link>
        </nav>
      </header>

      <main className="relative mx-auto max-w-6xl px-6 pb-24">
        <section className="py-16 text-center sm:py-24">
          <Badge tone="brand" className="mb-5">Rate · rank · discover</Badge>
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Rate anything. Rank everything.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted sm:text-lg">
            Appolo turns quick “which is better?” matchups into a personalised score for the
            movies, TV, music, podcasts, and books you love. Build your top five and see how your
            taste stacks up.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg">Create your profile</Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="secondary">Sign in</Button>
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-2">
            Demo profile: owner@appolo.test · appolo-demo-1234
          </p>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div key={pillar.title} className="rounded-xl border border-border bg-surface p-6">
              <h2 className="text-base font-semibold">{pillar.title}</h2>
              <p className="mt-2 text-sm text-muted">{pillar.body}</p>
              <ul className="mt-4 space-y-2">
                {pillar.items.map((item) => (
                  <li key={item} className="flex gap-2 text-sm text-muted">
                    <span className="mt-0.5 text-brand">✓</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section className="mt-16 rounded-2xl border border-border bg-surface/60 p-8">
          <div className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">How a score is made.</h2>
              <p className="mt-2 text-sm text-muted">
                Every item starts at the same rating. Each head-to-head vote moves both items up or
                down, and the resulting Elo is mapped onto a simple 0–10 score.
              </p>
              <ol className="mt-5 space-y-3">
                {STEPS.map(([title, body], index) => (
                  <li key={title} className="flex gap-3 text-sm">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/15 text-xs font-bold text-brand-soft">
                      {index + 1}
                    </span>
                    <span className="text-muted">
                      <span className="font-medium text-ink">{title}.</span> {body}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Media types", "5"],
                ["Scoring", "Elo → 0–10"],
                ["Starting score", "5.0"],
                ["Payments", "None"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border bg-surface-2 p-3">
                  <p className="text-xs text-muted-2">{k}</p>
                  <p className="mt-1 font-medium text-ink">{v}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-xl border border-dashed border-border bg-surface/40 p-5 text-xs text-muted-2">
          A clean-room implementation. No competitor source code, private APIs, or authenticated
          scraping. The demo catalog is local, with room for documented media providers later.
        </section>
      </main>

      <footer className="relative border-t border-border py-6 text-center text-xs text-muted-2">
        Appolo · rate · rank · discover
      </footer>
    </div>
  );
}