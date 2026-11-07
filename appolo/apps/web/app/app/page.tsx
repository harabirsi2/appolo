import Link from "next/link";
import { Badge, Button, Card, CardTitle, EmptyState, Stat } from "@appolo/ui";
import { MEDIA_KIND_LABELS, scoreBand } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { tasteStats, topFive } from "@/lib/services/rankings";
import { MediaArt, ScoreBar, ScorePill } from "@/components/media-art";

export const metadata = { title: "Home" };

const MEDALS = ["1", "2", "3", "4", "5"];

export default async function HomePage() {
  const session = await requireSession();
  const [stats, top] = await Promise.all([tasteStats(session.org.id), topFive(session.org.id)]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-ink">Your taste</h1>
          <p className="mt-1 text-sm text-muted">
            Head-to-head votes turn into a personalised score for everything you rank.
          </p>
        </div>
        <Link href="/app/rate" className="shrink-0">
          <Button size="md">Rate something</Button>
        </Link>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Ranked" value={stats.rated} hint="items with a score" />
        <Stat label="Matchups" value={stats.matchups} hint="head-to-head votes" />
        <Stat label="Avg score" value={stats.averageScore.toFixed(1)} hint="across everything" />
        <Stat
          label="Top kind"
          value={stats.topKind ? MEDIA_KIND_LABELS[stats.topKind] : "—"}
          hint="most ranked category"
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardTitle
            action={
              <Link href="/app/rankings" className="text-xs text-muted hover:text-ink">
                Full rankings →
              </Link>
            }
          >
            Top five
          </CardTitle>

          {top.length === 0 ? (
            <EmptyState
              title="Nothing ranked yet"
              body="Start a rating session and play a few quick head-to-head matchups to build your top five."
              action={
                <Link href="/app/rate">
                  <Button size="sm">Start rating</Button>
                </Link>
              }
            />
          ) : (
            <ol className="space-y-3">
              {top.map((item, index) => {
                const band = scoreBand(item.score);
                return (
                  <li key={item.id}>
                    <Link
                      href={`/app/rate/${item.id}`}
                      className="flex items-center gap-3 rounded-lg border border-border bg-surface-2/40 p-3 transition-colors hover:border-border-strong"
                    >
                      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand/15 text-xs font-bold text-brand-soft">
                        {MEDALS[index]}
                      </span>
                      <MediaArt kind={item.kind} title={item.title} className="h-12 w-12" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                        <p className="truncate text-xs text-muted-2">
                          {item.subtitle}
                          {item.year ? ` · ${item.year}` : ""}
                        </p>
                        <ScoreBar score={item.score} className="mt-2 max-w-xs" />
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        <ScorePill score={item.score} />
                        <Badge tone={band.tone}>{band.label}</Badge>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ol>
          )}
        </Card>

        <div className="space-y-6">
          <Card>
            <CardTitle>How scoring works</CardTitle>
            <ul className="space-y-2 text-sm text-muted">
              <li className="flex gap-2">
                <span className="text-brand-soft">1.</span>
                <span>Pick something to rank from the catalog.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-brand-soft">2.</span>
                <span>Vote in quick “which is better?” matchups.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-brand-soft">3.</span>
                <span>Each win nudges the score up — every item starts at 5.0.</span>
              </li>
            </ul>
            <div className="mt-4">
              <Link href="/app/rate">
                <Button variant="secondary" size="sm">Browse catalog</Button>
              </Link>
            </div>
          </Card>

          <Card>
            <CardTitle>Your profile</CardTitle>
            <p className="text-sm text-muted">
              Rankings are saved to <span className="text-ink">{session.org.name}</span>.
            </p>
            <p className="mt-1 text-xs text-muted-2">
              Signed in as {session.user.email}
            </p>
          </Card>
        </div>
      </div>
    </div>
  );
}
