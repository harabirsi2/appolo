import { NextResponse, type NextRequest } from "next/server";
import { can, firstIssue, reviewTemplateSchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { createReviewTemplate, listReviewTemplates } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:request")) {
      return jsonError("Your role cannot read templates.", 403, "FORBIDDEN");
    }
    const templates = await listReviewTemplates(session.org.id);
    return NextResponse.json({ templates });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reviews:request")) {
      return jsonError("Your role cannot create templates.", 403, "FORBIDDEN");
    }

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_JSON");
    }

    const parsed = reviewTemplateSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_INPUT");

    const template = await createReviewTemplate(session.org.id, parsed.data);
    return NextResponse.json({ template }, { status: 201 });
  } catch (error) {
    return apiError(error);
  }
}
