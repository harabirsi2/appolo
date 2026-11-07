import { NextResponse, type NextRequest } from "next/server";
import { can, firstIssue, sendMessageSchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { getConversation, sendOutboundMessage } from "@/lib/services/messaging";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "messages:read")) {
      return jsonError("Your role cannot read messages.", 403, "FORBIDDEN");
    }

    const { id } = await params;
    const detail = await getConversation(session.org.id, id);
    if (!detail) return jsonError("Conversation not found.", 404, "CONVERSATION_NOT_FOUND");

    return NextResponse.json({ messages: detail.messages });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "messages:send")) {
      return jsonError("Your role cannot send messages.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = sendMessageSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const { id } = await params;
    const message = await sendOutboundMessage(session.org.id, id, {
      body: parsed.data.body,
      senderType: "user",
      senderId: session.user.id,
    });

    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}