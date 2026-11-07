import { NextResponse, type NextRequest } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { markConversationRead } from "@/lib/services/messaging";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "messages:read")) {
      return jsonError("Your role cannot read conversations.", 403, "FORBIDDEN");
    }

    const { id } = await params;
    await markConversationRead(session.org.id, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}