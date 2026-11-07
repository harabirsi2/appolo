import Link from "next/link";
import { Badge, Button, EmptyState } from "@appolo/ui";
import { MEDIA_KINDS, MEDIA_KIND_LABELS, type MediaKind } from "@appolo/core";
import { cn } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { listCatalog, ratedItemIds } from "@/lib/services/rankings";
import { MediaArt, ScorePill } from "@/components/media-art";

export const metadata = { title: "Rate" };

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
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Rate something</h1>
        <p className="mt-1 text-sm text-muted">
          Choose an item, then play a few quick head-to-head matchups to place it.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Link
            href="/app/rate"
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
              href={`/app/rate?kind=${k}`}
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

        <form action="/app/rate" method="get" className="flex gap-2">
          {activeKind ? <input type="hidden" name="kind" value={activeKind} /> : null}
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="Search titles or creators…"
            className="h-10 w-full max-w-sm rounded-lg border border-border bg-surface px-3 text-sm text-ink placeholder:text-muted-2 focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand"
          />
          <Button type="submit" variant="secondary" size="md">Search</Button>
        </form>
      </div>

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
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {items.map((item) => (
            <li key={item.id}>
              <Link
                href={`/app/rate/${item.id}`}
                className="group flex h-full flex-col gap-3 rounded-xl border border-border bg-surface p-3 transition-colors hover:border-border-strong"
              >
                <MediaArt kind={item.kind} title={item.title} className="aspect-square w-full" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{item.title}</p>
                  <p className="truncate text-xs text-muted-2">
                    {item.subtitle}
                    {item.year ? ` · ${item.year}` : ""}
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <Badge tone="neutral">{MEDIA_KIND_LABELS[item.kind]}</Badge>
                  {ratedSet.has(item.id) ? (
                    <span className="text-[11px] text-success">Rated ✓</span>
                  ) : (
                    <span className="text-[11px] text-muted-2 group-hover:text-ink">Rate →</span>
                  )}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
