import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/session";
import { apiError, jsonError, rateLimited } from "@/lib/api";
import { consumeAction, MATCHUP_WINDOW } from "@/lib/services/action-rate-limit";
import { nextMatchup } from "@/lib/services/rankings";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ itemId: string }> };

export async function GET(_request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const limit = await consumeAction("matchup", session.org.id, MATCHUP_WINDOW);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const { itemId } = await params;
    const matchup = await nextMatchup(session.org.id, itemId);
    return NextResponse.json(matchup);
  } catch (error) {
    return apiError(error);
  }
}
