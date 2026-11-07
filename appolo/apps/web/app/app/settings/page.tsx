import { eq } from "drizzle-orm";
import { Badge, Card, CardTitle } from "@appolo/ui";
import { capabilitiesFor } from "@appolo/core";
import { requireSession } from "@/lib/session";
import { getDb, withOrg, schema } from "@/lib/db";

const { memberships, users, locations } = schema;

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const session = await requireSession();
  const db = getDb();

  const [members, locationRows] = await Promise.all([
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
  ]);

  const caps = capabilitiesFor(session.membership.role);

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">Workspace, members, and your effective permissions.</p>
      </div>

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