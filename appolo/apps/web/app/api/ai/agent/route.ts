import { NextResponse, type NextRequest } from "next/server";
import { aiAgentConfigSchema, can, firstIssue } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { ensureAiAgent, updateAiAgent } from "@/lib/services/ai-employee";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "ai:manage")) {
      return jsonError("Your role cannot view the AI employee.", 403, "FORBIDDEN");
    }
    return NextResponse.json({ agent: await ensureAiAgent(session.org.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "ai:manage")) {
      return jsonError("Your role cannot change the AI employee.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = aiAgentConfigSchema.partial().safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const current = await ensureAiAgent(session.org.id);
    const merged = { ...current.config, ...parsed.data };
    await updateAiAgent(session.org.id, merged, session.user.id);
    return NextResponse.json({ agent: { ...current, config: merged } });
  } catch (error) {
    return apiError(error);
  }
}
