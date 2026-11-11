import { NextResponse, type NextRequest } from "next/server";
import { firstIssue, voteInputSchema } from "@appolo/core";
import { getSession } from "@/lib/session";
import { apiError, jsonError, rateLimited } from "@/lib/api";
import { consumeAction, VOTE_WINDOW } from "@/lib/services/action-rate-limit";
import { submitVote } from "@/lib/services/rankings";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ itemId: string }> };

export async function POST(request: NextRequest, { params }: Params): Promise<NextResponse> {
  try {
    const session = await getSession();
    if (!session) return jsonError("Not authenticated", 401, "UNAUTHENTICATED");

    const limit = await consumeAction("vote", session.org.id, VOTE_WINDOW);
    if (!limit.allowed) return rateLimited(limit.retryAfterSeconds);

    const { itemId } = await params;

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return jsonError("Expected a JSON body.", 400, "INVALID_BODY");
    }

    const parsed = voteInputSchema.safeParse(body);
    if (!parsed.success) return jsonError(firstIssue(parsed.error), 400, "INVALID_VOTE");

    const outcome = await submitVote(session.org.id, itemId, parsed.data.opponentId, parsed.data.result);
    return NextResponse.json(outcome);
  } catch (error) {
    return apiError(error);
  }
}
