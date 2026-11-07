import { NextResponse, type NextRequest } from "next/server";
import { automationSchema, can, firstIssue } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { deleteAutomation, setAutomationEnabled, updateAutomation } from "@/lib/services/automations";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "automations:manage")) {
      return jsonError("Your role cannot change automations.", 403, "FORBIDDEN");
    }

    const { id } = await params;
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const patch = (body ?? {}) as Record<string, unknown>;

    // A bare { enabled } toggles without re-validating the whole automation.
    if (Object.keys(patch).length === 1 && typeof patch.enabled === "boolean") {
      await setAutomationEnabled(session.org.id, id, patch.enabled, session.user.id);
      return NextResponse.json({ ok: true });
    }

    const parsed = automationSchema.safeParse(patch);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");
    await updateAutomation(session.org.id, id, parsed.data, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "automations:manage")) {
      return jsonError("Your role cannot delete automations.", 403, "FORBIDDEN");
    }
    const { id } = await params;
    await deleteAutomation(session.org.id, id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
