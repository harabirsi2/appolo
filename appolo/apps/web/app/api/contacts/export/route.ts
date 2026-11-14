import { NextResponse } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError, rateLimited } from "@/lib/api";
import { exportContactsCsv } from "@/lib/services/contacts";
import { recordAudit } from "@/lib/services/audit";
import { consumeAction, EXPORT_WINDOW } from "@/lib/services/action-rate-limit";
import { withOrg } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "contacts:export")) {
      return jsonError("Your role cannot export contacts.", 403, "FORBIDDEN");
    }

    const limit = await consumeAction("export", session.org.id, EXPORT_WINDOW);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const csv = await exportContactsCsv(session.org.id);
    const stamp = new Date().toISOString().slice(0, 10);

    // A full contact export is a PII egress; record who pulled it and when.
    await withOrg(session.org.id, (tx) =>
      recordAudit(tx, {
        orgId: session.org.id,
        actorId: session.user.id,
        action: "contacts.export",
        entityType: "contact",
        after: { bytes: csv.length },
      }),
    );

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="contacts-${stamp}.csv"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
