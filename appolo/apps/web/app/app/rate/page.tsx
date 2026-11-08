import Link from "next/link";
import { Button, EmptyState } from "@appolo/ui";
import { MEDIA_KINDS, MEDIA_KIND_LABELS, type MediaKind } from "@appolo/core";
import { cn } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { listCatalog, ratedItemIds } from "@/lib/services/rankings";
import { MediaArt } from "@/components/media-art";
import { BackButton } from "@/components/back-button";
import { Icon } from "@/components/podiums";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rate something" };

export default async function RatePage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string; q?: string }>;
}) {
  const session = await requireSession();
  const { kind, q } = await searchParams;
  const activeKind = MEDIA_KINDS.includes(kind as MediaKind) ? (kind as MediaKind) : undefined;

  const [items, rated] = await Promise.all([
    listCatalog({ kind: activeKind, q, limit: 120 }),
    ratedItemIds(session.org.id),
  ]);
  const ratedSet = new Set(rated);

  return (
    <div className="px-5 pt-4">
      <div className="flex items-center justify-between">
        <BackButton />
        <span className="text-xs text-muted-2">Pick something to rank</span>
      </div>

      <h1 className="mt-4 text-[30px] font-extrabold tracking-tight text-ink">Rate something</h1>
      <p className="mt-1 text-[13px] text-muted">
        Choose an item, then play a few quick “which is better?” matchups.
      </p>

      <form action="/app/rate" className="relative mt-4">
        <Icon name="search" className="pointer-events-none absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-muted-2" />
        {activeKind ? <input type="hidden" name="kind" value={activeKind} /> : null}
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="Search titles or creators..."
          className="h-11 w-full rounded-xl border border-white/[0.06] bg-[#1a1a1d] pl-10 pr-3 text-[14px] text-ink placeholder:text-muted-2 focus:border-white/20 focus:outline-none"
        />
      </form>

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href="/app/rate"
          className={cn(
            "rounded-full border px-3 py-1.5 text-xs transition-colors",
            !activeKind
              ? "border-brand/40 bg-brand/15 text-brand"
              : "border-white/10 bg-white/5 text-muted hover:text-ink",
          )}
        >
          All
        </Link>
        {MEDIA_KINDS.map((k) => (
          <Link
            key={k}
            href={`/app/rate?kind=${k}`}
            className={cn(
              "rounded-full border px-3 py-1.5 text-xs transition-colors",
              activeKind === k
                ? "border-brand/40 bg-brand/15 text-brand"
                : "border-white/10 bg-white/5 text-muted hover:text-ink",
            )}
          >
            {MEDIA_KIND_LABELS[k]}
          </Link>
        ))}
      </div>

      <div className="mt-5 pb-8">
        {items.length === 0 ? (
          <EmptyState
            title="No matches"
            body="Try a different search term or pick another category."
            action={
              <Link href="/app/rate">
                <Button size="sm" variant="secondary">Clear filters</Button>
              </Link>
            }
          />
        ) : (
          <ul className="grid grid-cols-3 gap-2.5">
            {items.map((item) => (
              <li key={item.id}>
                <Link href={`/app/rate/${item.id}`} className="group block">
                  <div className="relative">
                    <MediaArt kind={item.kind} title={item.title} className="aspect-square w-full rounded-lg" />
                    {ratedSet.has(item.id) ? (
                      <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-black/70 text-[10px] text-brand backdrop-blur">
                        ✓
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1.5 truncate text-[12px] font-medium text-ink">{item.title}</p>
                  <p className="truncate text-[10px] text-muted-2">{item.subtitle}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}