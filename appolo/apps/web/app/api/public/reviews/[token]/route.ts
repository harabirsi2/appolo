import { NextResponse, type NextRequest } from "next/server";
import { clientIpFrom, apiError, jsonError } from "@/lib/api";
import { resolveReviewLanding } from "@/lib/services/reviews";

export const dynamic = "force-dynamic";

/**
 * Public token resolution for the /r/[token] landing page. No session: the
 * token itself is the capability. Returns 410 when the link is expired.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const landing = await resolveReviewLanding(token, {
      ip: clientIpFrom(request.headers),
      userAgent: request.headers.get("user-agent"),
    });
    if (!landing) return jsonError("This link is no longer valid.", 410, "TOKEN_INVALID");
    return NextResponse.json(landing);
  } catch (error) {
    return apiError(error);
  }
}
