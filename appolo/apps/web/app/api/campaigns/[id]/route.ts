import { NextResponse, type NextRequest } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { deleteCampaign } from "@/lib/services/campaigns";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function DELETE(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "messages:send")) {
      return jsonError("Your role cannot delete campaigns.", 403, "FORBIDDEN");
    }
    const { id } = await params;
    await deleteCampaign(session.org.id, id, session.user.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
