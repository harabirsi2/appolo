import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MEDIA_KIND_LABELS, scoreBand } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { getCatalogItem } from "@/lib/services/rankings";
import { explainPosition, type ComparisonMover } from "@/lib/services/explain";
import { ConfidenceBadge } from "@/components/confidence-badge";
import { BackButton } from "@/components/back-button";
import { getRankingModel } from "@/lib/services/ranking-math";
import { scoreInterval } from "@appolo/core";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Params) {
  const { id } = await params;
  const item = await getCatalogItem(id);
  return { title: item ? `Why ${item.title} sits where it does` : "Why" };
}

function when(date: Date): string {
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.floor(days / 30);
  return months <= 1 ? "a month ago" : `${months} months ago`;
}

function moverLine(mover: ComparisonMover): string {
  switch (mover.result) {
    case "win":
      return `Picked over ${mover.opponentTitle}`;
    case "loss":
      return `Lost to ${mover.opponentTitle}`;
    case "tie":
      return `Tied with ${mover.opponentTitle}`;
    case "skip":
      return `Skipped against ${mover.opponentTitle}`;
    default:
      return `Too close to call against ${mover.opponentTitle}`;
  }
}

/**
 * The drill-down behind a position. Every number here is derived from
 * `item_matchups` — the Elo before/after columns record exactly what each
 * comparison did, so "why is this #1" is a read, not a reconstruction.
 */
export default async function WhyPage({ params }: Params) {
  const session = await requireSession();
  const { id } = await params;
  const item = await getCatalogItem(id);
  if (!item) notFound();

  const explanation = await explainPosition(session.org.id, id);
  // Nothing to explain until the item has a rating of its own.
  if (!explanation) redirect(`/app/item/${id}`);

  const model = await getRankingModel(session.org.id, item.kind).catch(() => null);
  const fit = model?.byId.get(id) ?? null;
  const interval = fit && model ? scoreInterval(fit, model.items, model.tieParameter) : null;
  const counted = explanation.movers.filter((mover) => mover.result !== "skip" && mover.result !== "undecided");
  const positionWord = explanation.position === 1 ? "first" : `#${explanation.position}`;

  return (
    <div className="mx-auto max-w-2xl px-5 pb-16 pt-5">
      <div className="flex items-center gap-3">
        <BackButton fallback={`/app/item/${id}`} />
        <p className="truncate text-[12px] text-muted-2">{item.title}</p>
      </div>

      <header className="mt-5">
        <p className="text-[11px] uppercase tracking-[0.16em] text-brand/80">Why it sits here</p>
        <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight tracking-[-0.02em] text-ink">
          {explanation.position === 1
            ? `#1 in ${MEDIA_KIND_LABELS[item.kind]}`
            : `${positionWord} in ${MEDIA_KIND_LABELS[item.kind]}`}
        </h1>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">
          Of {explanation.of} {MEDIA_KIND_LABELS[item.kind].toLowerCase()} you have ranked, from{" "}
          {explanation.countedMatchups} counted comparison
          {explanation.countedMatchups === 1 ? "" : "s"}
          {explanation.skippedMatchups > 0
            ? ` and ${explanation.skippedMatchups} skipped`
            : ""}
          . Nothing here is a guess: every line is a vote you cast.
        </p>
      </header>

      <section className="mt-5 rounded-2xl border border-white/[0.07] bg-[#111113] p-4">
        <div className="flex items-baseline justify-between gap-3">
          <div>
            <p className="text-[9px] uppercase tracking-[0.14em] text-muted-2">Your score</p>
            <p className="mt-1 flex items-baseline gap-1">
              <span className="num text-[30px] font-bold leading-none text-ink">
                {explanation.score.toFixed(1)}
              </span>
              <span className="text-[12px] text-muted-2">/10 · {scoreBand(explanation.score).label}</span>
            </p>
          </div>
          <div className="text-right">
            {interval ? (
              <ConfidenceBadge interval={interval} className="items-end" />
            ) : (
              <p className="text-[11px] text-muted-2">
                {explanation.comparisons} comparison{explanation.comparisons === 1 ? "" : "s"}
              </p>
            )}
          </div>
        </div>

        {explanation.neighbour ? (
          <p className="mt-3 border-t border-white/[0.06] pt-3 text-[12px] leading-relaxed text-muted">
            {explanation.position === 1 ? (
              <>
                Leads #2, <Link href={`/app/item/${explanation.neighbour.id}`} className="font-medium text-ink hover:text-brand">{explanation.neighbour.title}</Link>{" "}
                ({explanation.neighbour.score.toFixed(1)}), by {explanation.gap.toFixed(1)} Elo — in a
                rematch you would pick it{" "}
                <span className="text-ink">{Math.round(explanation.neighbour.beatsProbability * 100)}%</span> of
                the time.
              </>
            ) : (
              <>
                Chasing{" "}
                <Link href={`/app/item/${explanation.neighbour.id}`} className="font-medium text-ink hover:text-brand">
                  {explanation.neighbour.title}
                </Link>{" "}
                ({explanation.neighbour.score.toFixed(1)}) — {explanation.gap.toFixed(1)} Elo behind. A
                rematch would go this way{" "}
                <span className="text-ink">{Math.round(explanation.neighbour.beatsProbability * 100)}%</span> of
                the time.
              </>
            )}
          </p>
        ) : (
          <p className="mt-3 border-t border-white/[0.06] pt-3 text-[12px] text-muted">
            Rank one more {MEDIA_KIND_LABELS[item.kind].toLowerCase().replace(/s$/, "")} and this gets a
            neighbour to compare against.
          </p>
        )}
      </section>

      <section className="mt-6">
        <h2 className="text-[15px] font-semibold text-ink">Comparisons that moved it most</h2>
        {counted.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {counted.map((mover) => (
              <li
                key={mover.matchupId}
                className="flex items-center justify-between gap-3 rounded-xl border border-white/[0.06] bg-white/[0.02] px-3 py-2.5"
              >
                <div className="min-w-0">
                  <Link
                    href={`/app/item/${mover.opponentId}`}
                    className="block truncate text-[13px] font-medium text-ink hover:text-brand"
                  >
                    {moverLine(mover)}
                  </Link>
                  <p className="text-[11px] text-muted-2">
                    {when(mover.at)}
                    {mover.opponentScore === null ? "" : ` · they were at ${mover.opponentScore.toFixed(1)}`}
                  </p>
                </div>
                <span
                  className={`num shrink-0 text-[13px] font-semibold ${
                    mover.delta >= 0 ? "text-brand" : "text-[#ef8b8b]"
                  }`}
                >
                  {mover.delta >= 0 ? "+" : ""}
                  {mover.delta}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            No counted comparisons yet — only skips and calls too close to score. Nothing has moved
            this title, which is why its score has not budged.
          </p>
        )}
      </section>

      <div className="mt-7 flex flex-wrap items-center gap-3">
        <Link
          href={`/app/rate/${id}`}
          className="rounded-full bg-brand px-4 py-2 text-[13px] font-semibold text-black"
        >
          Challenge it
        </Link>
        <Link href={`/app/item/${id}`} className="text-[12px] text-muted-2 hover:text-ink">
          Back to the title
        </Link>
        <Link href="/app/rankings" className="text-[12px] text-muted-2 hover:text-ink">
          All rankings
        </Link>
      </div>

      <p className="mt-8 text-[11px] leading-relaxed text-muted-2">
        Scores come from a Bradley–Terry–Davidson fit with a tie parameter; the ± is its 95%
        interval after correcting for overdispersion. Skips and undecided calls are recorded but do
        not move a score.
      </p>
    </div>
  );
}
