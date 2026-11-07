/**
 * Audit log writes and reads. Writes accept an open transaction so they can be
 * atomic with the change they describe.
 */
import { desc, eq } from "drizzle-orm";
import { withOrg, schema, type Tx } from "@/lib/db";

const { auditLogs, users } = schema;

export interface AuditInput {
  orgId: string;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

export async function recordAudit(tx: Tx, input: AuditInput): Promise<void> {
  await tx.insert(auditLogs).values({
    orgId: input.orgId,
    actorId: input.actorId ?? null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    before: (input.before ?? null) as never,
    after: (input.after ?? null) as never,
    ip: input.ip ?? null,
  });
}

export async function listAuditLogs(orgId: string, limit = 100) {
  return withOrg(orgId, (tx) =>
    tx
      .select({
        id: auditLogs.id,
        action: auditLogs.action,
        entityType: auditLogs.entityType,
        entityId: auditLogs.entityId,
        ip: auditLogs.ip,
        createdAt: auditLogs.createdAt,
        actorName: users.name,
      })
      .from(auditLogs)
      .leftJoin(users, eq(users.id, auditLogs.actorId))
      .where(eq(auditLogs.orgId, orgId))
      .orderBy(desc(auditLogs.createdAt))
      .limit(Math.min(limit, 500)),
  );
}
