import Link from "next/link";
import { notFound } from "next/navigation";
import { CONSENT_CHANNELS, can } from "@appolo/core";
import { Badge, Button, Card, CardTitle, EmptyState, Field, Input, Select, Textarea } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { getContact } from "@/lib/services/contacts";
import { consentSummary } from "@/lib/services/consent";
import { contactTimeline } from "@/lib/services/reports";
import { consentAction, updateContactAction } from "@/lib/actions";

export const metadata = { title: "Contact" };

function consentTone(status: string | undefined): "success" | "danger" | "neutral" {
  if (status === "granted") return "success";
  if (status === "revoked") return "danger";
  return "neutral";
}

export default async function ContactDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requireSession();
  const { id } = await params;
  const { error, ok } = await searchParams;

  const detail = await getContact(session.org.id, id);
  if (!detail) notFound();

  const consent = await consentSummary(session.org.id, id);
  const timeline = await contactTimeline(session.org.id, id);
  const canWrite = can(session.membership.role, "contacts:write");
  const displayName =
    detail.contact.name ??
    detail.channels.find((c) => c.kind === "phone")?.value ??
    detail.channels.find((c) => c.kind === "email")?.value ??
    "Unnamed contact";

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <Link href="/app/contacts" className="text-xs text-muted hover:text-ink">
          ← Back to contacts
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{displayName}</h1>
          {detail.tags.map((tag) => (
            <Badge key={tag} tone="brand">{tag}</Badge>
          ))}
        </div>
        <p className="mt-1 text-sm text-muted">
          {detail.contact.company ?? "No company"} · Added{" "}
          {new Date(detail.contact.createdAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </p>
      </div>

      {error ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      {ok ? (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{ok}</p>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardTitle>Channels</CardTitle>
          {detail.channels.length === 0 ? (
            <p className="text-sm text-muted">No channels on file.</p>
          ) : (
            <ul className="divide-y divide-border">
              {detail.channels.map((channel) => (
                <li key={channel.id} className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="truncate text-sm">{channel.value}</p>
                    <p className="text-xs text-muted-2">{channel.kind}{channel.isPrimary ? " · primary" : ""}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle action={<Badge>{consent.granted.length} granted</Badge>}>Consent</CardTitle>
          <dl className="mb-4 space-y-2 text-sm">
            {CONSENT_CHANNELS.map((channel) => (
              <div key={channel} className="flex items-center justify-between gap-3">
                <dt className="text-muted">{channel}</dt>
                <dd>
                  <Badge tone={consentTone(consent.latest[channel])}>
                    {consent.latest[channel] ?? "no record"}
                  </Badge>
                </dd>
              </div>
            ))}
          </dl>

          {canWrite ? (
            <form action={consentAction} className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="contactId" value={detail.contact.id} />
              <div className="w-28">
                <Field label="Channel">
                  <Select name="channel" defaultValue="sms" className="h-9 text-xs">
                    {CONSENT_CHANNELS.map((channel) => (
                      <option key={channel} value={channel}>{channel}</option>
                    ))}
                  </Select>
                </Field>
              </div>
              <div className="w-28">
                <Field label="Status">
                  <Select name="status" defaultValue="granted" className="h-9 text-xs">
                    <option value="granted">granted</option>
                    <option value="revoked">revoked</option>
                  </Select>
                </Field>
              </div>
              <Button type="submit" size="sm" variant="secondary">Record</Button>
            </form>
          ) : null}

          {consent.records.length > 0 ? (
            <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs text-muted-2">
              {consent.records.slice(0, 6).map((record) => (
                <li key={record.id} className="flex items-center justify-between gap-2">
                  <span>
                    {record.channel} {record.status} · {record.source}
                  </span>
                  <span>{new Date(record.capturedAt).toLocaleDateString()}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>

      {canWrite ? (
        <Card>
          <CardTitle>Edit details</CardTitle>
          <form action={updateContactAction} className="grid gap-4 md:grid-cols-2">
            <input type="hidden" name="contactId" value={detail.contact.id} />
            <Field label="Name">
              <Input name="name" defaultValue={detail.contact.name ?? ""} />
            </Field>
            <Field label="Company">
              <Input name="company" defaultValue={detail.contact.company ?? ""} />
            </Field>
            <Field label="Tags" hint="Separate with commas.">
              <Input name="tags" defaultValue={detail.tags.join(", ")} />
            </Field>
            <div className="md:col-span-2">
              <Field label="Notes">
                <Textarea name="notes" rows={3} defaultValue={detail.contact.notes ?? ""} />
              </Field>
            </div>
            <div className="md:col-span-2">
              <Button type="submit">Save changes</Button>
            </div>
          </form>
        </Card>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardTitle action={<Badge>{detail.conversations.length}</Badge>}>Conversations</CardTitle>
          {detail.conversations.length === 0 ? (
            <EmptyState
              title="No conversations"
              body="Threads appear here once this contact sends or receives a message."
            />
          ) : (
            <ul className="divide-y divide-border">
              {detail.conversations.map((conversation) => (
                <li key={conversation.id} className="py-3 first:pt-0 last:pb-0">
                  <Link href={`/app/inbox?c=${conversation.id}`} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm">
                        {conversation.channelKind ?? "unknown"}{" "}
                        <Badge tone={conversation.status === "open" ? "success" : "neutral"}>
                          {conversation.status}
                        </Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-2">
                        {conversation.lastMessageAt
                          ? new Date(conversation.lastMessageAt).toLocaleString()
                          : "No messages"}
                        {conversation.assigneeName ? ` · ${conversation.assigneeName}` : ""}
                      </p>
                    </div>
                    {conversation.unreadCount > 0 ? <Badge tone="brand">{conversation.unreadCount}</Badge> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardTitle action={timeline.length > 0 ? <Badge>{timeline.length}</Badge> : undefined}>Timeline</CardTitle>
          {timeline.length === 0 ? (
            <p className="text-sm text-muted">No activity yet.</p>
          ) : (
            <ul className="space-y-3">
              {timeline.map((entry) => (
                <li key={entry.id} className="flex items-start gap-3 text-sm">
                  <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <span className="capitalize text-ink">{entry.title}</span>
                      <span className="shrink-0 text-xs text-muted-2">
                        {new Date(entry.at).toLocaleString()}
                      </span>
                    </div>
                    {entry.detail ? <p className="mt-0.5 line-clamp-2 text-xs text-muted">{entry.detail}</p> : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
