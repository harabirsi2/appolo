import Link from "next/link";
import { MEDIA_KIND_LABELS, MEDIA_KINDS, scoreBand, type MediaKind } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { rankedRatings, tasteStats } from "@/lib/services/rankings";
import { MediaArt } from "@/components/media-art";
import { BackButton } from "@/components/back-button";
import { ScoreText } from "@/components/podiums";
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

  const [rankings, stats] = await Promise.all([
    rankedRatings(session.org.id, { kind: activeKind }),
    tasteStats(session.org.id),
  ]);

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

      <ol className="mt-5 space-y-2 pb-10">
        {rankings.map((item, index) => {
          const band = scoreBand(item.score);
          return (
            <li key={item.id}>
              <Link
                href={`/app/item/${item.id}`}
                className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5 transition-colors hover:border-white/15"
              >
                <span className="grid w-6 shrink-0 place-items-center text-[16px] font-extrabold text-white/25">
                  {index + 1}
                </span>
                <MediaArt kind={item.kind} title={item.title} genres={item.genres} className="h-12 w-12 rounded-lg" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-semibold text-ink">{item.title}</p>
                  <p className="truncate text-[11px] text-muted-2">
                    {item.subtitle || MEDIA_KIND_LABELS[item.kind]}
                    {item.year ? ` · ${item.year}` : ""} · {band.label}
                  </p>
                </div>
                <ScoreText score={item.score} className="text-[15px]" />
              </Link>
            </li>
          );
        })}
        {rankings.length === 0 ? (
          <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">
            Nothing ranked in this category yet.
          </p>
        ) : null}
      </ol>
    </div>
  );
}