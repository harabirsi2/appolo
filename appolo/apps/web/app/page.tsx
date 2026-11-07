import Link from "next/link";
import { Badge, Button } from "@appolo/ui";

const PILLARS = [
  {
    title: "Reviews that compound",
    body: "Ask every customer at the right moment, route them to Google or Facebook, and answer every review in one inbox.",
    items: ["Automated SMS + email invites", "Private feedback before the public ask", "AI reply drafts with human approval"],
  },
  {
    title: "One shared inbox",
    body: "Text, webchat, email, and social DMs land in the same place — with consent checks before anything sends.",
    items: ["Assignment and internal notes", "Saved replies and templates", "Opt-out ledger enforced everywhere"],
  },
  {
    title: "An AI employee that books",
    body: "Answers 24/7, qualifies the lead, checks the calendar, books the job, and hands off with a summary.",
    items: ["Playbooks per location", "Knowledge-grounded answers", "Escalation rules you control"],
  },
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
            <Button size="sm">Start free</Button>
          </Link>
        </nav>
      </header>

      <main className="relative mx-auto max-w-6xl px-6 pb-24">
        <section className="py-16 text-center sm:py-24">
          <Badge tone="brand" className="mb-5">Phase 0 · foundations are live</Badge>
          <h1 className="mx-auto max-w-3xl text-balance text-4xl font-semibold tracking-tight sm:text-6xl">
            Every conversation becomes a review, a booking, and a customer.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-pretty text-base text-muted sm:text-lg">
            Appolo is the reputation and messaging platform for local businesses: review requests,
            a shared inbox, contacts, and an AI employee — without the payments bloat.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link href="/signup">
              <Button size="lg">Create a workspace</Button>
            </Link>
            <Link href="/login">
              <Button size="lg" variant="secondary">Sign in to the demo</Button>
            </Link>
          </div>
          <p className="mt-4 text-xs text-muted-2">
            Demo workspace: owner@appolo.test · appolo-demo-1234
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
              <h2 className="text-2xl font-semibold tracking-tight">Clean-room by design.</h2>
              <p className="mt-2 text-sm text-muted">
                Appolo is an independent implementation. No competitor source code, private APIs, or
                authenticated UI. Integrations use documented platform APIs only. Payments are
                deliberately out of scope.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              {[
                ["Review gating", "Never"],
                ["Consent ledger", "Enforced"],
                ["Multi-tenant RLS", "On"],
                ["Payments", "Out of scope"],
              ].map(([k, v]) => (
                <div key={k} className="rounded-lg border border-border bg-surface-2 p-3">
                  <p className="text-xs text-muted-2">{k}</p>
                  <p className="mt-1 font-medium text-ink">{v}</p>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="relative border-t border-border py-6 text-center text-xs text-muted-2">
        Appolo · reviews, messaging, AI · no payments
      </footer>
    </div>
  );
}