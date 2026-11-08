import Link from "next/link";
import { Button } from "@appolo/ui";

const PILLARS = [
  {
    title: "A smarter way to rate",
    body: "No more stressing over a number. Pick the better of two things in quick matchups and your score builds itself.",
    items: ["Head-to-head mini-game", "Personal 0–10 scores", "Every vote counts twice"],
  },
  {
    title: "Your whole taste, one profile",
    body: "Movies, TV, music, podcasts, and books live together in a public profile anyone can get the vibe of in seconds.",
    items: ["Top five podium", "Tags and reviews", "Shareable pods"],
  },
  {
    title: "Discovery through people",
    body: "Follow people with great recommendations and see what they are actually into — not a faceless algorithm.",
    items: ["A feed of real reviews", "Follow taste, not trends", "Find your next favourite"],
  },
];

const STEPS = [
  ["Pick something", "Search the catalog or tap a category."],
  ["Vote", "Choose the better of two in quick matchups."],
  ["Finish it", "Add tags, a pod, and a line of review."],
];

export default function HomePage() {
  return (
    <div className="relative overflow-hidden">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(70%_60%_at_50%_0%,rgba(74,222,128,0.16),transparent)]" />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
        <Link href="/" className="text-xl font-extrabold tracking-tight">
          appolo
        </Link>
        <nav className="flex items-center gap-2">
          <Link href="/demo" className="hidden sm:block">
            <Button variant="ghost" size="sm">See a profile</Button>
          </Link>
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
          <p className="text-xl font-medium tracking-tight text-ink sm:text-3xl">rate, review, and rank</p>
          <h1 className="mt-1 text-[64px] font-extrabold leading-[0.9] tracking-[-0.04em] sm:text-[128px]">
            ANYTHING
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-pretty text-base text-muted sm:text-lg">
            Movies, shows, music, podcasts, books — your full taste in one profile. Rank what you
            love with quick “which is better?” matchups, share your top five, and find people whose
            recommendations hit.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg">Create your profile</Button>
            </Link>
            <Link href="/demo">
              <Button size="lg" variant="secondary">Browse a profile</Button>
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-2">
            Demo login: owner@appolo.test · appolo-demo-1234
          </p>

          <div className="mx-auto mt-14 flex max-w-md items-center justify-center gap-10">
            <Laurel value="5" label="media types" />
            <Laurel value="0" label="ads or bots" />
            <Laurel value="1" label="profile" />
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-3">
          {PILLARS.map((pillar) => (
            <div key={pillar.title} className="rounded-2xl border border-white/[0.07] bg-[#101012] p-6">
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

        <section className="mt-16 rounded-3xl border border-white/[0.07] bg-[#101012] p-8">
          <div className="grid gap-6 md:grid-cols-[1.2fr_1fr] md:items-center">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">How a score is made.</h2>
              <p className="mt-2 text-sm text-muted">
                Every item starts at the same rating. Each head-to-head vote moves both items, and
                the resulting Elo maps onto a simple 0–10 score.
              </p>
              <ol className="mt-5 space-y-3">
                {STEPS.map(([title, body], index) => (
                  <li key={title} className="flex gap-3 text-sm">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-brand/15 text-xs font-bold text-brand">
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
                <div key={k} className="rounded-xl border border-white/[0.07] bg-white/[0.03] p-3">
                  <p className="text-xs text-muted-2">{k}</p>
                  <p className="mt-1 font-medium text-ink">{v}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="mt-8 rounded-xl border border-dashed border-white/10 bg-white/[0.02] p-5 text-xs text-muted-2">
          A clean-room implementation. No competitor source code, private APIs, or authenticated
          scraping. The demo catalog is local, with room for documented media providers later.
        </section>
      </main>

      <footer className="relative border-t border-white/[0.07] py-6 text-center text-xs text-muted-2">
        appolo · rate · review · rank
      </footer>
    </div>
  );
}

function Laurel({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex items-center gap-1 text-white/85">
      <span className="text-2xl leading-none" aria-hidden>🌿</span>
      <div className="text-center">
        <p className="text-2xl font-extrabold leading-none tracking-tight">{value}</p>
        <p className="mt-1 text-[10px] font-medium text-muted">{label}</p>
      </div>
      <span className="scale-x-[-1] text-2xl leading-none" aria-hidden>🌿</span>
    </div>
  );
}