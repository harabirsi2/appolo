import Link from "next/link";
import { requireSession } from "@/lib/session";
import { ratingHistory } from "@/lib/services/rankings";
import { MediaArt } from "@/components/media-art";
import { ScoreText } from "@/components/podiums";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const session = await requireSession();
  const entries = await ratingHistory(session.org.id, 80);

  return (
    <div className="px-5 pt-4 pb-24">
      <div className="flex items-center justify-between">
        <BackButton fallback="/app/profile" />
        <h1 className="text-[20px] font-bold text-ink">My history</h1>
        <span className="w-8" />
      </div>

      {entries.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 text-[13px] text-muted">
          No activity yet. Rate something to start your history.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
              <MediaArt kind={entry.item.kind} title={entry.item.title} className="h-12 w-12 rounded-lg" />
              <div className="min-w-0 flex-1">
                <Link href={`/app/item/${entry.item.id}`} className="block truncate text-sm font-medium text-ink hover:underline">
                  {entry.item.title}
                </Link>
                <p className="truncate text-[12px] text-muted-2">
                  {entry.kind} · {new Date(entry.createdAt).toLocaleString()}
                </p>
                {entry.detail ? <p className="mt-0.5 truncate text-[11px] text-muted-2">{entry.detail}</p> : null}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}