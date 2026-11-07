import { NextResponse, type NextRequest } from "next/server";
import { automationSchema, can, firstIssue } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { createAutomation, listAutomations } from "@/lib/services/automations";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "automations:manage")) {
      return jsonError("Your role cannot view automations.", 403, "FORBIDDEN");
    }
    return NextResponse.json({ automations: await listAutomations(session.org.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "automations:manage")) {
      return jsonError("Your role cannot create automations.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = automationSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const created = await createAutomation(session.org.id, parsed.data, session.user.id);
    return NextResponse.json({ automation: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
