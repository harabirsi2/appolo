import { NextResponse, type NextRequest } from "next/server";
import { can, firstIssue, savedReplySchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { createSavedReply, listSavedReplies } from "@/lib/services/messaging";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "messages:read")) {
      return jsonError("Your role cannot read saved replies.", 403, "FORBIDDEN");
    }
    const replies = await listSavedReplies(session.org.id, session.user.id);
    return NextResponse.json({ savedReplies: replies });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "messages:send")) {
      return jsonError("Your role cannot create saved replies.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = savedReplySchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const reply = await createSavedReply(session.org.id, session.user.id, parsed.data);
    return NextResponse.json({ savedReply: reply }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}