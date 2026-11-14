import Link from "next/link";
import { MEDIA_KIND_LABELS } from "@appolo/core";
import type { PodDetail } from "@/lib/services/social";
import { MediaArt } from "./media-art";
import { Avatar, ScoreText } from "./podiums";
import { ShareButton } from "./share-button";
import { PodJoinButton } from "./pod-join-button";

export function PodScreen({ pod, viewerUsername }: { pod: PodDetail; viewerUsername?: string | null }) {
  const isOwner = Boolean(viewerUsername) && viewerUsername === pod.ownerUsername;
  const member = pod.viewerRole !== null;

  return (
    <div className="px-5 pt-6">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-[0.18em] text-muted-2">
            {pod.isCollaborative ? "Collaborative pod" : "Pod"}
          </p>
          <h1 className="mt-1 text-[30px] font-extrabold leading-tight tracking-tight text-ink">{pod.title}</h1>
        </div>
        {pod.isCollaborative && viewerUsername ? (
          <PodJoinButton podId={pod.id} joined={member} role={pod.viewerRole} />
        ) : null}
      </div>
      {pod.description ? <p className="mt-2 text-[13px] leading-relaxed text-muted">{pod.description}</p> : null}

      <div className="mt-4 flex items-center justify-between">
        <Link href={`/${pod.ownerUsername}`} className="flex items-center gap-2">
          <Avatar name={pod.ownerDisplayName} hue={150} size={28} />
          <span className="text-[12px] text-muted">{`@${pod.ownerUsername}`}</span>
        </Link>
        <ShareButton title={`${pod.title} — a pod on Appolo`} path={`/${pod.ownerUsername}/${pod.slug}`} />
      </div>

      {pod.isCollaborative && pod.members.length > 0 ? (
        <section className="mt-4 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-2">Members</p>
            <span className="text-[11px] text-muted-2">
              {pod.memberCount} {pod.memberCount === 1 ? "person" : "people"}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {pod.members.map((entry) => (
              <Link
                key={entry.orgId}
                href={`/${entry.username}`}
                className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] py-0.5 pl-0.5 pr-2"
                title={`${entry.displayName} · ${entry.role}`}
              >
                <Avatar name={entry.displayName} hue={entry.avatarHue} size={20} />
                <span className="text-[11px] text-muted">{`@${entry.username}`}</span>
                {entry.role !== "viewer" ? (
                  <span className="text-[9px] font-semibold uppercase tracking-wide text-brand">{entry.role}</span>
                ) : null}
              </Link>
            ))}
          </div>
          {pod.entries.some((entry) => entry.consensus) ? (
            <p className="mt-2 text-[10px] text-muted-2">
              Group scores average every member who has rated a title.
            </p>
          ) : null}
        </section>
      ) : null}

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
              <MediaArt kind={entry.kind} title={entry.title} imageUrl={entry.imageUrl} sizes="56px" className="h-14 w-14 rounded-lg" />
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
              <div className="flex shrink-0 flex-col items-end gap-0.5">
                {entry.consensus ? (
                  <span className="rounded-full border border-brand/30 bg-brand/10 px-2 py-0.5 text-[10px] font-semibold text-brand">
                    Group {entry.consensus.average.toFixed(1)}
                  </span>
                ) : null}
                <ScoreText score={entry.score} className="text-[15px]" />
              </div>
            </Link>
          </li>
        ))}
        {pod.entries.length === 0 ? (
          <p className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 text-[13px] text-muted">
            This pod is empty.
          </p>
        ) : null}
      </ol>

      {isOwner ? (
        <div className="flex flex-col items-center gap-2 pb-10">
          <Link href={`/app/pods/${pod.id}`} className="text-[12px] text-brand hover:underline">
            Manage pod →
          </Link>
          <Link href="/app/pods/new" className="text-[12px] text-muted-2 hover:text-ink">
            Make another pod
          </Link>
        </div>
      ) : null}
    </div>
  );
}