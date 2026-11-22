import Link from "next/link";
import { redirect } from "next/navigation";
import { Button } from "@appolo/ui";
import { MEDIA_KIND_LABELS } from "@appolo/core";
import { MediaArt } from "@/components/media-art";
import { PushOptIn } from "@/components/push-opt-in";
import { requireSession } from "@/lib/session";
import { nextUnratedItem, tasteStats } from "@/lib/services/rankings";

export const dynamic = "force-dynamic";
export const metadata = { title: "One down" };

/** Four ratings is where a first ranking starts to feel personal. */
const SOLID_AT = 4;

/**
 * Shown right after a rating is saved while the account is still new. It exists
 * to close the gap between "I rated one thing" and "my ranking means something"
 * — the point where most people stop.
 */
export default async function FirstRatingPage({
  searchParams,
}: {
  searchParams: Promise<{ item?: string }>;
}) {
  const session = await requireSession();
  const { item } = await searchParams;
  const stats = await tasteStats(session.org.id);

  // Nothing rated yet, or already past the point where this screen helps: send
  // people where they were going instead of showing a stale celebration.
  if (stats.rated === 0) redirect("/app/rate");
  if (stats.rated >= SOLID_AT) redirect(item ? `/app/item/${item}` : "/app");

  const remaining = SOLID_AT - stats.rated;
  const next = await nextUnratedItem(session.org.id);
  const progress = Math.round((stats.rated / SOLID_AT) * 100);

  return (
    <div className="mx-auto max-w-2xl px-5 pb-16 pt-8">
      <div className="rounded-3xl border border-brand/25 bg-brand/[0.07] p-5 text-center">
        <p className="text-[11px] uppercase tracking-[0.18em] text-brand/80">Ranked</p>
        <p className="mt-2 text-[28px] font-extrabold leading-tight tracking-tight text-ink">
          {stats.rated === 1 ? "You ranked 1 title" : `You ranked ${stats.rated} titles`}
        </p>
        <p className="mx-auto mt-2 max-w-sm text-[13px] leading-relaxed text-muted">
          {remaining === 1
            ? "One more comparison and your ranking is solid."
            : `${remaining} more comparisons and your ranking is solid. Every vote moves both titles, so it gets more accurate as you go.`}
        </p>

        <div className="mt-5">
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-white/[0.08]"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={SOLID_AT}
            aria-valuenow={stats.rated}
            aria-label={`${stats.rated} of ${SOLID_AT} ratings`}
          >
            <div className="h-full rounded-full bg-brand" style={{ width: `${progress}%` }} />
          </div>
          <p className="num mt-2 text-[11px] text-muted-2">
            {stats.rated} of {SOLID_AT}
          </p>
        </div>
      </div>

      {/* The permission ask lives here rather than on arrival: the person has
          just felt the product work, which is the only moment a browser prompt
          is worth spending (a denial is permanent). */}
      <div className="mt-6">
        <PushOptIn />
      </div>

      {next ? (
        <section className="mt-6 rounded-3xl border border-white/[0.08] bg-[#141416] p-5">
          <p className="text-[11px] uppercase tracking-[0.16em] text-muted-2">Next comparison</p>
          <div className="mt-3 flex items-center gap-3">
            <MediaArt
              kind={next.kind}
              title={next.title}
              imageUrl={next.imageUrl}
              sizes="56px"
              className="h-14 w-14 shrink-0 rounded-xl"
            />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[15px] font-semibold text-ink">{next.title}</p>
              <p className="text-[12px] text-muted-2">
                {[MEDIA_KIND_LABELS[next.kind], next.year ? String(next.year) : null]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Link href={`/app/rate/${next.id}`}>
              <Button size="sm">Compare it</Button>
            </Link>
          </div>
        </section>
      ) : (
        <section className="mt-6 rounded-3xl border border-white/[0.08] bg-[#141416] p-5">
          <p className="text-[15px] font-semibold text-ink">You have rated everything in the catalog</p>
          <p className="mt-1 text-[13px] text-muted">
            New titles arrive as providers are enabled. Try editing a review or sharing a pod in
            the meantime.
          </p>
        </section>
      )}

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <Link href="/app/rankings">
          <Button size="md" variant="secondary">
            See my ranking
          </Button>
        </Link>
        <Link href="/app" className="text-[12px] text-muted-2 hover:text-ink">
          Back to home
        </Link>
        {item ? (
          <Link href={`/app/item/${item}`} className="text-[12px] text-muted-2 hover:text-ink">
            Open the title you just rated
          </Link>
        ) : null}
      </div>
    </div>
  );
}
