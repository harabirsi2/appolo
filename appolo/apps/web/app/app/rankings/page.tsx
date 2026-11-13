import Link from "next/link";
import { MEDIA_KIND_LABELS, MEDIA_KINDS, scoreBand, type MediaKind } from "@appolo/core";
import { requireSession } from "@/lib/session";
import {
  getRankingModel,
  hasManualOrder,
  rankedRatings,
  rankingFitsForKinds,
  tasteStats,
  type CrossKindFits,
} from "@/lib/services/rankings";
import { BackButton } from "@/components/back-button";
import { RankingsList } from "@/components/rankings-list";
import { KindIcon } from "@/components/kind-icon";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rankings" };

export default async function RankingsPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const session = await requireSession();
  const { kind } = await searchParams;
  const activeKind = MEDIA_KINDS.includes(kind as MediaKind) ? (kind as MediaKind) : undefined;

  const [rankings, stats, model, manual] = await Promise.all([
    rankedRatings(session.org.id, { kind: activeKind }),
    tasteStats(session.org.id),
    activeKind
      ? getRankingModel(session.org.id, activeKind).catch(() => null)
      : Promise.resolve(null),
    activeKind ? hasManualOrder(session.org.id, activeKind) : Promise.resolve(false),
  ]);

  // The All view combines each kind's fitted model; single-kind views already
  // have one model in hand.
  const fits: CrossKindFits = activeKind
    ? { byId: model?.byId ?? new Map(), comparisons: model?.comparisons ?? 0, kindCount: 1 }
    : await rankingFitsForKinds(session.org.id, [...new Set(rankings.map((item) => item.kind))]);
  const hasModel = fits.byId.size > 0;

  // A saved manual order already comes back in order; only fall back to the
  // fitted model when the user has not overridden it.
  const ordered = manual
    ? rankings
    : hasModel
      ? [...rankings].sort((a, b) => {
          const fitA = fits.byId.get(a.id);
          const fitB = fits.byId.get(b.id);
          if (fitA && fitB) return fitB.personalScore - fitA.personalScore;
          if (fitA) return -1;
          if (fitB) return 1;
          return b.elo - a.elo;
        })
      : rankings;

  return (
    <div className="px-5 pt-4">
      <div className="flex items-center justify-between">
        <BackButton />
        <Link href="/app/rate" className="text-xs text-brand hover:underline">
          Rate something
        </Link>
      </div>

      <h1 className="mt-4 text-[30px] font-extrabold tracking-tight text-ink">Rankings</h1>
      <p className="mt-1 text-[13px] text-muted">
        {stats.rated} ranked · {stats.matchups} matchups · {stats.averageScore.toFixed(1)} avg
      </p>
      {hasModel ? (
        <p className="mt-1 text-[11px] text-muted-2">
          {activeKind && model
            ? `Model order from ${model.comparisons} comparisons · tie parameter ν ${model.tieParameter.toFixed(2)} · ${model.converged ? "converged" : "approximate"}`
            : `Model order from ${fits.comparisons} comparisons across ${fits.kindCount} ${
                fits.kindCount === 1 ? "category" : "categories"
              }`}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href="/app/rankings"
          className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
            !activeKind
              ? "border-brand/40 bg-brand/15 text-brand"
              : "border-white/10 bg-white/5 text-muted hover:text-ink"
          }`}
        >
          All
        </Link>
        {MEDIA_KINDS.map((k) => (
          <Link
            key={k}
            href={`/app/rankings?kind=${k}`}
            className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              activeKind === k
                ? "border-brand/40 bg-brand/15 text-brand"
                : "border-white/10 bg-white/5 text-muted hover:text-ink"
            }`}
          >
            <KindIcon kind={k} className="h-3.5 w-3.5" />
            {MEDIA_KIND_LABELS[k]}
          </Link>
        ))}
      </div>

      <RankingsList
        kind={activeKind ?? null}
        items={ordered.map((item) => {
          const fit = fits.byId.get(item.id) ?? null;
          const confidence =
            fit === null
              ? null
              : fit.comparisons >= 20
                ? "high"
                : fit.comparisons >= 8
                  ? "medium"
                  : "low";
          return {
            id: item.id,
            kind: item.kind,
            title: item.title,
            subtitle: item.subtitle,
            year: item.year,
            genres: item.genres,
            score: item.score,
            imageUrl: item.imageUrl,
            bandLabel: scoreBand(item.score).label,
            fitText: fit
              ? `model ${fit.personalScore.toFixed(1)}/10 · ±${(1.96 * fit.standardError).toFixed(2)} · ${fit.comparisons} cmp · ${confidence} confidence`
              : null,
          };
        })}
      />
    </div>
  );
}