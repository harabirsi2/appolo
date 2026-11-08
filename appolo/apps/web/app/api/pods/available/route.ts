import { NextResponse, type NextRequest } from "next/server";
import { apiError, jsonError } from "@/lib/api";
import { getSession } from "@/lib/session";
import { availablePodsFor } from "@/lib/services/social";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");
    const itemId = request.nextUrl.searchParams.get("itemId");
    if (!itemId) return jsonError("itemId is required.", 400, "MISSING_ITEM");
    const pods = await availablePodsFor(session.org.id, itemId);
    return NextResponse.json({ pods });
  } catch (error) {
    return apiError(error);
  }
}
