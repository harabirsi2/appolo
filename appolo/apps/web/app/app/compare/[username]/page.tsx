import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { MEDIA_KIND_LABELS } from "@appolo/core";
import { KindIcon } from "@/components/kind-icon";
import { requireSession } from "@/lib/session";
import { compareTaste, getProfileByOrgId, getProfileByUsername } from "@/lib/services/social";
import { MediaArt } from "@/components/media-art";
import { Avatar, ScoreText } from "@/components/podiums";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Compare" };

type Params = { params: Promise<{ username: string }> };

export default async function ComparePage({ params }: Params) {
  const session = await requireSession();
  const { username } = await params;
  const other = await getProfileByUsername(decodeURIComponent(username));
  if (!other) notFound();
  if (other.orgId === session.org.id) redirect("/app/profile");

  const [me, comparison] = await Promise.all([
    getProfileByOrgId(session.org.id),
    compareTaste(session.org.id, other.orgId),
  ]);
  if (!me || !comparison) notFound();

  return (
    <div className="px-5 pt-4 pb-24">
      <BackButton fallback={`/${other.username}`} />

      <h1 className="mt-4 text-[30px] font-extrabold tracking-tight text-ink">Taste check</h1>

      <div className="mt-4 flex items-center justify-between rounded-2xl border border-brand/25 bg-brand/[0.07] p-4">
        <div className="flex items-center gap-2">
          <Avatar name={me.displayName} hue={me.avatarHue} size={40} />
          <div>
            <p className="text-[12px] font-semibold text-ink">You</p>
            <p className="text-[10px] text-muted-2">{`@${me.username}`}</p>
          </div>
        </div>
        <div className="text-center">
          <p className="text-[26px] font-bold leading-none text-brand">{comparison.shared === 0 ? "—" : `${comparison.match}%`}</p>
          <p className="text-[9px] uppercase tracking-[0.14em] text-muted-2">match</p>
        </div>
        <Link href={`/${other.username}`} className="flex items-center gap-2">
          <div className="text-right">
            <p className="text-[12px] font-semibold text-ink">{other.displayName}</p>
            <p className="text-[10px] text-muted-2">{`@${other.username}`}</p>
          </div>
          <Avatar name={other.displayName} hue={other.avatarHue} size={40} />
        </Link>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5">
          <p className="text-[16px] font-semibold text-ink">{comparison.shared}</p>
          <p className="text-[10px] text-muted-2">shared</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5">
          <p className="text-[16px] font-semibold text-brand">{comparison.agreements}</p>
          <p className="text-[10px] text-muted-2">in sync</p>
        </div>
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5">
          <p className="text-[16px] font-semibold text-danger">{comparison.shared - comparison.agreements}</p>
          <p className="text-[10px] text-muted-2">clashes</p>
        </div>
      </div>

      <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-2">
        {comparison.basis}
      </p>

      {comparison.kinds.length > 0 ? (
        <section className="mt-4">
          <h2 className="mb-2 text-[13px] font-semibold text-ink">Match by category</h2>
          <div className="grid grid-cols-2 gap-2">
            {comparison.kinds.map((entry) => (
              <div
                key={entry.kind}
                className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] p-2.5"
              >
                <KindIcon kind={entry.kind} className="h-4 w-4 shrink-0 text-brand" />
                <div className="min-w-0">
                  <p className="truncate text-[10px] uppercase tracking-[0.1em] text-muted-2">
                    {MEDIA_KIND_LABELS[entry.kind]}
                  </p>
                  <p className="text-[13px] font-semibold text-ink">
                    {entry.match === null ? "—" : `${entry.match}%`}
                    <span className="ml-1 text-[9px] font-normal text-muted-2">
                      {entry.shared} shared · {entry.confidence}
                    </span>
                  </p>
                </div>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {comparison.shared === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-white/10 bg-white/[0.02] p-6 text-center">
          <p className="text-sm font-medium text-ink">Nothing to compare yet</p>
          <p className="mt-1 text-[13px] text-muted">
            You both need to rank the same title before a comparison appears.
          </p>
          <Link href="/app/browse" className="mt-3 inline-block text-[13px] text-brand hover:underline">
            Find something you have both seen →
          </Link>
        </div>
      ) : (
        <section className="mt-6">
          <div className="mb-3 flex items-end justify-between">
            <h2 className="text-[17px] font-semibold text-ink">Biggest disagreements</h2>
            <span className="text-[11px] text-muted-2">you / them</span>
          </div>
          <ol className="space-y-2">
            {comparison.entries.map((entry) => (
              <li key={entry.item.id}>
                <Link
                  href={`/app/item/${entry.item.id}`}
                  className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5 transition-colors hover:border-white/15"
                >
                  <MediaArt
                    kind={entry.item.kind}
                    title={entry.item.title}
                    imageUrl={entry.item.imageUrl}
                    className="h-12 w-12 rounded-lg"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-semibold text-ink">{entry.item.title}</p>
                    <p className="truncate text-[11px] text-muted-2">
                      {Math.abs(entry.gap) <= 0.5 ? "In sync" : entry.gap > 0 ? "You rate it higher" : "They rate it higher"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 text-[12px] tabular-nums">
                    <span className={entry.gap > 0 ? "font-semibold text-brand" : "text-muted"}>{entry.mine.toFixed(1)}</span>
                    <span className="text-muted-2">/</span>
                    <span className={entry.gap < 0 ? "font-semibold text-danger" : "text-muted"}>{entry.theirs.toFixed(1)}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
