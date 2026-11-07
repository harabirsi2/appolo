import { can } from "@appolo/core";
import { Badge, Card, CardTitle, EmptyState } from "@appolo/ui";
import { requireSession } from "@/lib/session";
import { listAuditLogs } from "@/lib/services/audit";

export const metadata = { title: "Audit log" };
export const dynamic = "force-dynamic";

function toneFor(action: string): "neutral" | "brand" | "success" | "warn" | "danger" {
  if (action.includes("delete") || action.includes("revoked")) return "danger";
  if (action.includes("publish") || action.includes("sent") || action.includes("enabled")) return "success";
  if (action.includes("flag")) return "warn";
  return "brand";
}

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ limit?: string }>;
}) {
  const session = await requireSession();
  if (!can(session.membership.role, "audit:view")) {
    return (
      <div className="mx-auto max-w-3xl">
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-2 text-sm text-muted">Your role cannot view the audit log.</p>
      </div>
    );
  }

  const { limit } = await searchParams;
  const logs = await listAuditLogs(session.org.id, Math.min(Math.max(Number(limit ?? "100") || 100, 10), 500));

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Audit log</h1>
        <p className="mt-1 text-sm text-muted">
          Every review reply, automation change, campaign send, and assignment, newest first.
        </p>
      </div>

      <Card>
        <CardTitle action={<Badge>{logs.length} entries</Badge>}>Recent activity</CardTitle>
        {logs.length === 0 ? (
          <EmptyState title="Nothing recorded yet" body="Actions like publishing a reply or sending a campaign show up here." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-2">
                  <th className="pb-2 font-medium">When</th>
                  <th className="pb-2 font-medium">Actor</th>
                  <th className="pb-2 font-medium">Action</th>
                  <th className="pb-2 font-medium">Entity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {logs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-3 pr-3 text-muted-2">{new Date(log.createdAt).toLocaleString()}</td>
                    <td className="py-3 pr-3">{log.actorName ?? "System"}</td>
                    <td className="py-3 pr-3">
                      <Badge tone={toneFor(log.action)}>{log.action}</Badge>
                    </td>
                    <td className="py-3 font-mono text-xs text-muted">
                      {log.entityType}
                      {log.entityId ? `:${log.entityId.slice(0, 8)}` : ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}