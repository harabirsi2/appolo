import { NextResponse, type NextRequest } from "next/server";
import { can, firstIssue, noteSchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { addInternalNote } from "@/lib/services/messaging";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "messages:send")) {
      return jsonError("Your role cannot add notes.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = noteSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const { id } = await params;
    const note = await addInternalNote(session.org.id, id, session.user.id, parsed.data.body);
    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}