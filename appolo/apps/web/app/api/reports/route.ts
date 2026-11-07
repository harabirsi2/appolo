import { NextResponse, type NextRequest } from "next/server";
import { can } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError } from "@/lib/api";
import { reviewReport } from "@/lib/services/reports";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    if (!can(session.membership.role, "reports:view")) {
      return jsonError("Your role cannot view reports.", 403, "FORBIDDEN");
    }
    const days = Number(request.nextUrl.searchParams.get("days") ?? "90") || 90;
    const report = await reviewReport(session.org.id, Math.min(Math.max(days, 7), 365));
    return NextResponse.json({ report });
  } catch (error) {
    return apiError(error);
  }
}
