import { NextResponse, type NextRequest } from "next/server";
import { campaignSchema, can, firstIssue } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { createCampaign, listCampaigns, previewSegment } from "@/lib/services/campaigns";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "messages:send")) {
      return jsonError("Your role cannot view campaigns.", 403, "FORBIDDEN");
    }

    // Lightweight segment preview: /api/campaigns?preview=1&segment=tag&tag=vip
    const params = request.nextUrl.searchParams;
    if (params.get("preview") === "1") {
      const segment = (params.get("segment") ?? "all") as "all" | "tag";
      const count = await previewSegment(session.org.id, segment, params.get("tag"));
      return NextResponse.json({ recipients: count });
    }

    return NextResponse.json({ campaigns: await listCampaigns(session.org.id) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "messages:send")) {
      return jsonError("Your role cannot create campaigns.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = campaignSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const created = await createCampaign(session.org.id, parsed.data, session.user.id);
    return NextResponse.json({ campaign: created }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
