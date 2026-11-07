import { NextResponse, type NextRequest } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { sendCampaign } from "@/lib/services/campaigns";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function POST(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "messages:send")) {
      return jsonError("Your role cannot send campaigns.", 403, "FORBIDDEN");
    }
    const { id } = await params;
    const result = await sendCampaign(session.org.id, id, session.user.id);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
