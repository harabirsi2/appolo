import Link from "next/link";
import { can, canSendOnChannel } from "@appolo/core";
import { Badge, Button, Card, CardTitle, EmptyState, Select, Textarea, cn } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import {
  getConversation,
  listConversations,
  listMembers,
  listSavedReplies,
} from "@/lib/services/messaging";
import { addNoteAction, updateConversationAction } from "@/lib/actions";
import { AutoRefresh } from "@/components/auto-refresh";
import { MarkRead } from "@/components/mark-read";
import { ReplyComposer } from "@/components/reply-composer";

export const metadata = { title: "Inbox" };

const STATUSES = ["open", "pending", "snoozed", "closed"] as const;
const CHANNELS = ["sms", "email", "webchat", "facebook", "instagram", "gbp"] as const;

function timeAgo(value: Date | string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const diff = Date.now() - date.getTime();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d`;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function consentTone(status: string | undefined): "success" | "neutral" | "danger" {
  if (status === "granted") return "success";
  if (status === "revoked") return "danger";
  return "neutral";
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string; status?: string; channel?: string; error?: string; ok?: string }>;
}) {
  const session = await requireSession();
  const { c, status, channel, error, ok } = await searchParams;
  const orgId = session.org.id;

  const [conversations, savedReplies, members] = await Promise.all([
    listConversations(orgId, { status, channel }),
    listSavedReplies(orgId, session.user.id),
    listMembers(orgId),
  ]);

  const selectedId = c ?? conversations[0]?.id ?? null;
  const detail = selectedId ? await getConversation(orgId, selectedId) : null;

  const channelKind = detail?.conversation.channelKind ?? "webchat";
  const consentDecision = detail
    ? canSendOnChannel(detail.consent, channelKind)
    : { allowed: true };
  const channelConsent = detail?.consent.find((record) => record.channel === channelKind);
  const canSend = can(session.membership.role, "messages:send");

  const querySuffix = (extra: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    if (status) params.set("status", status);
    if (channel) params.set("channel", channel);
    for (const [key, value] of Object.entries(extra)) if (value) params.set(key, value);
    const qs = params.toString();
    return qs ? `?${qs}` : "";
  };

  return (
    <div className="mx-auto max-w-6xl">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Inbox</h1>
          <p className="mt-1 text-sm text-muted">
            Every channel in one queue. Sends are consent-checked and opt-outs are honored instantly.
          </p>
        </div>
        <AutoRefresh seconds={5} />
      </div>

      {error ? (
        <p className="mb-4 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      ) : null}
      {ok ? (
        <p className="mb-4 rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {ok}
        </p>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* Conversation list */}
        <div className="space-y-3">
          <Card className="p-3">
            <form method="get" className="flex gap-2">
              <Select name="status" defaultValue={status ?? ""} className="h-9 text-xs">
                <option value="">All statuses</option>
                {STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </Select>
              <Select name="channel" defaultValue={channel ?? ""} className="h-9 text-xs">
                <option value="">All channels</option>
                {CHANNELS.map((ch) => (
                  <option key={ch} value={ch}>{ch}</option>
                ))}
              </Select>
              <Button type="submit" size="sm" variant="secondary">Filter</Button>
            </form>
          </Card>

          <Card className="p-0">
            {conversations.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted">
                No conversations yet. Send a test SMS webhook or open the web chat widget.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {conversations.map((convo) => {
                  const active = convo.id === selectedId;
                  return (
                    <li key={convo.id}>
                      <Link
                        href={`/app/inbox${querySuffix({ c: convo.id })}`}
                        className={cn(
                          "block px-4 py-3 transition-colors",
                          active ? "bg-brand/10" : "hover:bg-surface-2",
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium">
                            {convo.contactName ?? "Unknown contact"}
                          </span>
                          <span className="shrink-0 text-[11px] text-muted-2">
                            {timeAgo(convo.lastMessageAt)}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2">
                          {convo.channelKind ? <Badge>{convo.channelKind}</Badge> : null}
                          <Badge tone={convo.status === "open" ? "success" : "neutral"}>{convo.status}</Badge>
                          {convo.unreadCount > 0 ? (
                            <span className="ml-auto inline-flex min-w-5 items-center justify-center rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white">
                              {convo.unreadCount}
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted">
                          {convo.lastMessageBody ?? "No messages yet"}
                        </p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
        </div>

        {/* Thread */}
        {!detail ? (
          <EmptyState
            title="Select a conversation"
            body="Pick a thread on the left, or trigger an inbound message with the web chat widget."
          />
        ) : (
          <div className="space-y-3">
            <MarkRead conversationId={detail.conversation.id} />

            <Card>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold">
                      {detail.conversation.contactName ?? "Unknown contact"}
                    </h2>
                    {detail.conversation.channelKind ? (
                      <Badge tone="brand">{detail.conversation.channelKind}</Badge>
                    ) : null}
                    <Badge tone={detail.conversation.status === "open" ? "success" : "neutral"}>
                      {detail.conversation.status}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted">
                    {detail.conversation.contactCompany ?? "No company"} ·{" "}
                    <Link href={`/app/contacts/${detail.conversation.contactId}`} className="text-brand-soft hover:underline">
                      View contact
                    </Link>
                  </p>
                </div>

                {canSend ? (
                  <form action={updateConversationAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="conversationId" value={detail.conversation.id} />
                    <Select
                      name="status"
                      defaultValue={detail.conversation.status}
                      className="h-8 w-28 text-xs"
                      aria-label="Conversation status"
                    >
                      {STATUSES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </Select>
                    <Select
                      name="assignTo"
                      defaultValue={
                        detail.conversation.assigneeId === session.user.id
                          ? "me"
                          : (detail.conversation.assigneeId ?? "unassigned")
                      }
                      className="h-8 w-36 text-xs"
                      aria-label="Assignee"
                    >
                      <option value="unassigned">Unassigned</option>
                      <option value="me">Assign to me</option>
                      {members
                        .filter((m) => m.userId !== session.user.id)
                        .map((m) => (
                          <option key={m.userId} value={m.userId}>{m.name}</option>
                        ))}
                    </Select>
                    <Button type="submit" size="sm" variant="secondary">Save</Button>
                  </form>
                ) : null}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-muted-2">Consent:</span>
                <Badge tone={consentTone(channelConsent?.status)}>
                  {channelConsent?.status ?? "no record"}
                </Badge>
                {!consentDecision.allowed ? (
                  <span className="text-danger">{consentDecision.reason}</span>
                ) : null}
                {detail.conversation.assigneeName ? (
                  <span className="ml-auto text-muted-2">Assigned to {detail.conversation.assigneeName}</span>
                ) : null}
              </div>
            </Card>

            <Card>
              <CardTitle action={<Badge>{detail.messages.length} message{detail.messages.length === 1 ? "" : "s"}</Badge>}>
                Conversation
              </CardTitle>

              {detail.messages.length === 0 ? (
                <p className="py-6 text-center text-sm text-muted">No messages yet.</p>
              ) : (
                <ul className="space-y-3">
                  {detail.messages.map((message) => {
                    const isSystem = message.senderType === "system";
                    const isOutbound = message.direction === "outbound";
                    return (
                      <li
                        key={message.id}
                        className={cn("flex", isSystem ? "justify-center" : isOutbound ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] rounded-xl px-3 py-2 text-sm",
                            isSystem
                              ? "border border-border bg-surface-2 text-xs text-muted"
                              : isOutbound
                                ? "bg-brand/15 text-ink"
                                : "bg-surface-2 text-ink",
                          )}
                        >
                          {!isSystem ? (
                            <div className="mb-1 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-2">
                              <span>{isOutbound ? message.senderType === "ai" ? "AI" : "Team" : "Customer"}</span>
                              <span>·</span>
                              <span>{new Date(message.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                              {isOutbound ? <span>· {message.status}</span> : null}
                            </div>
                          ) : null}
                          <p className="whitespace-pre-wrap">{message.body}</p>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}

              <div className="mt-4 border-t border-border pt-4">
                <ReplyComposer
                  conversationId={detail.conversation.id}
                  savedReplies={savedReplies.map((reply) => ({ id: reply.id, title: reply.title, body: reply.body }))}
                  disabled={!canSend || !consentDecision.allowed}
                  resetKey={detail.messages.length}
                />
              </div>
            </Card>

            <div className="grid gap-3 md:grid-cols-2">
              <Card>
                <CardTitle>Internal notes</CardTitle>
                {detail.notes.length === 0 ? (
                  <p className="text-sm text-muted">No notes yet.</p>
                ) : (
                  <ul className="space-y-2">
                    {detail.notes.map((note) => (
                      <li key={note.id} className="rounded-lg border border-border bg-surface-2 p-2 text-sm">
                        <p className="whitespace-pre-wrap text-muted">{note.body}</p>
                        <p className="mt-1 text-[10px] text-muted-2">
                          {new Date(note.createdAt).toLocaleString()}
                        </p>
                      </li>
                    ))}
                  </ul>
                )}
                {canSend ? (
                  <form action={addNoteAction} className="mt-3 space-y-2">
                    <input type="hidden" name="conversationId" value={detail.conversation.id} />
                    <Textarea name="body" rows={2} placeholder="Add a private note…" required />
                    <Button type="submit" size="sm" variant="secondary">Add note</Button>
                  </form>
                ) : null}
              </Card>

              <Card>
                <CardTitle>Contact details</CardTitle>
                <ul className="space-y-1.5 text-sm">
                  {detail.channels.length === 0 ? (
                    <li className="text-muted">No channels on file.</li>
                  ) : (
                    detail.channels.map((channelRow) => (
                      <li key={channelRow.id} className="flex items-center justify-between gap-2">
                        <span className="text-muted-2">{channelRow.kind}</span>
                        <span className="truncate">{channelRow.value}</span>
                      </li>
                    ))
                  )}
                </ul>
                <p className="mt-3 text-xs text-muted-2">
                  Updates are live within 5 seconds. STOP closes the thread and revokes SMS consent.
                </p>
              </Card>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}