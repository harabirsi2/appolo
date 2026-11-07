import { eq } from "drizzle-orm";
import { Badge, Button, Card, CardTitle, Field, Input, Select, Textarea } from "@appolo/ui";
import { capabilitiesFor, can } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { getDb, withOrg, schema } from "@/lib/db";
import { listOrgChannels, listSavedReplies } from "@/lib/services/messaging";
import { createSavedReplyAction } from "@/lib/actions";

const { memberships, users, locations } = schema;

export const metadata = { title: "Settings" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; ok?: string }>;
}) {
  const session = await requireSession();
  const { error, ok } = await searchParams;
  const db = getDb();

  const [members, locationRows, savedReplies, orgChannels] = await Promise.all([
    db
      .select({
        id: memberships.id,
        role: memberships.role,
        status: memberships.status,
        name: users.name,
        email: users.email,
      })
      .from(memberships)
      .innerJoin(users, eq(memberships.userId, users.id))
      .where(eq(memberships.orgId, session.org.id)),
    withOrg(session.org.id, (tx) => tx.select({ id: locations.id, name: locations.name }).from(locations)),
    listSavedReplies(session.org.id, session.user.id),
    listOrgChannels(session.org.id),
  ]);

  const caps = capabilitiesFor(session.membership.role);
  const canWrite = can(session.membership.role, "messages:send");
  const webchatChannel = orgChannels.find((channel) => channel.kind === "webchat");
  const baseUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const embedUrl = webchatChannel?.providerRef ? `${baseUrl}/embed/${webchatChannel.providerRef}` : null;
  const embedSnippet = embedUrl
    ? `<iframe src="${embedUrl}" title="Chat" style="width:380px;height:560px;border:0;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18)"></iframe>`
    : null;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">Workspace, members, and your effective permissions.</p>
      </div>

      {error ? (
        <p className="rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
      ) : null}
      {ok ? (
        <p className="rounded-lg border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">{ok}</p>
      ) : null}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardTitle>Workspace</CardTitle>
          <dl className="space-y-3 text-sm">
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Name</dt>
              <dd className="font-medium">{session.org.name}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Slug</dt>
              <dd className="font-mono text-xs">{session.org.slug}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Plan</dt>
              <dd><Badge tone="brand">{session.org.planTier}</Badge></dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-muted">Locations</dt>
              <dd className="font-medium">{locationRows.length}</dd>
            </div>
          </dl>
        </Card>

        <Card>
          <CardTitle>Your access</CardTitle>
          <p className="text-sm text-muted">
            Signed in as <span className="text-ink">{session.user.email}</span> with the{" "}
            <span className="text-ink">{session.membership.role}</span> role.
          </p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {caps.map((cap) => (
              <Badge key={cap} tone="neutral">{cap}</Badge>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle action={<Badge>{members.length} member{members.length === 1 ? "" : "s"}</Badge>}>
          Members
        </CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-2">
                <th className="pb-2 font-medium">Name</th>
                <th className="pb-2 font-medium">Email</th>
                <th className="pb-2 font-medium">Role</th>
                <th className="pb-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {members.map((m) => (
                <tr key={m.id}>
                  <td className="py-3 pr-3">{m.name}</td>
                  <td className="py-3 pr-3 text-muted">{m.email}</td>
                  <td className="py-3 pr-3"><Badge tone="brand">{m.role}</Badge></td>
                  <td className="py-3"><Badge tone={m.status === "active" ? "success" : "neutral"}>{m.status}</Badge></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-4 text-xs text-muted-2">
          Invitations and role editing arrive with the notifications workstream. Phase 0 enforces the
          matrix server-side already.
        </p>
      </Card>

      <Card>
        <CardTitle
          action={<Badge>{savedReplies.length} saved</Badge>}
        >
          Saved replies
        </CardTitle>
        {savedReplies.length === 0 ? (
          <p className="text-sm text-muted">No saved replies yet.</p>
        ) : (
          <ul className="divide-y divide-border">
            {savedReplies.map((reply) => (
              <li key={reply.id} className="py-3 first:pt-0 last:pb-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{reply.title}</p>
                  <Badge tone={reply.scope === "user" ? "neutral" : "brand"}>{reply.scope}</Badge>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-muted">{reply.body}</p>
              </li>
            ))}
          </ul>
        )}

        {canWrite ? (
          <form action={createSavedReplyAction} className="mt-4 space-y-3 border-t border-border pt-4">
            <div className="grid gap-3 sm:grid-cols-[200px_1fr]">
              <Field label="Title">
                <Input name="title" placeholder="Pricing question" required />
              </Field>
              <Field label="Scope">
                <Select name="scope" defaultValue="org">
                  <option value="org">Everyone</option>
                  <option value="user">Just me</option>
                </Select>
              </Field>
            </div>
            <Field label="Message" hint="Use {{first_name}} to personalize.">
              <Textarea name="body" rows={3} placeholder="Thanks {{first_name}}! Our pricing starts at..." required />
            </Field>
            <Button type="submit" variant="secondary">Add saved reply</Button>
          </form>
        ) : null}
      </Card>

      <Card>
        <CardTitle>Web chat widget</CardTitle>
        {embedSnippet ? (
          <>
            <p className="text-sm text-muted">
              Paste this on any page to add a live chat bubble. Visitors are matched by a browser id, so a
              returning visitor keeps their thread.
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-border bg-surface-2 p-3 text-xs text-muted">
              {embedSnippet}
            </pre>
            <a
              href={embedUrl ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex h-9 items-center rounded-lg border border-border bg-surface-2 px-3 text-sm text-ink hover:border-border-strong"
            >
              Open the widget
            </a>
          </>
        ) : (
          <p className="text-sm text-muted">
            No active web chat channel. Seed or connect one to get an embed snippet.
          </p>
        )}
      </Card>

      <Card>
        <CardTitle>Data &amp; compliance</CardTitle>
        <ul className="space-y-2 text-sm text-muted">
          <li>Every tenant table is protected by row-level security keyed to the active org.</li>
          <li>Consent records are append-only and checked before any outbound message.</li>
          <li>Exports and deletion run through audited jobs (Phase 4).</li>
          <li>No payment data is collected or stored — payments are out of scope.</li>
        </ul>
      </Card>
    </div>
  );
}