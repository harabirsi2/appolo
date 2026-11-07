import { NextResponse, type NextRequest } from "next/server";
import { can, firstIssue, knowledgeDocSchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { createKnowledgeDoc, listKnowledgeDocs } from "@/lib/services/ai-employee";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "ai:manage")) {
      return jsonError("Your role cannot view the knowledge base.", 403, "FORBIDDEN");
    }
    return NextResponse.json({ docs: await listKnowledgeDocs(session.org.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "ai:manage")) {
      return jsonError("Your role cannot change the knowledge base.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = knowledgeDocSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const created = await createKnowledgeDoc(session.org.id, parsed.data, session.user.id);
    return NextResponse.json({ doc: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
