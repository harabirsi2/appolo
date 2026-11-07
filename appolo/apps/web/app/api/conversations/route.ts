import { NextResponse, type NextRequest } from "next/server";
import { can, conversationQuerySchema, firstIssue } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { listConversations } from "@/lib/services/messaging";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "messages:read")) {
      return jsonError("Your role cannot read conversations.", 403, "FORBIDDEN");
    }

    const params = request.nextUrl.searchParams;
    const parsed = conversationQuerySchema.safeParse({
      status: params.get("status") ?? undefined,
      channel: params.get("channel") ?? undefined,
      assignee: params.get("assignee") ?? undefined,
      limit: params.get("limit") ?? undefined,
    });
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_QUERY");

    const conversations = await listConversations(session.org.id, parsed.data);
    return NextResponse.json({ conversations });
  } catch (error) {
    return apiError(error);
  }
}