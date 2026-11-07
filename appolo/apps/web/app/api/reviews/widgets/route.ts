import { NextResponse, type NextRequest } from "next/server";
import { can, firstIssue, reviewWidgetConfigSchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { ensureReviewWidget, updateReviewWidget } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:read")) {
      return jsonError("Your role cannot view widgets.", 403, "FORBIDDEN");
    }
    const widget = await ensureReviewWidget(session.org.id);
    return NextResponse.json({ widget });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:request")) {
      return jsonError("Your role cannot change widgets.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = reviewWidgetConfigSchema.partial().safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const widget = await ensureReviewWidget(session.org.id);
    const config = await updateReviewWidget(session.org.id, widget.id, parsed.data);
    return NextResponse.json({ widget: { ...widget, config } });
  } catch (error) {
    return apiError(error);
  }
}
