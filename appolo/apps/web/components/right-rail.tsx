import Link from "next/link";
import { nextMatchup, rankedRatings } from "@/lib/services/rankings";
import type { ProfileSummary } from "@/lib/services/social-graph";
import { Icon } from "@/components/podiums";
import { MediaArt } from "@/components/media-art";
import type { MediaKind } from "@appolo/core/ranking";
import { MEDIA_KIND_LABELS } from "@appolo/core/ranking";

/**
 * Desktop-only utility rail shown at the xl breakpoint and above.
 *
 * Context-sensitive widgets live here; for now it carries a quick-action card
 * and a compact taste overview. The rail is hidden below xl so the mobile and
 * tablet layouts stay untouched.
 */
export async function RightRail({ profile }: { profile: ProfileSummary | null }) {
  const ratings = profile ? await rankedRatings(profile.orgId).catch(() => []) : [];
  const counts = new Map<MediaKind, number>();
  for (const rating of ratings) counts.set(rating.kind, (counts.get(rating.kind) ?? 0) + 1);
  const kindEntries = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const maxKind = Math.max(1, ...kindEntries.map(([, count]) => count));

  // Mini duel: pick the user's top-ranked item and fetch an opponent.
  let duel: { item: { id: string; title: string; year: number | null; imageUrl: string | null; kind: MediaKind }; opponent: { id: string; title: string; year: number | null; imageUrl: string | null; kind: MediaKind } } | null = null;
  if (profile && ratings.length > 0) {
    try {
      const matchup = await nextMatchup(profile.orgId, ratings[0]!.id);
      duel = { item: matchup.item, opponent: matchup.opponent };
    } catch {
      duel = null;
    }
  }

  return (
    <aside className="app-rail sticky top-0 h-screen w-[300px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-white/[0.06] px-5 py-8">
      <Link
        href="/app/rate"
        className="flex min-h-11 items-center justify-center gap-2 rounded-full bg-gradient-to-b from-brand-soft to-brand text-[13px] font-semibold text-black shadow-[0_10px_30px_-12px_rgba(16,185,129,0.6)] transition-transform active:scale-[0.98]"
      >
        <Icon name="plus" className="h-4 w-4" />
        Rate something
      </Link>

      {profile && ratings.length >= 0 ? (
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-2">Taste DNA</p>
            <Link href="/app/taste" className="text-[11px] text-brand hover:underline">
              Full →
            </Link>
          </div>
          <p className="mt-1 text-[13px] font-semibold text-ink">{ratings.length} ranked</p>
          <div className="mt-3 space-y-2">
            {kindEntries.slice(0, 5).map(([kind, count]) => (
              <div key={kind} className="space-y-1">
                <div className="flex items-center justify-between text-[11px] text-muted-2">
                  <span className="capitalize">{MEDIA_KIND_LABELS[kind]}</span>
                  <span className="tabular-nums">{count}</span>
                </div>
                <span className="block h-1.5 overflow-hidden rounded-full bg-white/10">
                  <span
                    className="block h-full rounded-full bg-brand"
                    style={{ width: `${Math.max(6, (count / maxKind) * 100)}%` }}
                  />
                </span>
              </div>
            ))}
            {kindEntries.length === 0 ? (
              <p className="text-[12px] text-muted-2">Rate a few titles to see your taste.</p>
            ) : null}
          </div>
        </section>
      ) : null}

      {duel ? (
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-2">Mini duel</p>
            <Link href={`/app/rate/${duel.item.id}`} className="text-[11px] text-brand hover:underline">
              Play →
            </Link>
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {[duel.item, duel.opponent].map((side) => (
              <Link
                key={side.id}
                href={`/app/rate/${duel!.item.id}`}
                className="group overflow-hidden rounded-xl border border-white/[0.06] bg-white/[0.03] transition-colors hover:border-white/15"
              >
                <MediaArt kind={side.kind} title={side.title} imageUrl={side.imageUrl} sizes="140px" className="aspect-square w-full" />
                <p className="truncate px-2 py-1.5 text-[11px] font-medium text-ink">{side.title}</p>
              </Link>
            ))}
          </div>
          <p className="mt-2 text-center text-[10px] text-muted-2">Which is better?</p>
        </section>
      ) : profile && ratings.length === 0 ? (
        <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-2">Mini duel</p>
          <p className="mt-2 text-[12px] text-muted-2">Rate a few titles to unlock duels.</p>
          <Link href="/app/search" className="mt-2 inline-block text-[11px] text-brand hover:underline">
            Browse catalog →
          </Link>
        </section>
      ) : null}

      <section className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-2">Quick links</p>
        <div className="mt-3 space-y-1">
          {[
            { href: "/app/duel", label: "Start a duel" },
            { href: "/app/search", label: "Discover media" },
            { href: "/app/library", label: "Your library" },
            { href: "/app/collections", label: "Collections" },
            { href: "/app/activity", label: "Following activity" },
            { href: "/app/import", label: "Import history" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="flex min-h-9 items-center rounded-lg px-2 text-[12px] text-muted transition-colors hover:bg-white/[0.04] hover:text-ink"
            >
              {link.label}
            </Link>
          ))}
        </div>
      </section>

      <p className="mt-auto px-2 pt-4 text-[9px] uppercase tracking-[0.18em] text-muted-2">
        Appolo · Obsidian Velvet
      </p>
    </aside>
  );
}