import Link from "next/link";
import { Button, Card, CardTitle, EmptyState } from "@appolo/ui";
import { MEDIA_KIND_LABELS, MEDIA_KINDS, scoreBand, type MediaKind } from "@appolo/core";
import { cn } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { rankedRatings, tasteStats } from "@/lib/services/rankings";
import { MediaArt, ScoreBar, ScorePill } from "@/components/media-art";

export const metadata = { title: "Rankings" };

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const session = await requireSession();
  const { kind } = await searchParams;
  const activeKind = MEDIA_KINDS.includes(kind as MediaKind) ? (kind as MediaKind) : undefined;

  const [rankings, stats] = await Promise.all([
    rankedRatings(session.org.id, { kind: activeKind }),
    tasteStats(session.org.id),
  ]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-ink">Rankings</h1>
          <p className="mt-1 text-sm text-muted">
            {stats.rated} ranked · {stats.matchups} matchups · {stats.averageScore.toFixed(1)} avg
          </p>
        </div>
        <Link href="/app/rate">
          <Button size="md">Rate something</Button>
        </Link>
      </div>

      <div className="flex flex-wrap gap-2">
        <Link
          href="/app/rankings"
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs transition-colors",
            !activeKind
              ? "border-brand/40 bg-brand/15 text-brand-soft"
              : "border-border bg-surface text-muted hover:text-ink",
          )}
        >
          All
        </Link>
        {MEDIA_KINDS.map((k) => (
          <Link
            key={k}
            href={`/app/rankings?kind=${k}`}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition-colors",
              activeKind === k
                ? "border-brand/40 bg-brand/15 text-brand-soft"
                : "border-border bg-surface text-muted hover:text-ink",
            )}
          >
            {MEDIA_KIND_LABELS[k]}
          </Link>
        ))}
      </div>

      {rankings.length === 0 ? (
        <EmptyState
          title="No rankings yet"
          body="Once you start voting on matchups your ranked list will appear here."
          action={
            <Link href="/app/rate">
              <Button size="sm">Start rating</Button>
            </Link>
          }
        />
      ) : (
        <Card className="p-0">
          <ol className="divide-y divide-border">
            {rankings.map((item) => {
              const band = scoreBand(item.score);
              return (
                <li key={item.id}>
                  <Link
                    href={`/app/rate/${item.id}`}
                    className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-surface-2/40"
                  >
                    <span className="w-8 text-right text-sm font-semibold tabular-nums text-muted">
                      {item.position}
                    </span>
                    <MediaArt kind={item.kind} title={item.title} className="h-11 w-11" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                      <p className="truncate text-xs text-muted-2">
                        {item.subtitle}
                        {item.year ? ` · ${item.year}` : ""}
                      </p>
                    </div>
                    <div className="hidden w-40 shrink-0 md:block">
                      <ScoreBar score={item.score} />
                      <p className="mt-1 text-[11px] text-muted-2">
                        {item.wins}W · {item.losses}L · {item.matches} played
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="hidden text-[11px] text-muted-2 sm:inline">{band.label}</span>
                      <ScorePill score={item.score} />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ol>
        </Card>
      )}
    </div>
  );
}
