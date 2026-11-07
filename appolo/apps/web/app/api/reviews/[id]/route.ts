import { NextResponse, type NextRequest } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { assignReview, flagReview } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** Assign a review to a teammate, or flag/unflag it. */
export async function PATCH(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:respond")) {
      return jsonError("Your role cannot manage reviews.", 403, "FORBIDDEN");
    }

    const { id } = await params;
    let body: { assignedTo?: unknown; flagged?: unknown };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    if (body.assignedTo !== undefined) {
      const assignedTo = body.assignedTo === null || body.assignedTo === "" ? null : String(body.assignedTo);
      if (assignedTo && !/^[0-9a-f-]{36}$/i.test(assignedTo)) {
        return jsonError("assignedTo must be a user id or null.", 400, "INVALID_INPUT");
      }
      await assignReview(session.org.id, id, assignedTo, session.user.id);
    }

    if (body.flagged !== undefined) {
      if (typeof body.flagged !== "boolean") {
        return jsonError("flagged must be a boolean.", 400, "INVALID_INPUT");
      }
      await flagReview(session.org.id, id, body.flagged, session.user.id);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
