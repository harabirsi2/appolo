import Link from "next/link";
import { requireSession } from "@/lib/session";
import { notificationsFor, markNotificationsRead } from "@/lib/services/social";
import { Avatar } from "@/components/podiums";
import { BackButton } from "@/components/back-button";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const session = await requireSession();
  const items = await notificationsFor(session.org.id);
  await markNotificationsRead(session.org.id);

  return (
    <div className="px-5 pt-4 pb-24">
      <div className="flex items-center justify-between">
        <BackButton fallback="/app" />
        <h1 className="text-[20px] font-bold text-ink">Notifications</h1>
        <span className="w-8" />
      </div>

      {items.length === 0 ? (
        <p className="mt-8 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-5 text-[13px] text-muted">
          No notifications yet.
        </p>
      ) : (
        <ul className="mt-6 space-y-2">
          {items.map((n) => (
            <li key={n.id} className="flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
              {n.actorAvatarHue !== null ? (
                <Avatar name={n.actorDisplayName ?? "?"} hue={n.actorAvatarHue} size={36} />
              ) : (
                <div className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-[12px]">🔔</div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[13px] text-ink">
                  <span className="font-semibold">{n.actorDisplayName ?? "Someone"}</span>{" "}
                  {n.kind === "follow"
                    ? "started following you"
                    : n.kind === "reaction"
                      ? `reacted ${n.body}`
                      : n.kind === "comment"
                        ? `commented: ${n.body}`
                        : n.kind}
                </p>
                {n.itemTitle ? (
                  <Link href={`/app/item/${n.itemId}`} className="mt-0.5 block truncate text-[12px] text-muted-2 hover:text-ink">
                    {n.itemTitle}
                  </Link>
                ) : null}
                <p className="mt-0.5 text-[10px] text-muted-2">{new Date(n.createdAt).toLocaleString()}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}