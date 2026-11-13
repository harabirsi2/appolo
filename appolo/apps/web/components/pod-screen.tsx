import Link from "next/link";
import { MEDIA_KIND_LABELS } from "@appolo/core";
import type { PodDetail } from "@/lib/services/social";
import { MediaArt } from "./media-art";
import { Avatar, ScoreText } from "./podiums";
import { ShareButton } from "./share-button";

export function PodScreen({ pod, viewerUsername }: { pod: PodDetail; viewerUsername?: string | null }) {
  return (
    <div className="px-5 pt-6">
      <p className="text-[10px] uppercase tracking-[0.18em] text-muted-2">Pod</p>
      <h1 className="mt-1 text-[30px] font-extrabold leading-tight tracking-tight text-ink">{pod.title}</h1>
      {pod.description ? <p className="mt-2 text-[13px] leading-relaxed text-muted">{pod.description}</p> : null}

      <div className="mt-4 flex items-center justify-between">
        <Link href={`/${pod.ownerUsername}`} className="flex items-center gap-2">
          <Avatar name={pod.ownerDisplayName} hue={150} size={28} />
          <span className="text-[12px] text-muted">{`@${pod.ownerUsername}`}</span>
        </Link>
        <ShareButton title={`${pod.title} — a pod on Appolo`} path={`/${pod.ownerUsername}/${pod.slug}`} />
      </div>

      <ol className="mt-6 space-y-2 pb-12">
        {pod.entries.map((entry, index) => (
          <li key={entry.id}>
            <Link
              href={`/app/item/${entry.id}`}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-2.5 transition-colors hover:border-white/15"
            >
              <span className="grid w-6 shrink-0 place-items-center text-[18px] font-extrabold text-white/25">
                {index + 1}
              </span>
              <MediaArt kind={entry.kind} title={entry.title} sizes="56px" className="h-14 w-14 rounded-lg" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] font-semibold text-ink">{entry.title}</p>
                <p className="truncate text-[11px] text-muted-2">
                  {entry.subtitle || MEDIA_KIND_LABELS[entry.kind]}
                  {entry.year ? ` · ${entry.year}` : ""}
                </p>
                {entry.note ? <p className="mt-0.5 truncate text-[11px] text-muted">{entry.note}</p> : null}
                {entry.addedByUsername ? (
                  <p className="mt-0.5 truncate text-[10px] text-brand/80">{`added by @${entry.addedByUsername}`}</p>
                ) : null}
              </div>
              <ScoreText score={entry.score} className="text-[15px]" />
            </Link>
          </li>
        ))}
        {pod.entries.length === 0 ? (
          <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">
            This pod is empty.
          </p>
        ) : null}
      </ol>

      {viewerUsername === pod.ownerUsername ? (
        <div className="pb-10 text-center">
          <Link href="/app/pods/new" className="text-[12px] text-brand hover:underline">
            Make another pod →
          </Link>
        </div>
      ) : null}
    </div>
  );
}