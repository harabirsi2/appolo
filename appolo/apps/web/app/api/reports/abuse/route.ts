import { NextResponse, type NextRequest } from "next/server";
import { apiError, jsonError, rateLimited } from "@/lib/api";
import { getSession } from "@/lib/session";
import { consumeAction, REPORT_WINDOW } from "@/lib/services/action-rate-limit";
import { reportContent, reportContentSchema } from "@/lib/services/moderation";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const limit = await consumeAction("report", session.org.id, REPORT_WINDOW);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }
    const parsed = reportContentSchema.safeParse(body);
    if (!parsed.success) return jsonError("Invalid report.", 400, "INVALID_REPORT");

    const result = await reportContent(session.org.id, parsed.data);
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (error) {
    return apiError(error);
  }
}
