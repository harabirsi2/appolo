import { NextResponse } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { deleteKnowledgeDoc } from "@/lib/services/ai-employee";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: Request, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "ai:manage")) {
      return jsonError("Your role cannot change the knowledge base.", 403, "FORBIDDEN");
    }

    const { id } = await params;
    await deleteKnowledgeDoc(session.org.id, id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
