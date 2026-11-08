import Link from "next/link";
import { MEDIA_KIND_LABELS } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { tasteDna } from "@/lib/services/taste";
import { MediaArt } from "@/components/media-art";
import { RatingCurve, ScoreText } from "@/components/podiums";
import { ShareButton } from "@/components/share-button";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Taste DNA" };

export default async function TastePage() {
  const session = await requireSession();
  const dna = await tasteDna(session.org.id);
  const maxKind = Math.max(1, ...dna.kinds.map((entry) => entry.count));

  return (
    <div className="px-5 pt-4 pb-24">
      <div className="flex items-center justify-between">
        <BackButton fallback="/app" />
        <h1 className="text-[20px] font-bold text-ink">Taste DNA</h1>
        <ShareButton title="My taste on Appolo" path="/app/taste" />
      </div>

      <section className="mt-6 rounded-2xl border border-white/[0.06] bg-[#141416] p-4">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-[36px] font-bold leading-none tracking-tight text-ink">
              {dna.rated === 0 ? "—" : dna.average.toFixed(1)}
            </p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.14em] text-muted-2">Average score</p>
          </div>
          <div className="text-right text-[11px] text-muted-2">
            <p>{dna.rated} ranked</p>
            <p>{dna.matchups} matchups</p>
            {dna.streak.current > 0 ? <p className="text-brand">🔥 {dna.streak.current}-day streak</p> : null}
          </div>
        </div>
        {dna.rated > 0 ? (
          <>
            <RatingCurve distribution={dna.distribution} className="mt-3" />
            <div className="flex justify-between text-[10px] text-muted-2">
              <span>0</span>
              <span>5</span>
              <span>10</span>
            </div>
          </>
        ) : (
          <p className="mt-4 text-[13px] text-muted">
            Rate a few things and your curve builds itself.
          </p>
        )}
      </section>

      {dna.kinds.length > 0 ? (
        <section className="mt-7">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-[17px] font-semibold text-ink">By medium</h2>
            {dna.topKind ? (
              <span className="text-[11px] text-muted-2">Mostly {MEDIA_KIND_LABELS[dna.topKind].toLowerCase()}</span>
            ) : null}
          </div>
          <ul className="space-y-2.5">
            {dna.kinds.map((entry) => (
              <li key={entry.kind}>
                <Link href={`/app/rankings?kind=${entry.kind}`} className="block">
                  <div className="flex items-center justify-between text-[12px]">
                    <span className="font-medium text-ink">{MEDIA_KIND_LABELS[entry.kind]}</span>
                    <span className="text-muted-2">
                      {entry.count} · {entry.average.toFixed(1)} avg
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-white/[0.06]">
                    <span
                      className="block h-full rounded-full bg-brand/70"
                      style={{ width: `${Math.max(6, (entry.count / maxKind) * 100)}%` }}
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dna.genres.length > 0 ? (
        <section className="mt-7">
          <h2 className="mb-3 text-[17px] font-semibold text-ink">Your genres</h2>
          <div className="flex flex-wrap gap-1.5">
            {dna.genres.map((entry) => (
              <Link
                key={entry.genre}
                href={`/app/browse?genre=${encodeURIComponent(entry.genre)}`}
                className="rounded-full border border-brand/30 bg-brand/10 px-2.5 py-1 text-[11px] text-brand hover:bg-brand/20"
              >
                {entry.genre} <span className="text-brand-soft/70">{entry.count}</span>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {dna.contrarian.length > 0 ? (
        <section className="mt-7">
          <h2 className="text-[17px] font-semibold text-ink">Hot takes</h2>
          <p className="mb-3 mt-1 text-[12px] text-muted-2">
            Where your score is furthest from the room.
          </p>
          <ul className="space-y-2">
            {dna.contrarian.map((pick) => (
              <li key={pick.item.id}>
                <Link
                  href={`/app/item/${pick.item.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5 transition-colors hover:border-white/15"
                >
                  <MediaArt
                    kind={pick.item.kind}
                    title={pick.item.title}
                    imageUrl={pick.item.imageUrl}
                    className="h-11 w-11 rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{pick.item.title}</p>
                    <p className="truncate text-[11px] text-muted-2">
                      You {pick.yours.toFixed(1)} · room {pick.community.toFixed(1)} · {pick.others} raters
                    </p>
                  </div>
                  <span
                    className={`text-[13px] font-bold tabular-nums ${
                      pick.gap >= 0 ? "text-brand" : "text-danger"
                    }`}
                  >
                    {pick.gap >= 0 ? "+" : ""}
                    {pick.gap.toFixed(1)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {dna.rated === 0 ? (
        <div className="mt-8 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
          <p className="text-sm font-medium text-ink">Nothing to read yet</p>
          <p className="mt-1 text-[13px] text-muted">Play a few matchups and come back.</p>
          <Link href="/app/browse" className="mt-3 inline-block text-[13px] text-brand hover:underline">
            Browse the catalog →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
